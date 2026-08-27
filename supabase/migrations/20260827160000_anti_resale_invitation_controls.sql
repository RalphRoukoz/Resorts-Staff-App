-- Anti-resale controls:
-- 1) Resort-wide daily invitation cap + advance-issue window
-- 2) Global one-device-per-phone lock + takeover log
-- 3) Guest Patterns analytics RPC + invite suspension

-- ---------------------------------------------------------------------------
-- Resort settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS daily_invitation_cap integer,
  ADD COLUMN IF NOT EXISTS max_advance_days integer,
  ADD COLUMN IF NOT EXISTS distinct_guests_flag_chalet integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS distinct_guests_flag_cabine integer NOT NULL DEFAULT 8;

COMMENT ON COLUMN public.resorts.daily_invitation_cap IS
  'Max guest invitations (issued+validated) per visit_date resort-wide. NULL = unlimited.';
COMMENT ON COLUMN public.resorts.max_advance_days IS
  'How many days ahead of today_beirut() invitations may be issued. NULL = unlimited.';
COMMENT ON COLUMN public.resorts.distinct_guests_flag_chalet IS
  'Guest Patterns flag threshold: distinct guests/month for chalets. Visibility only.';
COMMENT ON COLUMN public.resorts.distinct_guests_flag_cabine IS
  'Guest Patterns flag threshold: distinct guests/month for cabines. Visibility only.';

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_daily_invitation_cap_check;
ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_daily_invitation_cap_check
  CHECK (daily_invitation_cap IS NULL OR daily_invitation_cap > 0);

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_max_advance_days_check;
ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_max_advance_days_check
  CHECK (max_advance_days IS NULL OR max_advance_days >= 0);

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_distinct_guests_flag_chalet_check;
ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_distinct_guests_flag_chalet_check
  CHECK (distinct_guests_flag_chalet > 0);

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_distinct_guests_flag_cabine_check;
ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_distinct_guests_flag_cabine_check
  CHECK (distinct_guests_flag_cabine > 0);

-- ---------------------------------------------------------------------------
-- Unit suspension (staff action from Guest Patterns)
-- ---------------------------------------------------------------------------
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS invites_suspended_until date;

COMMENT ON COLUMN public.assets.invites_suspended_until IS
  'When set and >= today_beirut(), issue_invitation is blocked for this unit.';

COMMENT ON COLUMN public.assets.allow_multiple_logins IS
  'DEPRECATED. Single-device lock is global per phone number. Column retained for compatibility; ignored by claim/check RPCs.';

