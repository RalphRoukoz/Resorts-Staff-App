-- RPC authorization hardening, batch allowance, and Today-page aggregate.

-- ---------------------------------------------------------------------------
-- Permission helper (mirrors Staff-App permissions.ts legacy + custom roles)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_has_resort_permission(
  p_resort_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_perms text[];
  v_is_owner boolean;
BEGIN
  IF v_uid IS NULL OR p_resort_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = v_uid) THEN
    RETURN true;
  END IF;

  SELECT rs.role, rr.permissions, coalesce(rr.is_owner, false)
    INTO v_role, v_perms, v_is_owner
    FROM public.resort_staff rs
    LEFT JOIN public.resort_roles rr ON rr.id = rs.resort_role_id
    WHERE rs.user_id = v_uid
      AND rs.resort_id = p_resort_id
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_is_owner OR v_role = 'admin' THEN
    RETURN true;
  END IF;

  IF v_perms IS NOT NULL AND p_permission = ANY (v_perms) THEN
    RETURN true;
  END IF;

  IF v_role = 'viewer' AND p_permission IN ('dashboard.read', 'analytics.read') THEN
    RETURN true;
  END IF;

  IF v_role = 'reception' AND p_permission = 'scanner' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- scan_invitation: require scanner permission (not just staff membership)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_invitation(
  p_token text,
  p_checkpoint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_asset assets%ROWTYPE;
  v_resort resorts%ROWTYPE;
  v_today date;
  v_staff_id uuid;
  v_needs_reception boolean;
  v_needs_gate boolean;
  v_needs_payment boolean;
BEGIN
  v_today := (timezone('Asia/Beirut', now()))::date;
  v_staff_id := auth.uid();

  IF v_staff_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHORIZED');
  END IF;

  IF p_checkpoint NOT IN ('reception', 'gate') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CHECKPOINT');
  END IF;

  SELECT * INTO v_inv FROM public.invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_asset FROM public.assets WHERE id = v_inv.asset_id;
  SELECT * INTO v_resort FROM public.resorts WHERE id = v_asset.resort_id;

  IF NOT public.caller_has_resort_permission(v_resort.id, 'scanner') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHORIZED');
  END IF;

  IF v_inv.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CANCELLED');
  END IF;

  IF v_inv.status = 'validated' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'ALREADY_USED',
      'validated_at', v_inv.validated_at,
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
    );
  END IF;

  IF v_inv.visit_date <> v_today THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'WRONG_DATE',
      'valid_for', v_inv.visit_date,
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
    );
  END IF;

  v_needs_payment := v_asset.asset_type = 'cabine' AND coalesce(v_resort.cabine_paid_invites, false);
  v_needs_reception := v_needs_payment
    OR (v_asset.asset_type = 'chalet' AND coalesce(v_resort.chalet_double_scan, false));
  v_needs_gate := v_needs_payment
    OR (v_asset.asset_type = 'chalet' AND coalesce(v_resort.chalet_double_scan, false))
    OR v_needs_reception;

  IF p_checkpoint = 'reception' THEN
    IF NOT v_needs_reception THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'RECEPTION_NOT_REQUIRED');
    END IF;
    IF v_inv.reception_scanned_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_SCANNED_RECEPTION');
    END IF;

    UPDATE public.invitations SET
      reception_scanned_at = now(),
      reception_scanned_by = v_staff_id,
      payment_status = CASE WHEN v_needs_payment THEN 'paid' ELSE payment_status END
    WHERE id = v_inv.id;

    IF v_needs_gate THEN
      RETURN jsonb_build_object(
        'ok', true,
        'checkpoint', 'reception',
        'next_checkpoint', 'gate',
        'invitee', v_inv.invitee_name,
        'chalet', v_asset.label,
        'resort', v_resort.name,
        'visit_date', v_inv.visit_date
      );
    END IF;

    UPDATE public.invitations SET status = 'validated', validated_at = now(), validated_by = v_staff_id
    WHERE id = v_inv.id;

    RETURN jsonb_build_object(
      'ok', true, 'checkpoint', 'reception', 'final', true,
      'invitee', v_inv.invitee_name, 'chalet', v_asset.label,
      'resort', v_resort.name, 'visit_date', v_inv.visit_date
    );
  END IF;

  IF v_needs_reception AND v_inv.reception_scanned_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RECEPTION_REQUIRED_FIRST');
  END IF;

  IF v_needs_payment AND v_inv.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PAYMENT_REQUIRED');
  END IF;

  IF v_inv.gate_scanned_at IS NOT NULL OR v_inv.status = 'validated' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;

  UPDATE public.invitations SET
    gate_scanned_at = now(),
    gate_scanned_by = v_staff_id,
    status = 'validated',
    validated_at = now(),
    validated_by = v_staff_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'ok', true, 'checkpoint', 'gate', 'final', true,
    'invitee', v_inv.invitee_name, 'chalet', v_asset.label,
    'resort', v_resort.name, 'visit_date', v_inv.visit_date
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- resort_visit_analytics_v2: require analytics.read for the resort
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_visit_analytics_v2(
  p_resort_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_guest_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
  v_to date;
  v_guest text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT public.caller_has_resort_permission(p_resort_id, 'analytics.read') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_from := coalesce(p_date_from, date_trunc('month', timezone('Asia/Beirut', now()))::date);
  v_to := coalesce(p_date_to, (timezone('Asia/Beirut', now()))::date);
  v_guest := nullif(trim(coalesce(p_guest_name, '')), '');

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'visits', (
        SELECT count(*)::int FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
      ),
      'unique_guests', (
        SELECT count(DISTINCT lower(trim(i.invitee_name)))::int FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
      )
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', d, 'visits', c) ORDER BY d)
      FROM (
        SELECT extract(day FROM (i.validated_at AT TIME ZONE 'Asia/Beirut'))::int AS d, count(*)::int AS c
        FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
        GROUP BY 1
      ) sub
    ), '[]'::jsonb),
    'by_unit', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'visits', visits) ORDER BY visits DESC)
      FROM (
        SELECT a.label, count(*)::int AS visits
        FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
        GROUP BY a.label
      ) sub
    ), '[]'::jsonb),
    'guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', invitee_name,
        'unit', unit_label,
        'visits', visits,
        'last_visit', last_visit
      ) ORDER BY visits DESC)
      FROM (
        SELECT i.invitee_name,
          a.label AS unit_label,
          count(*)::int AS visits,
          max((i.validated_at AT TIME ZONE 'Asia/Beirut')::date)::text AS last_visit
        FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
        GROUP BY i.invitee_name, a.label
      ) sub
    ), '[]'::jsonb),
    'weekday', (
      SELECT count(*)::int FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id AND i.status = 'validated'
        AND i.day_type = 'weekday'
        AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
        AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
        AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
    ),
    'weekend', (
      SELECT count(*)::int FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id AND i.status = 'validated'
        AND i.day_type = 'weekend'
        AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
        AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
        AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
    ),
    'date_from', v_from,
    'date_to', v_to
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- asset_invite_allowance: staff dashboard.read OR asset controller (owner app)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asset_invite_allowance(p_asset uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_asset_type text;
  v_asset_weekday_limit int;
  v_asset_weekend_limit int;
  v_month_start date;
  base_wd int;
  base_we int;
  bonus_wd int;
  bonus_we int;
  used_wd int;
  used_we int;
  v_me text;
BEGIN
  SELECT a.resort_id, a.asset_type, a.weekday_limit, a.weekend_limit
    INTO v_resort_id, v_asset_type, v_asset_weekday_limit, v_asset_weekend_limit
    FROM public.assets a
   WHERE a.id = p_asset;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  v_me := public.current_user_phone();
  IF NOT public.caller_has_resort_permission(v_resort_id, 'dashboard.read')
     AND (v_me IS NULL OR v_me <> public.asset_controller(p_asset, public.today_beirut())) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF v_asset_type = 'cabine' THEN
    SELECT
      coalesce(v_asset_weekday_limit, r.cabine_weekday_limit, 0),
      coalesce(v_asset_weekend_limit, r.cabine_weekend_limit, 0)
      INTO base_wd, base_we
      FROM public.resorts r
     WHERE r.id = v_resort_id;
  ELSE
    SELECT
      coalesce(v_asset_weekday_limit, r.chalet_weekday_limit, 0),
      coalesce(v_asset_weekend_limit, r.chalet_weekend_limit, 0)
      INTO base_wd, base_we
      FROM public.resorts r
     WHERE r.id = v_resort_id;
  END IF;

  v_month_start := date_trunc('month', public.today_beirut())::date;

  SELECT
    coalesce((
      SELECT b.weekday_bonus
        FROM public.asset_invite_bonuses b
       WHERE b.asset_id = p_asset AND b.month_start = v_month_start
    ), 0),
    coalesce((
      SELECT b.weekend_bonus
        FROM public.asset_invite_bonuses b
       WHERE b.asset_id = p_asset AND b.month_start = v_month_start
    ), 0)
  INTO bonus_wd, bonus_we;

  SELECT count(*)::int INTO used_wd
    FROM public.invitations i
   WHERE i.asset_id = p_asset
     AND i.day_type = 'weekday'
     AND date_trunc('month', i.visit_date) = v_month_start
     AND (i.status = 'validated' OR (i.status = 'issued' AND i.visit_date >= public.today_beirut()));

  SELECT count(*)::int INTO used_we
    FROM public.invitations i
   WHERE i.asset_id = p_asset
     AND i.day_type = 'weekend'
     AND date_trunc('month', i.visit_date) = v_month_start
     AND (i.status = 'validated' OR (i.status = 'issued' AND i.visit_date >= public.today_beirut()));

  RETURN jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'weekday', jsonb_build_object(
      'base', base_wd,
      'bonus', bonus_wd,
      'total', base_wd + bonus_wd,
      'used', used_wd,
      'remaining', greatest(base_wd + bonus_wd - used_wd, 0)
    ),
    'weekend', jsonb_build_object(
      'base', base_we,
      'bonus', bonus_we,
      'total', base_we + bonus_we,
      'used', used_we,
      'remaining', greatest(base_we + bonus_we - used_we, 0)
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Batch allowance (one round-trip for Units page)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asset_invite_allowances_batch(p_asset_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_id uuid;
  v_row jsonb;
  v_resort_id uuid;
  v_resort_count int;
BEGIN
  IF auth.uid() IS NULL OR p_asset_ids IS NULL OR cardinality(p_asset_ids) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT count(DISTINCT a.resort_id), min(a.resort_id)
    INTO v_resort_count, v_resort_id
    FROM public.assets a
   WHERE a.id = ANY (p_asset_ids);

  IF v_resort_count <> 1 OR v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ASSETS');
  END IF;

  IF NOT public.caller_has_resort_permission(v_resort_id, 'dashboard.read') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  FOREACH v_id IN ARRAY p_asset_ids
  LOOP
    v_row := public.asset_invite_allowance(v_id);
    IF v_row ? 'error' THEN
      CONTINUE;
    END IF;
    v_result := v_result || jsonb_build_object(v_id::text, v_row);
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.asset_invite_allowances_batch(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Month status counts for Today dashboard (replaces full-row client fetch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_invitation_status_counts(
  p_resort_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT public.caller_has_resort_permission(p_resort_id, 'dashboard.read') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('status', status, 'count', cnt))
    FROM (
      SELECT i.status, count(*)::int AS cnt
      FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id
        AND i.visit_date BETWEEN p_date_from AND p_date_to
      GROUP BY i.status
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_invitation_status_counts(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- purge_expired_announcements: cron/service only, not authenticated users
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.purge_expired_announcements() FROM authenticated;
