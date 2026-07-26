-- Cabine invitations: reception-only check-in (final). Gate must refuse cabines.

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
  v_chalet_double boolean;
  v_needs_payment boolean;
  v_scan_perm text;
  v_used_checkpoint text;
  v_used_at timestamptz;
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
    v_used_checkpoint := CASE
      WHEN v_inv.gate_scanned_at IS NOT NULL THEN 'gate'
      WHEN v_inv.reception_scanned_at IS NOT NULL THEN 'reception'
      ELSE NULL
    END;
    v_used_at := coalesce(
      v_inv.gate_scanned_at,
      v_inv.reception_scanned_at,
      v_inv.validated_at
    );

    RETURN jsonb_build_object(
      'ok', false, 'reason', 'ALREADY_USED',
      'validated_at', v_used_at,
      'checkpoint', v_used_checkpoint,
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
  v_chalet_double := v_is_chalet AND coalesce(v_resort.chalet_double_scan, false);
  v_needs_payment := v_is_cabine AND coalesce(v_resort.cabine_paid_invites, false);

  -- Cabine QR codes are never valid at the gate (paper bill from reception).
  IF p_checkpoint = 'gate' AND v_is_cabine THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'CABINE_RECEPTION_ONLY',
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
    );
  END IF;

  IF p_checkpoint = 'reception' THEN
    -- Cabine: single reception scan = checked in (final).
    IF v_is_cabine THEN
      IF v_inv.reception_scanned_at IS NOT NULL THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'ALREADY_USED',
          'validated_at', v_inv.reception_scanned_at,
          'checkpoint', 'reception',
          'invitee', v_inv.invitee_name,
          'chalet', v_asset.label
        );
      END IF;

      UPDATE public.invitations SET
        reception_scanned_at = now(),
        reception_scanned_by = v_staff_id,
        payment_status = CASE WHEN v_needs_payment THEN 'paid' ELSE payment_status END,
        status = 'validated',
        validated_at = now(),
        validated_by = v_staff_id
      WHERE id = v_inv.id;

      RETURN jsonb_build_object(
        'ok', true,
        'checkpoint', 'reception',
        'final', true,
        'invitee', v_inv.invitee_name,
        'chalet', v_asset.label,
        'resort', v_resort.name,
        'visit_date', v_inv.visit_date
      );
    END IF;

    -- Chalet with double-scan: reception is first step only.
    IF v_chalet_double THEN
      IF v_inv.reception_scanned_at IS NOT NULL THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'ALREADY_SCANNED_RECEPTION',
          'validated_at', v_inv.reception_scanned_at,
          'checkpoint', 'reception',
          'invitee', v_inv.invitee_name,
          'chalet', v_asset.label
        );
      END IF;

      UPDATE public.invitations SET
        reception_scanned_at = now(),
        reception_scanned_by = v_staff_id
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

    -- Chalet single-scan: reception can finalize.
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

  -- Gate checkpoint (chalets only — cabines already returned above)
  IF v_chalet_double AND v_inv.reception_scanned_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'RECEPTION_REQUIRED_FIRST',
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
    );
  END IF;

  IF v_inv.gate_scanned_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'ALREADY_USED',
      'validated_at', v_inv.gate_scanned_at,
      'checkpoint', 'gate',
      'invitee', v_inv.invitee_name,
      'chalet', v_asset.label
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
