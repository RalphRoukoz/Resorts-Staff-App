-- Resort admins can update invite defaults and anti-resale limits (not full resort profile).
-- Staff can archive unit messages from the dashboard without removing them from guest inboxes.

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS daily_invitation_cap integer,
  ADD COLUMN IF NOT EXISTS max_advance_days integer,
  ADD COLUMN IF NOT EXISTS distinct_guests_flag_chalet integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS distinct_guests_flag_cabine integer NOT NULL DEFAULT 8;

ALTER TABLE public.unit_messages
  ADD COLUMN IF NOT EXISTS archived_by_staff_at timestamptz;

COMMENT ON COLUMN public.unit_messages.archived_by_staff_at IS
  'When set, hidden from staff Messages page. Guests still see the message in the app.';

CREATE INDEX IF NOT EXISTS unit_messages_resort_active_staff_idx
  ON public.unit_messages (resort_id, created_at DESC)
  WHERE archived_by_staff_at IS NULL;

CREATE OR REPLACE FUNCTION public.update_resort_admin_settings(
  p_resort_id uuid,
  p_chalet_weekday_limit integer,
  p_chalet_weekend_limit integer,
  p_daily_invitation_cap integer DEFAULT NULL,
  p_max_advance_days integer DEFAULT NULL,
  p_distinct_guests_flag_chalet integer DEFAULT NULL,
  p_distinct_guests_flag_cabine integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_RESORT');
  END IF;

  IF NOT (
    public.is_superadmin()
    OR public.caller_has_resort_permission(p_resort_id, 'dashboard.write')
    OR public.is_staff(p_resort_id, 'admin')
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF p_chalet_weekday_limit IS NULL OR p_chalet_weekday_limit < 0
     OR p_chalet_weekend_limit IS NULL OR p_chalet_weekend_limit < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_CHALET_LIMIT');
  END IF;

  IF p_daily_invitation_cap IS NOT NULL AND p_daily_invitation_cap <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_DAILY_CAP');
  END IF;

  IF p_max_advance_days IS NOT NULL AND p_max_advance_days < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_ADVANCE_DAYS');
  END IF;

  IF p_distinct_guests_flag_chalet IS NOT NULL AND p_distinct_guests_flag_chalet <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_FLAG_THRESHOLD');
  END IF;

  IF p_distinct_guests_flag_cabine IS NOT NULL AND p_distinct_guests_flag_cabine <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_FLAG_THRESHOLD');
  END IF;

  UPDATE public.resorts
  SET
    chalet_weekday_limit = p_chalet_weekday_limit,
    chalet_weekend_limit = p_chalet_weekend_limit,
    daily_invitation_cap = p_daily_invitation_cap,
    max_advance_days = p_max_advance_days,
    distinct_guests_flag_chalet = COALESCE(p_distinct_guests_flag_chalet, distinct_guests_flag_chalet),
    distinct_guests_flag_cabine = COALESCE(p_distinct_guests_flag_cabine, distinct_guests_flag_cabine)
  WHERE id = p_resort_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'RESORT_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.update_resort_admin_settings IS
  'Resort staff: update chalet default invite limits and anti-resale settings.';

GRANT EXECUTE ON FUNCTION public.update_resort_admin_settings(
  uuid, integer, integer, integer, integer, integer, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_unit_message_for_staff(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
BEGIN
  IF p_message_id IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MESSAGE');
  END IF;

  SELECT resort_id INTO v_resort_id
  FROM public.unit_messages
  WHERE id = p_message_id;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT (
    public.is_superadmin()
    OR public.caller_has_resort_permission(v_resort_id, 'announcements.write')
    OR public.is_staff(v_resort_id, 'admin')
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  UPDATE public.unit_messages
  SET archived_by_staff_at = now()
  WHERE id = p_message_id
    AND archived_by_staff_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.archive_unit_message_for_staff IS
  'Hide a unit message from the staff dashboard without removing it from guest inboxes.';

GRANT EXECUTE ON FUNCTION public.archive_unit_message_for_staff(uuid) TO authenticated;
