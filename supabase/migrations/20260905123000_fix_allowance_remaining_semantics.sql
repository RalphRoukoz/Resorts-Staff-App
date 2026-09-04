-- Restore automatic allowance semantics and ensure quota audit deltas reflect
-- the change that was actually applied.

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
  v_cabine_limit_invites boolean;
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
    coalesce(r.invitation_quota_mode, 'automatic'),
    coalesce(r.cabine_limit_invites, true)
  INTO
    v_resort_id,
    v_asset_type,
    v_asset_weekday_limit,
    v_asset_weekend_limit,
    v_quota_mode,
    v_cabine_limit_invites
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

  IF v_asset_type = 'cabine' AND NOT v_cabine_limit_invites THEN
    RETURN jsonb_build_object(
      'month', to_char(v_month_start, 'YYYY-MM'),
      'quota_mode', 'automatic',
      'handed', NULL,
      'unlimited', true,
      'weekday', jsonb_build_object(
        'base', NULL,
        'bonus', 0,
        'total', NULL,
        'used', 0,
        'remaining', NULL
      ),
      'weekend', jsonb_build_object(
        'base', NULL,
        'bonus', 0,
        'total', NULL,
        'used', 0,
        'remaining', NULL
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
      a.asset_type = 'cabine'
        AND NOT coalesce(r.cabine_limit_invites, true) AS unlimited,
      CASE
        WHEN p_day_type = 'weekend' THEN a.weekend_limit
        ELSE a.weekday_limit
      END AS asset_limit,
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
  SELECT CASE
    WHEN (SELECT quota_mode FROM allowance) = 'automatic'
         AND (SELECT unlimited FROM allowance)
      THEN NULL
    ELSE greatest(
      CASE
        WHEN (SELECT quota_mode FROM allowance) = 'manual' THEN
          CASE
            WHEN (SELECT handed_over_at FROM allowance) IS NOT NULL
              THEN coalesce((SELECT manual_quota FROM allowance), 0)
            ELSE 0
          END
        ELSE
          coalesce(
            (SELECT asset_limit FROM allowance),
            (SELECT resort_default FROM allowance),
            0
          )
          + CASE
              WHEN p_day_type = 'weekend'
                THEN coalesce((SELECT weekend_bonus FROM bonus), 0)
              ELSE coalesce((SELECT weekday_bonus FROM bonus), 0)
            END
      END
      - (SELECT c FROM used),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_asset_invite_quota(
  p_asset uuid,
  p_weekday_delta integer,
  p_weekend_delta integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_quota_mode text;
  v_base_weekday_limit integer;
  v_base_weekend_limit integer;
  v_period_ym text := public.current_period_ym();
  v_month_start date := date_trunc('month', public.today_beirut())::date;
  v_weekday_delta integer := coalesce(p_weekday_delta, 0);
  v_weekend_delta integer := coalesce(p_weekend_delta, 0);
  v_effective_weekday_delta integer;
  v_effective_weekend_delta integer;
  v_weekday_used integer := 0;
  v_weekend_used integer := 0;
  v_weekday_before integer;
  v_weekend_before integer;
  v_weekday_after integer;
  v_weekend_after integer;
  v_handed_over_at timestamptz;
  v_action text;
  v_bonus_weekday integer := 0;
  v_bonus_weekend integer := 0;
BEGIN
  SELECT
    a.resort_id,
    coalesce(r.invitation_quota_mode, 'automatic'),
    coalesce(
      a.weekday_limit,
      CASE
        WHEN a.asset_type = 'cabine' THEN r.cabine_weekday_limit
        ELSE r.chalet_weekday_limit
      END,
      0
    ),
    coalesce(
      a.weekend_limit,
      CASE
        WHEN a.asset_type = 'cabine' THEN r.cabine_weekend_limit
        ELSE r.chalet_weekend_limit
      END,
      0
    )
  INTO
    v_resort_id,
    v_quota_mode,
    v_base_weekday_limit,
    v_base_weekend_limit
  FROM public.assets a
  JOIN public.resorts r ON r.id = a.resort_id
  WHERE a.id = p_asset;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT public.caller_can_manage_invite_quota(v_resort_id) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF v_weekday_delta = 0 AND v_weekend_delta = 0 THEN
    RETURN jsonb_build_object('error', 'NO_CHANGE');
  END IF;

  IF (v_weekday_delta > 0 AND v_weekend_delta < 0)
     OR (v_weekday_delta < 0 AND v_weekend_delta > 0) THEN
    RETURN jsonb_build_object('error', 'INVALID_DELTA');
  END IF;

  v_action := CASE
    WHEN v_weekday_delta > 0 OR v_weekend_delta > 0 THEN 'add'
    ELSE 'remove'
  END;

  PERFORM pg_advisory_xact_lock(hashtext(p_asset::text || ':' || v_period_ym));

  IF v_quota_mode = 'manual' THEN
    SELECT
      q.weekday_quota,
      q.weekend_quota,
      q.handed_over_at
    INTO
      v_weekday_before,
      v_weekend_before,
      v_handed_over_at
    FROM public.asset_period_quotas q
    WHERE q.asset_id = p_asset
      AND q.period_ym = v_period_ym
    FOR UPDATE;

    IF NOT FOUND OR v_handed_over_at IS NULL THEN
      RETURN jsonb_build_object('error', 'NOT_HANDED');
    END IF;

    SELECT
      count(*) FILTER (WHERE i.day_type = 'weekday')::integer,
      count(*) FILTER (WHERE i.day_type = 'weekend')::integer
    INTO v_weekday_used, v_weekend_used
    FROM public.invitations i
    WHERE i.asset_id = p_asset
      AND i.visit_date >= v_month_start
      AND i.visit_date < (v_month_start + interval '1 month')::date
      AND (
        i.status = 'validated'
        OR (i.status = 'issued' AND i.visit_date >= public.today_beirut())
      );

    IF (v_weekday_delta < 0
          AND abs(v_weekday_delta) > v_weekday_before - v_weekday_used)
       OR (v_weekend_delta < 0
          AND abs(v_weekend_delta) > v_weekend_before - v_weekend_used) THEN
      RETURN jsonb_build_object('error', 'INSUFFICIENT_QUOTA');
    END IF;

    v_weekday_after := v_weekday_before + v_weekday_delta;
    v_weekend_after := v_weekend_before + v_weekend_delta;

    UPDATE public.asset_period_quotas
    SET
      weekday_quota = v_weekday_after,
      weekend_quota = v_weekend_after,
      updated_at = now()
    WHERE asset_id = p_asset
      AND period_ym = v_period_ym;
  ELSE
    SELECT b.weekday_bonus, b.weekend_bonus
    INTO v_bonus_weekday, v_bonus_weekend
    FROM public.asset_invite_bonuses b
    WHERE b.asset_id = p_asset
      AND b.month_start = v_month_start
    FOR UPDATE;

    IF NOT FOUND THEN
      v_bonus_weekday := 0;
      v_bonus_weekend := 0;
    END IF;

    v_weekday_before := v_base_weekday_limit + v_bonus_weekday;
    v_weekend_before := v_base_weekend_limit + v_bonus_weekend;

    IF (v_weekday_delta < 0
          AND abs(v_weekday_delta) > v_bonus_weekday)
       OR (v_weekend_delta < 0
          AND abs(v_weekend_delta) > v_bonus_weekend) THEN
      RETURN jsonb_build_object('error', 'INSUFFICIENT_QUOTA');
    END IF;

    INSERT INTO public.asset_invite_bonuses AS b (
      asset_id,
      month_start,
      weekday_bonus,
      weekend_bonus
    )
    VALUES (
      p_asset,
      v_month_start,
      v_bonus_weekday + v_weekday_delta,
      v_bonus_weekend + v_weekend_delta
    )
    ON CONFLICT (asset_id, month_start) DO UPDATE
    SET
      weekday_bonus = excluded.weekday_bonus,
      weekend_bonus = excluded.weekend_bonus,
      updated_at = now()
    RETURNING weekday_bonus, weekend_bonus
    INTO v_bonus_weekday, v_bonus_weekend;

    v_weekday_after := v_base_weekday_limit + v_bonus_weekday;
    v_weekend_after := v_base_weekend_limit + v_bonus_weekend;
  END IF;

  v_effective_weekday_delta := v_weekday_after - v_weekday_before;
  v_effective_weekend_delta := v_weekend_after - v_weekend_before;

  INSERT INTO public.invitation_quota_events (
    resort_id,
    asset_id,
    period_ym,
    action,
    weekday_delta,
    weekend_delta,
    weekday_after,
    weekend_after,
    actor_user_id,
    actor_username,
    note
  )
  VALUES (
    v_resort_id,
    p_asset,
    v_period_ym,
    v_action,
    v_effective_weekday_delta,
    v_effective_weekend_delta,
    v_weekday_after,
    v_weekend_after,
    auth.uid(),
    public.staff_username_for_actor(v_resort_id),
    p_note
  );

  RETURN jsonb_build_object(
    'ok', true,
    'weekday_quota', v_weekday_after,
    'weekend_quota', v_weekend_after,
    'period_ym', v_period_ym,
    'quota_mode', v_quota_mode
  );
END;
$$;
