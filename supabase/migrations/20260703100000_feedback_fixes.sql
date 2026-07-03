-- Resort config columns, analytics improvements, allowance unlimited cabines, invitation cleanup

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS cabine_invites_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cabine_limit_invites boolean NOT NULL DEFAULT true;

-- Default existing resorts to season mode
UPDATE public.resorts
   SET invitation_period_mode = 'whole_period'
 WHERE invitation_period_mode = 'monthly';

-- ---------------------------------------------------------------------------
-- asset_invite_allowance: support unlimited cabines
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
  v_cabine_limit_invites boolean;
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

  SELECT coalesce(r.cabine_limit_invites, true)
    INTO v_cabine_limit_invites
    FROM public.resorts r
   WHERE r.id = v_resort_id;

  IF v_asset_type = 'cabine' AND NOT v_cabine_limit_invites THEN
    RETURN jsonb_build_object(
      'month', to_char(date_trunc('month', public.today_beirut())::date, 'YYYY-MM'),
      'unlimited', true,
      'weekday', jsonb_build_object('base', null, 'bonus', 0, 'total', null, 'used', 0, 'remaining', null),
      'weekend', jsonb_build_object('base', null, 'bonus', 0, 'total', null, 'used', 0, 'remaining', null)
    );
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
-- Analytics v2: chalet name filter, daily by date, validated-only (unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_visit_analytics_v2(
  p_resort_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_guest_limit int DEFAULT 100,
  p_guest_offset int DEFAULT 0,
  p_unit_label text DEFAULT NULL
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
  v_unit text;
  v_limit int;
  v_offset int;
  v_result jsonb;
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
  v_unit := nullif(trim(coalesce(p_unit_label, '')), '');
  v_limit := greatest(least(coalesce(p_guest_limit, 100), 500), 1);
  v_offset := greatest(coalesce(p_guest_offset, 0), 0);

  WITH filtered AS (
    SELECT
      i.invitee_name,
      a.label AS unit_label,
      i.day_type,
      (i.validated_at AT TIME ZONE 'Asia/Beirut')::date AS validated_date
    FROM public.invitations i
    JOIN public.assets a ON a.id = i.asset_id
    WHERE a.resort_id = p_resort_id
      AND i.status = 'validated'
      AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
      AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
      AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
      AND (v_unit IS NULL OR a.label ILIKE '%' || v_unit || '%')
  ),
  guest_groups AS (
    SELECT
      invitee_name,
      unit_label,
      count(*)::int AS visits,
      max(validated_date)::text AS last_visit
    FROM filtered
    GROUP BY invitee_name, unit_label
  ),
  guest_page AS (
    SELECT invitee_name, unit_label, visits, last_visit
    FROM guest_groups
    ORDER BY visits DESC, invitee_name
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'visits', (SELECT count(*)::int FROM filtered),
      'unique_guests', (SELECT count(DISTINCT lower(trim(invitee_name)))::int FROM filtered)
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('date', validated_date::text, 'visits', c) ORDER BY validated_date)
      FROM (
        SELECT validated_date, count(*)::int AS c
        FROM filtered
        GROUP BY validated_date
      ) d
    ), '[]'::jsonb),
    'by_unit', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', unit_label, 'visits', c) ORDER BY c DESC)
      FROM (
        SELECT unit_label, count(*)::int AS c
        FROM filtered
        GROUP BY unit_label
      ) u
    ), '[]'::jsonb),
    'guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', invitee_name,
        'unit', unit_label,
        'visits', visits,
        'last_visit', last_visit
      ) ORDER BY visits DESC)
      FROM guest_page
    ), '[]'::jsonb),
    'guests_total', (SELECT count(*)::int FROM guest_groups),
    'weekday', (SELECT count(*)::int FROM filtered WHERE day_type = 'weekday'),
    'weekend', (SELECT count(*)::int FROM filtered WHERE day_type = 'weekend'),
    'date_from', v_from,
    'date_to', v_to,
    'guest_limit', v_limit,
    'guest_offset', v_offset
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_visit_analytics_v2(uuid, uuid, date, date, text, int, int, text) TO authenticated;
DROP FUNCTION IF EXISTS public.resort_visit_analytics_v2(uuid, uuid, date, date, text, int, int);

-- ---------------------------------------------------------------------------
-- Today consumption: validated (used) invitations only
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
        AND i.status = 'validated'
        AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN p_date_from AND p_date_to
      GROUP BY i.status
    ) sub
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Purge stale invitations (expired/cancelled/revoked) older than 90 days
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_stale_invitations(p_older_than_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff date;
  v_deleted int;
BEGIN
  v_cutoff := (timezone('Asia/Beirut', now()))::date - greatest(p_older_than_days, 30);

  DELETE FROM public.invitations
   WHERE status IN ('expired', 'cancelled', 'revoked')
     AND visit_date < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_stale_invitations(int) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'purge_stale_invitations_daily';

    PERFORM cron.schedule(
      'purge_stale_invitations_daily',
      '15 3 * * *',
      $cron$SELECT public.purge_stale_invitations(90)$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;
