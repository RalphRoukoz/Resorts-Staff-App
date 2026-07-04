-- Scan flow rules:
--   Chalet + dual scan ON  → reception, then gate
--   Chalet + dual scan OFF → single scan at reception OR gate validates
--   Cabine (always)        → reception, then gate (payment marked at reception when cabine_paid_invites)

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

  v_is_cabine := v_asset.asset_type = 'cabine';
  v_is_chalet := v_asset.asset_type = 'chalet';

  -- Cabines always double-scan; chalets only when the resort toggle is on.
  v_needs_reception := v_is_cabine
    OR (v_is_chalet AND coalesce(v_resort.chalet_double_scan, false));
  v_needs_gate := v_needs_reception;

  -- Payment confirmation at reception (cabines only, when enabled).
  v_needs_payment := v_is_cabine AND coalesce(v_resort.cabine_paid_invites, false);

  IF p_checkpoint = 'reception' THEN
    -- Chalet single-scan: one reception scan completes validation.
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
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label,
      'resort', v_resort.name,
      'visit_date', v_inv.visit_date
    );
  END IF;

  -- Gate checkpoint
  IF v_needs_reception AND v_inv.reception_scanned_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RECEPTION_REQUIRED_FIRST');
  END IF;

  IF v_needs_payment AND v_inv.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PAYMENT_REQUIRED');
  END IF;

  IF v_inv.gate_scanned_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_USED');
  END IF;

  -- Chalet single-scan at gate (dual scan off).
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
