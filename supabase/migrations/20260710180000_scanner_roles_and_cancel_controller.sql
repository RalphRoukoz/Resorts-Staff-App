-- Split scanner permissions, allow controllers to cancel invitations,
-- and enforce checkpoint-specific scan authorization.

-- ---------------------------------------------------------------------------
-- 1) Expand legacy "scanner" permission on custom roles
-- ---------------------------------------------------------------------------
UPDATE public.resort_roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['scanner.reception', 'scanner.gate']::text[]) AS p
)
WHERE 'scanner' = ANY (permissions);

-- ---------------------------------------------------------------------------
-- 2) System roles per resort for reception / gate scanners
-- ---------------------------------------------------------------------------
INSERT INTO public.resort_roles (resort_id, name, permissions, is_system, is_owner)
SELECT r.id, 'Reception scanner', ARRAY['scanner.reception']::text[], true, false
FROM public.resorts r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.resort_roles rr
  WHERE rr.resort_id = r.id
    AND rr.is_system
    AND rr.name = 'Reception scanner'
);

INSERT INTO public.resort_roles (resort_id, name, permissions, is_system, is_owner)
SELECT r.id, 'Gate scanner', ARRAY['scanner.gate']::text[], true, false
FROM public.resorts r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.resort_roles rr
  WHERE rr.resort_id = r.id
    AND rr.is_system
    AND rr.name = 'Gate scanner'
);

-- ---------------------------------------------------------------------------
-- 3) Permission helper: support scanner.reception / scanner.gate
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

  IF v_perms IS NOT NULL THEN
    IF p_permission = ANY (v_perms) THEN
      RETURN true;
    END IF;
    -- Legacy combined scanner permission grants both checkpoints
    IF p_permission IN ('scanner.reception', 'scanner.gate')
       AND 'scanner' = ANY (v_perms) THEN
      RETURN true;
    END IF;
  END IF;

  IF v_role = 'viewer' AND p_permission IN ('dashboard.read', 'analytics.read') THEN
    RETURN true;
  END IF;

  -- Legacy reception staff (no custom role row) can use either scanner
  IF v_role = 'reception'
     AND v_perms IS NULL
     AND p_permission IN ('scanner', 'scanner.reception', 'scanner.gate') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) scan_invitation: checkpoint-specific permission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_invitation(
  p_token uuid,
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
  v_is_cabine boolean;
  v_is_chalet boolean;
  v_needs_reception boolean;
  v_needs_gate boolean;
  v_needs_payment boolean;
  v_scan_perm text;
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

  v_scan_perm := CASE
    WHEN p_checkpoint = 'reception' THEN 'scanner.reception'
    ELSE 'scanner.gate'
  END;

  IF NOT (
    public.caller_has_resort_permission(v_resort.id, v_scan_perm)
    OR public.caller_has_resort_permission(v_resort.id, 'scanner')
  ) THEN
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

  v_is_cabine := v_asset.asset_type = 'cabine';
  v_is_chalet := v_asset.asset_type = 'chalet';

  v_needs_reception := v_is_cabine
    OR (v_is_chalet AND coalesce(v_resort.chalet_double_scan, false));
  v_needs_gate := v_needs_reception;
  v_needs_payment := v_is_cabine AND coalesce(v_resort.cabine_paid_invites, false);

  IF p_checkpoint = 'reception' THEN
    IF NOT v_needs_reception THEN
      UPDATE public.invitations SET
        reception_scanned_at = now(),
        reception_scanned_by = v_staff_id,
        status = 'validated',
        validated_at = now(),
        validated_by = v_staff_id
      WHERE id = v_inv.id;

      RETURN jsonb_build_object(
        'ok', true, 'checkpoint', 'reception', 'final', true,
        'invitee', v_inv.invitee_name, 'chalet', v_asset.label,
        'resort', v_resort.name, 'visit_date', v_inv.visit_date
      );
    END IF;

    IF v_inv.reception_scanned_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_SCANNED_RECEPTION');
    END IF;

    UPDATE public.invitations SET
      reception_scanned_at = now(),
      reception_scanned_by = v_staff_id,
      payment_status = CASE WHEN v_needs_payment THEN 'paid' ELSE payment_status END
    WHERE id = v_inv.id;

    RETURN jsonb_build_object(
      'ok', true,
      'checkpoint', 'reception',
      'next_checkpoint', 'gate',
      'final', false,
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label,
      'resort', v_resort.name,
      'visit_date', v_inv.visit_date
    );
  END IF;

  -- Gate checkpoint
  IF v_needs_reception AND v_inv.reception_scanned_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'RECEPTION_REQUIRED_FIRST',
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
    );
  END IF;

  IF v_needs_payment AND v_inv.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PAYMENT_REQUIRED');
  END IF;

  IF v_inv.gate_scanned_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;

  IF NOT v_needs_gate THEN
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
-- 5) cancel_invitation: issuer OR current asset controller (ticket issuer role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invitations;
  me text;
  controller text;
BEGIN
  me := public.current_user_phone();
  IF me IS NULL THEN
    RAISE EXCEPTION 'NO_PHONE';
  END IF;

  SELECT * INTO inv FROM public.invitations WHERE id = p_invitation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  controller := public.asset_controller(inv.asset_id, inv.visit_date);

  IF inv.issued_by_phone <> me AND controller IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF inv.status <> 'issued' THEN
    RAISE EXCEPTION 'CANNOT_CANCEL';
  END IF;

  UPDATE public.invitations SET status = 'cancelled' WHERE id = inv.id;
END;
$$;

-- Controllers can read invitations for units they control (so they can cancel)
DROP POLICY IF EXISTS invitations_controller_read ON public.invitations;
CREATE POLICY invitations_controller_read
  ON public.invitations
  FOR SELECT
  USING (
    public.current_user_phone() IS NOT NULL
    AND public.current_user_phone() = public.asset_controller(asset_id, visit_date)
  );

GRANT EXECUTE ON FUNCTION public.scan_invitation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_has_resort_permission(uuid, text) TO authenticated;

-- Seed scanner system roles for newly created resorts
CREATE OR REPLACE FUNCTION public.seed_resort_scanner_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.resort_roles (resort_id, name, permissions, is_system, is_owner)
  VALUES
    (NEW.id, 'Reception scanner', ARRAY['scanner.reception']::text[], true, false),
    (NEW.id, 'Gate scanner', ARRAY['scanner.gate']::text[], true, false)
  ON CONFLICT (resort_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resorts_seed_scanner_roles ON public.resorts;
CREATE TRIGGER resorts_seed_scanner_roles
  AFTER INSERT ON public.resorts
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_resort_scanner_roles();
