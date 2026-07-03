-- Cross-app invitation system upgrade
-- Apply via Supabase CLI or SQL editor on Resorts-Supabase project.

-- ---------------------------------------------------------------------------
-- Resort configuration extensions
-- ---------------------------------------------------------------------------
ALTER TABLE resorts
  ADD COLUMN IF NOT EXISTS cabine_paid_invites boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chalet_double_scan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invitation_period_mode text NOT NULL DEFAULT 'monthly'
    CHECK (invitation_period_mode IN ('monthly', 'whole_period')),
  ADD COLUMN IF NOT EXISTS invitation_period_start date,
  ADD COLUMN IF NOT EXISTS invitation_period_end date,
  ADD COLUMN IF NOT EXISTS period_allowance_mode text NOT NULL DEFAULT 'monthly_within_period'
    CHECK (period_allowance_mode IN ('monthly_within_period', 'entire_period'));

-- ---------------------------------------------------------------------------
-- Invitation scan / payment lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required', 'pending', 'paid')),
  ADD COLUMN IF NOT EXISTS reception_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS reception_scanned_by uuid,
  ADD COLUMN IF NOT EXISTS gate_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS gate_scanned_by uuid;

-- ---------------------------------------------------------------------------
-- Phase 0: Pre-OTP eligibility (anon callable, no asset details leaked)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_owner_login_eligible(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_today date;
BEGIN
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone) < 8 THEN
    RETURN false;
  END IF;

  v_today := (timezone('Asia/Beirut', now()))::date;

  IF EXISTS (
    SELECT 1 FROM assets a
    WHERE a.owner_phone = v_phone
       OR v_phone = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenancies t
    WHERE t.tenant_phone = v_phone
      AND t.starts_on <= v_today
      AND t.ends_on >= v_today
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.check_owner_login_eligible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_owner_login_eligible(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Phase 3: Stage-aware scan (reception / gate)
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

  IF p_checkpoint NOT IN ('reception', 'gate') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CHECKPOINT');
  END IF;

  SELECT * INTO v_inv FROM invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_asset FROM assets WHERE id = v_inv.asset_id;
  SELECT * INTO v_resort FROM resorts WHERE id = v_asset.resort_id;

  -- Staff must belong to this resort
  IF NOT EXISTS (
    SELECT 1 FROM resort_staff rs
    WHERE rs.user_id = v_staff_id AND rs.resort_id = v_resort.id
  ) AND NOT EXISTS (SELECT 1 FROM super_admins sa WHERE sa.user_id = v_staff_id) THEN
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

    UPDATE invitations SET
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

    UPDATE invitations SET status = 'validated', validated_at = now(), validated_by = v_staff_id
    WHERE id = v_inv.id;

    RETURN jsonb_build_object(
      'ok', true, 'checkpoint', 'reception', 'final', true,
      'invitee', v_inv.invitee_name, 'chalet', v_asset.label,
      'resort', v_resort.name, 'visit_date', v_inv.visit_date
    );
  END IF;

  -- gate checkpoint
  IF v_needs_reception AND v_inv.reception_scanned_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RECEPTION_REQUIRED_FIRST');
  END IF;

  IF v_needs_payment AND v_inv.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PAYMENT_REQUIRED');
  END IF;

  IF v_inv.gate_scanned_at IS NOT NULL OR v_inv.status = 'validated' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;

  UPDATE invitations SET
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

GRANT EXECUTE ON FUNCTION public.scan_invitation(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Phase 5: Analytics v2 with guest search and date range
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
  v_from := coalesce(p_date_from, date_trunc('month', timezone('Asia/Beirut', now()))::date);
  v_to := coalesce(p_date_to, (timezone('Asia/Beirut', now()))::date);
  v_guest := nullif(trim(coalesce(p_guest_name, '')), '');

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'visits', (
        SELECT count(*)::int FROM invitations i
        JOIN assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
      ),
      'unique_guests', (
        SELECT count(DISTINCT lower(trim(i.invitee_name)))::int FROM invitations i
        JOIN assets a ON a.id = i.asset_id
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
        FROM invitations i
        JOIN assets a ON a.id = i.asset_id
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
        FROM invitations i
        JOIN assets a ON a.id = i.asset_id
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
        FROM invitations i
        JOIN assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
          AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
          AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
        GROUP BY i.invitee_name, a.label
      ) sub
    ), '[]'::jsonb),
    'weekday', (
      SELECT count(*)::int FROM invitations i
      JOIN assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id AND i.status = 'validated'
        AND i.day_type = 'weekday'
        AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
        AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
        AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
    ),
    'weekend', (
      SELECT count(*)::int FROM invitations i
      JOIN assets a ON a.id = i.asset_id
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

GRANT EXECUTE ON FUNCTION public.resort_visit_analytics_v2(uuid, uuid, date, date, text) TO authenticated;