-- ---------------------------------------------------------------------------
-- Device takeover log (feeds Guest Patterns ping-pong signal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_takeovers (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  old_device_id text,
  new_device_id text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_takeovers_phone_created_idx
  ON public.device_takeovers (phone, created_at DESC);

ALTER TABLE public.device_takeovers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.device_takeovers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.device_takeovers TO service_role;
GRANT SELECT ON TABLE public.device_takeovers TO authenticated;

DROP POLICY IF EXISTS device_takeovers_staff_read ON public.device_takeovers;
CREATE POLICY device_takeovers_staff_read ON public.device_takeovers
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.resort_staff rs WHERE rs.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Global single-device lock (every signed-in phone with a profile phone)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_owner_device(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_digits text;
  v_device text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_old_device text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_DEVICE');
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = v_uid;
  v_digits := public.normalize_phone_digits(v_phone);

  -- No phone on profile (staff / half-provisioned): skip lock.
  IF v_digits IS NULL OR length(v_digits) < 8 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'single_device', false,
      'allowed', true
    );
  END IF;

  SELECT device_id INTO v_old_device
    FROM public.owner_device_locks
   WHERE phone = v_digits;

  INSERT INTO public.owner_device_locks AS l (phone, device_id, user_id, updated_at)
  VALUES (v_digits, v_device, v_uid, now())
  ON CONFLICT (phone) DO UPDATE
    SET device_id = excluded.device_id,
        user_id = excluded.user_id,
        updated_at = now();

  IF v_old_device IS NOT NULL AND v_old_device <> v_device THEN
    INSERT INTO public.device_takeovers (phone, old_device_id, new_device_id, user_id)
    VALUES (v_digits, v_old_device, v_device, v_uid);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'single_device', true,
    'allowed', true,
    'took_over', coalesce(v_old_device IS NOT NULL AND v_old_device <> v_device, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_owner_device(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_digits text;
  v_device text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_active text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_DEVICE');
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = v_uid;
  v_digits := public.normalize_phone_digits(v_phone);

  IF v_digits IS NULL OR length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'single_device', false);
  END IF;

  SELECT device_id INTO v_active
    FROM public.owner_device_locks
   WHERE phone = v_digits;

  IF v_active IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'single_device', true, 'needs_claim', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'allowed', v_active = v_device,
    'single_device', true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Resort date capacity (guest + staff UX)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_date_capacity(p_resort uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer;
  v_used integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF p_resort IS NULL OR p_date IS NULL THEN
    RETURN jsonb_build_object('error', 'BAD_ARGS');
  END IF;

  SELECT r.daily_invitation_cap INTO v_cap
    FROM public.resorts r
   WHERE r.id = p_resort;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT count(*)::int INTO v_used
    FROM public.invitations i
    JOIN public.assets a ON a.id = i.asset_id
   WHERE a.resort_id = p_resort
     AND i.visit_date = p_date
     AND i.status IN ('issued', 'validated');

  RETURN jsonb_build_object(
    'date', p_date,
    'used', v_used,
    'cap', v_cap,
    'remaining', CASE WHEN v_cap IS NULL THEN NULL ELSE greatest(v_cap - v_used, 0) END,
    'is_full', CASE WHEN v_cap IS NULL THEN false ELSE v_used >= v_cap END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_date_capacity(uuid, date) TO authenticated;

CREATE INDEX IF NOT EXISTS invitations_resort_visit_status_idx
  ON public.invitations (visit_date, status, asset_id);

-- ---------------------------------------------------------------------------
-- issue_invitation: advance window + daily cap + suspension
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_invitation(
  p_asset uuid,
  p_invitee_name text,
  p_invitee_phone text,
  p_visit_date date
)
RETURNS invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text;
  wknd int[];
  dtype text;
  rem int;
  result public.invitations;
  asset_type text;
  cabine_invites boolean;
  cabine_paid boolean;
  pay_status text := 'not_required';
  v_period_mode text;
  v_period_start date;
  v_period_end date;
  v_today date;
  v_resort_id uuid;
  v_daily_cap integer;
  v_max_advance integer;
  v_suspended_until date;
  v_used integer;
BEGIN
  me := public.current_user_phone();
  IF me IS NULL THEN
    RAISE EXCEPTION 'NO_PHONE';
  END IF;

  v_today := public.today_beirut();
  IF p_visit_date < v_today THEN
    RAISE EXCEPTION 'PAST_DATE';
  END IF;

  IF NOT public.caller_is_active_controller(p_asset, p_visit_date) THEN
    IF EXISTS (
      SELECT 1
        FROM public.tenancies t
       WHERE t.asset_id = p_asset
         AND t.tenant_phone = me
    ) AND NOT EXISTS (
      SELECT 1
        FROM public.assets a
       WHERE a.id = p_asset
         AND me = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'RENTAL_ENDED';
    END IF;
    RAISE EXCEPTION 'NOT_CONTROLLER';
  END IF;

  IF p_invitee_phone = '' THEN
    p_invitee_phone := NULL;
  END IF;

  SELECT
    a.asset_type,
    a.resort_id,
    a.invites_suspended_until,
    r.weekend_days,
    r.cabine_invites_enabled,
    coalesce(r.cabine_paid_invites, false),
    r.invitation_period_mode,
    r.invitation_period_start,
    r.invitation_period_end,
    r.daily_invitation_cap,
    r.max_advance_days
  INTO
    asset_type,
    v_resort_id,
    v_suspended_until,
    wknd,
    cabine_invites,
    cabine_paid,
    v_period_mode,
    v_period_start,
    v_period_end,
    v_daily_cap,
    v_max_advance
  FROM public.assets a
  JOIN public.resorts r ON r.id = a.resort_id
  WHERE a.id = p_asset;

  IF asset_type IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_suspended_until IS NOT NULL AND v_suspended_until >= v_today THEN
    RAISE EXCEPTION 'INVITES_SUSPENDED';
  END IF;

  IF v_period_mode = 'whole_period'
     AND v_period_start IS NOT NULL
     AND v_period_end IS NOT NULL THEN
    IF v_today < v_period_start OR v_today > v_period_end THEN
      RAISE EXCEPTION 'OFF_SEASON';
    END IF;
    IF p_visit_date < v_period_start OR p_visit_date > v_period_end THEN
      RAISE EXCEPTION 'VISIT_DATE_OFF_SEASON';
    END IF;
  END IF;

  IF v_max_advance IS NOT NULL AND p_visit_date > (v_today + v_max_advance) THEN
    RAISE EXCEPTION 'TOO_FAR_AHEAD';
  END IF;

  IF asset_type = 'cabine' AND NOT cabine_invites THEN
    RAISE EXCEPTION 'CABINE_INVITES_DISABLED';
  END IF;

  IF asset_type = 'cabine' AND cabine_paid THEN
    pay_status := 'pending';
  END IF;

  dtype := CASE
    WHEN extract(dow FROM p_visit_date)::int = ANY (wknd) THEN 'weekend'
    ELSE 'weekday'
  END;

  rem := public.remaining_invites(p_asset, dtype, p_visit_date);
  IF rem <= 0 THEN
    RAISE EXCEPTION 'NO_ALLOWANCE_LEFT';
  END IF;

  -- Serialize concurrent issues for the same resort+date before the cap check.
  IF v_daily_cap IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_resort_id::text || ':' || p_visit_date::text)
    );

    SELECT count(*)::int INTO v_used
      FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
     WHERE a.resort_id = v_resort_id
       AND i.visit_date = p_visit_date
       AND i.status IN ('issued', 'validated');

    IF v_used >= v_daily_cap THEN
      RAISE EXCEPTION 'RESORT_DAY_FULL';
    END IF;
  END IF;

  INSERT INTO public.invitations (
    asset_id,
    issued_by_phone,
    invitee_name,
    invitee_phone,
    visit_date,
    day_type,
    payment_status
  )
  VALUES (
    p_asset,
    me,
    p_invitee_name,
    p_invitee_phone,
    p_visit_date,
    dtype,
    pay_status
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_invitation(uuid, text, text, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Staff: suspend / unsuspend unit invitations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_asset_invites_suspended(
  p_asset_id uuid,
  p_until date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  SELECT resort_id INTO v_resort_id FROM public.assets WHERE id = p_asset_id;
  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT public.caller_has_resort_permission(v_resort_id, 'units.write')
     AND NOT public.is_superadmin() THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  UPDATE public.assets
     SET invites_suspended_until = p_until
   WHERE id = p_asset_id;

  RETURN jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'until', p_until);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_asset_invites_suspended(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Guest Patterns analytics (visibility only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_guest_patterns(
  p_resort_id uuid,
  p_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_chalet_flag integer;
  v_cabine_flag integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT public.caller_has_resort_permission(p_resort_id, 'analytics.read')
     AND NOT public.is_superadmin() THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_month_start := date_trunc('month', coalesce(p_month, public.today_beirut()))::date;
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  SELECT distinct_guests_flag_chalet, distinct_guests_flag_cabine
    INTO v_chalet_flag, v_cabine_flag
    FROM public.resorts
   WHERE id = p_resort_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  RETURN (
    WITH month_invites AS (
      SELECT
        i.id,
        i.asset_id,
        a.label AS unit_label,
        a.asset_type,
        a.invites_suspended_until,
        i.invitee_name,
        lower(trim(i.invitee_name)) AS guest_key,
        nullif(public.normalize_phone_digits(i.invitee_phone), '') AS guest_phone,
        i.issued_by_phone,
        i.visit_date,
        i.created_at,
        i.validated_at,
        i.status,
        i.day_type
      FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id
        AND i.status IN ('issued', 'validated')
        AND i.visit_date BETWEEN v_month_start AND v_month_end
    ),
    prior_guests AS (
      SELECT DISTINCT
        i.asset_id,
        lower(trim(i.invitee_name)) AS guest_key
      FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id
        AND i.status IN ('issued', 'validated')
        AND i.visit_date < v_month_start
        AND nullif(trim(i.invitee_name), '') IS NOT NULL
    ),
    unit_stats AS (
      SELECT
        mi.asset_id,
        mi.unit_label,
        mi.asset_type,
        mi.invites_suspended_until,
        count(*)::int AS invites,
        count(*) FILTER (WHERE mi.status = 'validated')::int AS validated,
        count(DISTINCT mi.guest_key) FILTER (WHERE mi.guest_key IS NOT NULL AND mi.guest_key <> '')::int AS distinct_guests,
        count(*) FILTER (
          WHERE mi.guest_key IS NOT NULL
            AND mi.guest_key <> ''
            AND NOT EXISTS (
              SELECT 1 FROM prior_guests pg
               WHERE pg.asset_id = mi.asset_id AND pg.guest_key = mi.guest_key
            )
        )::int AS new_name_visits,
        count(*) FILTER (
          WHERE mi.validated_at IS NOT NULL
            AND mi.validated_at <= mi.created_at + interval '30 minutes'
        )::int AS short_gap_validations,
        count(*) FILTER (WHERE mi.day_type = 'weekend')::int AS weekend_invites
      FROM month_invites mi
      GROUP BY mi.asset_id, mi.unit_label, mi.asset_type, mi.invites_suspended_until
    ),
    name_reuse AS (
      SELECT
        mi.asset_id,
        max(c)::int AS top_name_visits
      FROM (
        SELECT asset_id, guest_key, count(*)::int AS c
          FROM month_invites
         WHERE guest_key IS NOT NULL AND guest_key <> ''
         GROUP BY asset_id, guest_key
      ) mi
      GROUP BY mi.asset_id
    ),
    cross_unit AS (
      SELECT
        mi.asset_id,
        count(DISTINCT mi.guest_key)::int AS cross_unit_guests
      FROM month_invites mi
      WHERE mi.guest_key IS NOT NULL AND mi.guest_key <> ''
        AND EXISTS (
          SELECT 1
            FROM month_invites other
           WHERE other.guest_key = mi.guest_key
             AND other.asset_id <> mi.asset_id
        )
      GROUP BY mi.asset_id
    ),
    device_ping AS (
      SELECT
        x.asset_id,
        count(*)::int AS takeover_count,
        count(DISTINCT x.new_device_id)::int AS distinct_devices
      FROM (
        SELECT
          a.id AS asset_id,
          t.new_device_id
        FROM public.assets a
        JOIN LATERAL unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS op(phone) ON true
        JOIN public.device_takeovers t
          ON t.phone = public.normalize_phone_digits(op.phone)
         AND t.created_at >= v_month_start::timestamptz
         AND t.created_at < ((v_month_end + 1)::timestamp AT TIME ZONE 'Asia/Beirut')
        WHERE a.resort_id = p_resort_id
        UNION ALL
        SELECT
          a.id AS asset_id,
          t.new_device_id
        FROM public.assets a
        JOIN public.tenancies tn ON tn.asset_id = a.id
        JOIN public.device_takeovers t
          ON t.phone = public.normalize_phone_digits(tn.tenant_phone)
         AND t.created_at >= v_month_start::timestamptz
         AND t.created_at < ((v_month_end + 1)::timestamp AT TIME ZONE 'Asia/Beirut')
        WHERE a.resort_id = p_resort_id
      ) x
      GROUP BY x.asset_id
    ),
    scored AS (
      SELECT
        us.asset_id,
        us.unit_label,
        us.asset_type,
        us.invites_suspended_until,
        us.invites,
        us.validated,
        us.distinct_guests,
        CASE
          WHEN us.invites > 0 THEN round((us.new_name_visits::numeric / us.invites::numeric) * 100)::int
          ELSE 0
        END AS new_name_ratio_pct,
        coalesce(nr.top_name_visits, 0) AS top_name_visits,
        coalesce(cu.cross_unit_guests, 0) AS cross_unit_guests,
        us.short_gap_validations,
        us.weekend_invites,
        coalesce(dp.takeover_count, 0) AS device_takeovers,
        coalesce(dp.distinct_devices, 0) AS distinct_devices,
        CASE
          WHEN us.asset_type = 'cabine' THEN v_cabine_flag
          ELSE v_chalet_flag
        END AS distinct_flag_threshold,
        (
          CASE WHEN us.distinct_guests >= CASE WHEN us.asset_type = 'cabine' THEN v_cabine_flag ELSE v_chalet_flag END THEN 30 ELSE 0 END
          + CASE WHEN us.invites > 0 AND (us.new_name_visits::numeric / us.invites::numeric) >= 0.8 THEN 25 ELSE 0 END
          + CASE WHEN coalesce(nr.top_name_visits, 0) >= 8 AND us.distinct_guests <= 3 THEN 20 ELSE 0 END
          + CASE WHEN coalesce(cu.cross_unit_guests, 0) >= 3 THEN 15 ELSE 0 END
          + CASE WHEN us.short_gap_validations >= 5 THEN 15 ELSE 0 END
          + CASE WHEN us.invites >= 10 AND us.weekend_invites = us.invites THEN 10 ELSE 0 END
          + CASE WHEN coalesce(dp.takeover_count, 0) >= 3 THEN 20 ELSE 0 END
        )::int AS risk_score,
        ARRAY_remove(ARRAY[
          CASE WHEN us.distinct_guests >= CASE WHEN us.asset_type = 'cabine' THEN v_cabine_flag ELSE v_chalet_flag END
            THEN 'distinct_guests' END,
          CASE WHEN us.invites > 0 AND (us.new_name_visits::numeric / us.invites::numeric) >= 0.8
            THEN 'new_name_ratio' END,
          CASE WHEN coalesce(nr.top_name_visits, 0) >= 8 AND us.distinct_guests <= 3
            THEN 'name_reuse' END,
          CASE WHEN coalesce(cu.cross_unit_guests, 0) >= 3
            THEN 'cross_unit' END,
          CASE WHEN us.short_gap_validations >= 5
            THEN 'issue_to_arrival_gap' END,
          CASE WHEN us.invites >= 10 AND us.weekend_invites = us.invites
            THEN 'weekend_saturation' END,
          CASE WHEN coalesce(dp.takeover_count, 0) >= 3
            THEN 'device_ping_pong' END
        ], NULL) AS flags
      FROM unit_stats us
      LEFT JOIN name_reuse nr ON nr.asset_id = us.asset_id
      LEFT JOIN cross_unit cu ON cu.asset_id = us.asset_id
      LEFT JOIN device_ping dp ON dp.asset_id = us.asset_id
    )
    SELECT jsonb_build_object(
      'month_start', v_month_start,
      'month_end', v_month_end,
      'thresholds', jsonb_build_object(
        'chalet', v_chalet_flag,
        'cabine', v_cabine_flag
      ),
      'units', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'asset_id', s.asset_id,
            'label', s.unit_label,
            'asset_type', s.asset_type,
            'invites_suspended_until', s.invites_suspended_until,
            'invites', s.invites,
            'validated', s.validated,
            'distinct_guests', s.distinct_guests,
            'distinct_flag_threshold', s.distinct_flag_threshold,
            'new_name_ratio_pct', s.new_name_ratio_pct,
            'top_name_visits', s.top_name_visits,
            'cross_unit_guests', s.cross_unit_guests,
            'short_gap_validations', s.short_gap_validations,
            'weekend_invites', s.weekend_invites,
            'device_takeovers', s.device_takeovers,
            'distinct_devices', s.distinct_devices,
            'risk_score', s.risk_score,
            'flags', to_jsonb(s.flags),
            'flagged', s.risk_score > 0 OR s.distinct_guests >= s.distinct_flag_threshold
          )
          ORDER BY s.risk_score DESC, s.distinct_guests DESC, s.unit_label
        )
        FROM scored s
      ), '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_guest_patterns(uuid, date) TO authenticated;

-- Detail: recent guests for a unit in the month (evidence drawer)
CREATE OR REPLACE FUNCTION public.resort_guest_pattern_unit_detail(
  p_asset_id uuid,
  p_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_month_start date;
  v_month_end date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  SELECT resort_id INTO v_resort_id FROM public.assets WHERE id = p_asset_id;
  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT public.caller_has_resort_permission(v_resort_id, 'analytics.read')
     AND NOT public.is_superadmin() THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_month_start := date_trunc('month', coalesce(p_month, public.today_beirut()))::date;
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'month_start', v_month_start,
    'month_end', v_month_end,
    'guests', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'invitee_name', i.invitee_name,
          'invitee_phone', i.invitee_phone,
          'issued_by_phone', i.issued_by_phone,
          'visit_date', i.visit_date,
          'status', i.status,
          'created_at', i.created_at,
          'validated_at', i.validated_at
        )
        ORDER BY i.visit_date DESC, i.created_at DESC
      )
      FROM public.invitations i
      WHERE i.asset_id = p_asset_id
        AND i.status IN ('issued', 'validated')
        AND i.visit_date BETWEEN v_month_start AND v_month_end
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_guest_pattern_unit_detail(uuid, date) TO authenticated;
