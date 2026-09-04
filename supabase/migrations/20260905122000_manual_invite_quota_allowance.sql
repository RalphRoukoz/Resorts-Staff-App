-- Enforce manual monthly quota hand-over in owner allowance and invitation issuance.

CREATE OR REPLACE FUNCTION public.asset_invite_allowance(p_asset uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_asset_type text;
  v_asset_weekday_limit integer;
  v_asset_weekend_limit integer;
  v_quota_mode text;
  v_month_start date;
  v_period_ym text;
  v_handed_over_at timestamptz;
  base_wd integer := 0;
  base_we integer := 0;
  bonus_wd integer := 0;
  bonus_we integer := 0;
  total_wd integer := 0;
  total_we integer := 0;
  used_wd integer;
  used_we integer;
  v_me text;
BEGIN
  SELECT
    a.resort_id,
    a.asset_type,
    a.weekday_limit,
    a.weekend_limit,
    coalesce(r.invitation_quota_mode, 'automatic')
  INTO
    v_resort_id,
    v_asset_type,
    v_asset_weekday_limit,
    v_asset_weekend_limit,
    v_quota_mode
  FROM public.assets a
  JOIN public.resorts r ON r.id = a.resort_id
  WHERE a.id = p_asset;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  v_me := public.current_user_phone();
  IF NOT public.caller_has_resort_permission(v_resort_id, 'dashboard.read')
     AND (v_me IS NULL OR v_me <> public.asset_controller(p_asset, public.today_beirut())) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_month_start := date_trunc('month', public.today_beirut())::date;
  v_period_ym := public.current_period_ym();

  SELECT count(*)::integer
  INTO used_wd
  FROM public.invitations i
  WHERE i.asset_id = p_asset
    AND i.day_type = 'weekday'
    AND date_trunc('month', i.visit_date) = v_month_start
    AND (
      i.status = 'validated'
      OR (i.status = 'issued' AND i.visit_date >= public.today_beirut())
    );

  SELECT count(*)::integer
  INTO used_we
  FROM public.invitations i
  WHERE i.asset_id = p_asset
    AND i.day_type = 'weekend'
    AND date_trunc('month', i.visit_date) = v_month_start
    AND (
      i.status = 'validated'
      OR (i.status = 'issued' AND i.visit_date >= public.today_beirut())
    );

  IF v_quota_mode = 'manual' THEN
    SELECT q.weekday_quota, q.weekend_quota, q.handed_over_at
    INTO total_wd, total_we, v_handed_over_at
    FROM public.asset_period_quotas q
    WHERE q.asset_id = p_asset
      AND q.period_ym = v_period_ym;

    IF NOT FOUND OR v_handed_over_at IS NULL THEN
      total_wd := 0;
      total_we := 0;
      v_handed_over_at := NULL;
    END IF;

    RETURN jsonb_build_object(
      'month', to_char(v_month_start, 'YYYY-MM'),
      'quota_mode', 'manual',
      'handed', v_handed_over_at IS NOT NULL,
      'weekday', jsonb_build_object(
        'base', 0,
        'bonus', 0,
        'total', total_wd,
        'used', used_wd,
        'remaining', greatest(total_wd - used_wd, 0)
      ),
      'weekend', jsonb_build_object(
        'base', 0,
        'bonus', 0,
        'total', total_we,
        'used', used_we,
        'remaining', greatest(total_we - used_we, 0)
      )
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

  SELECT
    coalesce((
      SELECT b.weekday_bonus
      FROM public.asset_invite_bonuses b
      WHERE b.asset_id = p_asset
        AND b.month_start = v_month_start
    ), 0),
    coalesce((
      SELECT b.weekend_bonus
      FROM public.asset_invite_bonuses b
      WHERE b.asset_id = p_asset
        AND b.month_start = v_month_start
    ), 0)
  INTO bonus_wd, bonus_we;

  RETURN jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'quota_mode', 'automatic',
    'handed', NULL,
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

CREATE OR REPLACE FUNCTION public.remaining_invites(
  p_asset uuid,
  p_day_type text,
  p_date date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowance AS (
    SELECT
      coalesce(r.invitation_quota_mode, 'automatic') AS quota_mode,
      CASE
        WHEN a.asset_type = 'cabine' AND p_day_type = 'weekend'
          THEN r.cabine_weekend_limit
        WHEN a.asset_type = 'cabine'
          THEN r.cabine_weekday_limit
        WHEN p_day_type = 'weekend'
          THEN r.chalet_weekend_limit
        ELSE r.chalet_weekday_limit
      END AS resort_default,
      CASE
        WHEN p_day_type = 'weekend' THEN q.weekend_quota
        ELSE q.weekday_quota
      END AS manual_quota,
      q.handed_over_at
    FROM public.assets a
    JOIN public.resorts r ON r.id = a.resort_id
    LEFT JOIN public.asset_period_quotas q
      ON q.asset_id = a.id
     AND q.period_ym = to_char(date_trunc('month', p_date)::date, 'YYYY-MM')
    WHERE a.id = p_asset
  ),
  bonus AS (
    SELECT
      coalesce(b.weekday_bonus, 0) AS weekday_bonus,
      coalesce(b.weekend_bonus, 0) AS weekend_bonus
    FROM public.asset_invite_bonuses b
    WHERE b.asset_id = p_asset
      AND b.month_start = date_trunc('month', p_date)::date
  ),
  used AS (
    SELECT count(*) AS c
    FROM public.invitations i
    WHERE i.asset_id = p_asset
      AND i.day_type = p_day_type
      AND date_trunc('month', i.visit_date) = date_trunc('month', p_date)
      AND (
        i.status = 'validated'
        OR (i.status = 'issued' AND i.visit_date >= public.today_beirut())
      )
  )
  SELECT greatest(
    CASE
      WHEN (SELECT quota_mode FROM allowance) = 'manual' THEN
        CASE
          WHEN (SELECT handed_over_at FROM allowance) IS NOT NULL
            THEN coalesce((SELECT manual_quota FROM allowance), 0)
          ELSE 0
        END
      ELSE
        (SELECT resort_default FROM allowance)
        + CASE
            WHEN p_day_type = 'weekend'
              THEN coalesce((SELECT weekend_bonus FROM bonus), 0)
            ELSE coalesce((SELECT weekday_bonus FROM bonus), 0)
          END
    END
    - (SELECT c FROM used),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_invitation(
  p_asset uuid,
  p_invitee_name text,
  p_invitee_phone text,
  p_visit_date date
)
RETURNS public.invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text;
  wknd integer[];
  dtype text;
  rem integer;
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
  v_quota_mode text;
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
    coalesce(r.invitation_quota_mode, 'automatic'),
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
    v_quota_mode,
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

  IF v_quota_mode = 'manual'
     AND NOT EXISTS (
       SELECT 1
       FROM public.asset_period_quotas q
       WHERE q.asset_id = p_asset
         AND q.period_ym = public.current_period_ym()
         AND q.handed_over_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'NOT_HANDED';
  END IF;

  IF asset_type = 'cabine' AND cabine_paid THEN
    pay_status := 'pending';
  END IF;

  dtype := CASE
    WHEN extract(dow FROM p_visit_date)::integer = ANY (wknd) THEN 'weekend'
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

    SELECT count(*)::integer
    INTO v_used
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
