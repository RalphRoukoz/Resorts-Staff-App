-- Staff invitation quota hand-over, adjustment, listing, and audit-log RPCs.

CREATE OR REPLACE FUNCTION public.caller_can_manage_invite_quota(p_resort_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_resort_id IS NOT NULL
    AND (
      public.is_superadmin()
      OR public.is_staff(p_resort_id, 'admin')
      OR public.caller_has_resort_permission(p_resort_id, 'invitations.quota')
      OR public.caller_has_resort_permission(p_resort_id, 'invitations.bonus')
    );
$$;

CREATE OR REPLACE FUNCTION public.hand_over_asset_invite_quota(
  p_asset uuid,
  p_weekday integer,
  p_weekend integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_asset_type text;
  v_quota_mode text;
  v_cabine_invites_enabled boolean;
  v_period_ym text := public.current_period_ym();
  v_handed_over_at timestamptz;
BEGIN
  SELECT
    a.resort_id,
    a.asset_type,
    r.invitation_quota_mode,
    r.cabine_invites_enabled
  INTO
    v_resort_id,
    v_asset_type,
    v_quota_mode,
    v_cabine_invites_enabled
  FROM public.assets a
  JOIN public.resorts r ON r.id = a.resort_id
  WHERE a.id = p_asset;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT public.caller_can_manage_invite_quota(v_resort_id) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF v_quota_mode <> 'manual' THEN
    RETURN jsonb_build_object('error', 'NOT_MANUAL_MODE');
  END IF;

  IF v_asset_type = 'cabine' AND NOT v_cabine_invites_enabled THEN
    RETURN jsonb_build_object('error', 'CABINE_INVITES_DISABLED');
  END IF;

  -- Serialize first hand-over so concurrent calls cannot both succeed.
  PERFORM pg_advisory_xact_lock(hashtext(p_asset::text || ':' || v_period_ym));

  SELECT q.handed_over_at
  INTO v_handed_over_at
  FROM public.asset_period_quotas q
  WHERE q.asset_id = p_asset
    AND q.period_ym = v_period_ym
  FOR UPDATE;

  IF v_handed_over_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_HANDED');
  END IF;

  IF p_weekday IS NULL OR p_weekday < 0
     OR p_weekend IS NULL OR p_weekend < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_QUOTA');
  END IF;

  INSERT INTO public.asset_period_quotas (
    asset_id,
    resort_id,
    period_ym,
    weekday_quota,
    weekend_quota,
    handed_over_at,
    updated_at
  )
  VALUES (
    p_asset,
    v_resort_id,
    v_period_ym,
    p_weekday,
    p_weekend,
    now(),
    now()
  )
  ON CONFLICT (asset_id, period_ym) DO UPDATE
  SET
    resort_id = excluded.resort_id,
    weekday_quota = excluded.weekday_quota,
    weekend_quota = excluded.weekend_quota,
    handed_over_at = excluded.handed_over_at,
    updated_at = excluded.updated_at;

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
    'hand_over',
    p_weekday,
    p_weekend,
    p_weekday,
    p_weekend,
    auth.uid(),
    public.staff_username_for_actor(v_resort_id),
    p_note
  );

  RETURN jsonb_build_object(
    'ok', true,
    'weekday_quota', p_weekday,
    'weekend_quota', p_weekend,
    'period_ym', v_period_ym
  );
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
  v_asset_type text;
  v_quota_mode text;
  v_resort_weekday_limit integer;
  v_resort_weekend_limit integer;
  v_period_ym text := public.current_period_ym();
  v_month_start date := date_trunc('month', public.today_beirut())::date;
  v_weekday_delta integer := coalesce(p_weekday_delta, 0);
  v_weekend_delta integer := coalesce(p_weekend_delta, 0);
  v_weekday_used integer := 0;
  v_weekend_used integer := 0;
  v_weekday_after integer;
  v_weekend_after integer;
  v_handed_over_at timestamptz;
  v_action text;
  v_bonus public.asset_invite_bonuses%ROWTYPE;
BEGIN
  SELECT
    a.resort_id,
    a.asset_type,
    r.invitation_quota_mode,
    CASE
      WHEN a.asset_type = 'cabine' THEN r.cabine_weekday_limit
      ELSE r.chalet_weekday_limit
    END,
    CASE
      WHEN a.asset_type = 'cabine' THEN r.cabine_weekend_limit
      ELSE r.chalet_weekend_limit
    END
  INTO
    v_resort_id,
    v_asset_type,
    v_quota_mode,
    v_resort_weekday_limit,
    v_resort_weekend_limit
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
      v_weekday_after,
      v_weekend_after,
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

    v_weekday_after := greatest(v_weekday_used, v_weekday_after + v_weekday_delta);
    v_weekend_after := greatest(v_weekend_used, v_weekend_after + v_weekend_delta);

    UPDATE public.asset_period_quotas
    SET
      weekday_quota = v_weekday_after,
      weekend_quota = v_weekend_after,
      updated_at = now()
    WHERE asset_id = p_asset
      AND period_ym = v_period_ym;
  ELSE
    IF v_action = 'add' THEN
      INSERT INTO public.asset_invite_bonuses AS b (
        asset_id,
        month_start,
        weekday_bonus,
        weekend_bonus
      )
      VALUES (
        p_asset,
        v_month_start,
        v_weekday_delta,
        v_weekend_delta
      )
      ON CONFLICT (asset_id, month_start) DO UPDATE
      SET
        weekday_bonus = b.weekday_bonus + excluded.weekday_bonus,
        weekend_bonus = b.weekend_bonus + excluded.weekend_bonus,
        updated_at = now()
      RETURNING * INTO v_bonus;
    ELSE
      INSERT INTO public.asset_invite_bonuses AS b (
        asset_id,
        month_start,
        weekday_bonus,
        weekend_bonus
      )
      VALUES (p_asset, v_month_start, 0, 0)
      ON CONFLICT (asset_id, month_start) DO UPDATE
      SET
        weekday_bonus = greatest(b.weekday_bonus - abs(v_weekday_delta), 0),
        weekend_bonus = greatest(b.weekend_bonus - abs(v_weekend_delta), 0),
        updated_at = now()
      RETURNING * INTO v_bonus;
    END IF;

    v_weekday_after :=
      coalesce(v_resort_weekday_limit, 0)
      + v_bonus.weekday_bonus;
    v_weekend_after :=
      coalesce(v_resort_weekend_limit, 0)
      + v_bonus.weekend_bonus;
  END IF;

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
    v_weekday_delta,
    v_weekend_delta,
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

CREATE OR REPLACE FUNCTION public.list_resort_invite_quotas(
  p_resort_id uuid,
  p_period_ym text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_ym text := coalesce(p_period_ym, public.current_period_ym());
  v_month_start date;
  v_quota_mode text;
  v_cabine_invites_enabled boolean;
  v_chalet_weekday_limit integer;
  v_chalet_weekend_limit integer;
  v_cabine_weekday_limit integer;
  v_cabine_weekend_limit integer;
BEGIN
  IF NOT (
    public.caller_can_manage_invite_quota(p_resort_id)
    OR public.caller_has_resort_permission(p_resort_id, 'dashboard.read')
    OR public.is_staff(p_resort_id, 'admin')
    OR public.is_superadmin()
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF v_period_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('error', 'INVALID_PERIOD');
  END IF;

  SELECT
    r.invitation_quota_mode,
    r.cabine_invites_enabled,
    r.chalet_weekday_limit,
    r.chalet_weekend_limit,
    r.cabine_weekday_limit,
    r.cabine_weekend_limit
  INTO
    v_quota_mode,
    v_cabine_invites_enabled,
    v_chalet_weekday_limit,
    v_chalet_weekend_limit,
    v_cabine_weekday_limit,
    v_cabine_weekend_limit
  FROM public.resorts r
  WHERE r.id = p_resort_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  v_month_start := to_date(v_period_ym || '-01', 'YYYY-MM-DD');

  RETURN jsonb_build_object(
    'ok', true,
    'period_ym', v_period_ym,
    'quota_mode', v_quota_mode,
    'units', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'asset_id', u.asset_id,
          'label', u.label,
          'asset_type', u.asset_type,
          'weekday_quota', u.weekday_quota,
          'weekend_quota', u.weekend_quota,
          'weekday_used', u.weekday_used,
          'weekend_used', u.weekend_used,
          'handed_over_at', u.handed_over_at,
          'status', u.status,
          'default_weekday', u.default_weekday,
          'default_weekend', u.default_weekend
        )
        ORDER BY u.label, u.asset_id
      )
      FROM (
        SELECT
          a.id AS asset_id,
          a.label,
          a.asset_type,
          CASE
            WHEN v_quota_mode = 'automatic'
              THEN coalesce(
                a.weekday_limit,
                CASE
                  WHEN a.asset_type = 'cabine' THEN v_cabine_weekday_limit
                  ELSE v_chalet_weekday_limit
                END,
                0
              ) + coalesce(b.weekday_bonus, 0)
            WHEN q.handed_over_at IS NOT NULL THEN q.weekday_quota
            ELSE NULL
          END AS weekday_quota,
          CASE
            WHEN v_quota_mode = 'automatic'
              THEN coalesce(
                a.weekend_limit,
                CASE
                  WHEN a.asset_type = 'cabine' THEN v_cabine_weekend_limit
                  ELSE v_chalet_weekend_limit
                END,
                0
              ) + coalesce(b.weekend_bonus, 0)
            WHEN q.handed_over_at IS NOT NULL THEN q.weekend_quota
            ELSE NULL
          END AS weekend_quota,
          coalesce(iu.weekday_used, 0) AS weekday_used,
          coalesce(iu.weekend_used, 0) AS weekend_used,
          q.handed_over_at,
          CASE
            WHEN v_quota_mode = 'automatic' THEN 'automatic'
            WHEN q.handed_over_at IS NOT NULL THEN 'handed'
            ELSE 'not_handed'
          END AS status,
          coalesce(
            a.weekday_limit,
            CASE
              WHEN a.asset_type = 'cabine' THEN v_cabine_weekday_limit
              ELSE v_chalet_weekday_limit
            END,
            0
          ) AS default_weekday,
          coalesce(
            a.weekend_limit,
            CASE
              WHEN a.asset_type = 'cabine' THEN v_cabine_weekend_limit
              ELSE v_chalet_weekend_limit
            END,
            0
          ) AS default_weekend
        FROM public.assets a
        LEFT JOIN public.asset_period_quotas q
          ON q.asset_id = a.id
         AND q.period_ym = v_period_ym
        LEFT JOIN public.asset_invite_bonuses b
          ON b.asset_id = a.id
         AND b.month_start = v_month_start
        LEFT JOIN LATERAL (
          SELECT
            count(*) FILTER (WHERE i.day_type = 'weekday')::integer AS weekday_used,
            count(*) FILTER (WHERE i.day_type = 'weekend')::integer AS weekend_used
          FROM public.invitations i
          WHERE i.asset_id = a.id
            AND i.visit_date >= v_month_start
            AND i.visit_date < (v_month_start + interval '1 month')::date
            AND (
              i.status = 'validated'
              OR (i.status = 'issued' AND i.visit_date >= public.today_beirut())
            )
        ) iu ON true
        WHERE a.resort_id = p_resort_id
          AND (a.asset_type <> 'cabine' OR v_cabine_invites_enabled)
      ) u
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_invitation_quota_events(
  p_resort_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(least(coalesce(p_limit, 100), 200), 0);
BEGIN
  IF NOT (
    public.caller_can_manage_invite_quota(p_resort_id)
    OR public.caller_has_resort_permission(p_resort_id, 'dashboard.read')
    OR public.is_staff(p_resort_id, 'admin')
    OR public.is_superadmin()
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.resorts r WHERE r.id = p_resort_id) THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'events', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'asset_id', e.asset_id,
          'period_ym', e.period_ym,
          'action', e.action,
          'weekday_delta', e.weekday_delta,
          'weekend_delta', e.weekend_delta,
          'weekday_after', e.weekday_after,
          'weekend_after', e.weekend_after,
          'actor_username', e.actor_username,
          'note', e.note,
          'created_at', e.created_at,
          'unit_label', e.unit_label
        )
        ORDER BY e.created_at DESC, e.id DESC
      )
      FROM (
        SELECT
          q.id,
          q.asset_id,
          q.period_ym,
          q.action,
          q.weekday_delta,
          q.weekend_delta,
          q.weekday_after,
          q.weekend_after,
          q.actor_username,
          q.note,
          q.created_at,
          a.label AS unit_label
        FROM public.invitation_quota_events q
        JOIN public.assets a ON a.id = q.asset_id
        WHERE q.resort_id = p_resort_id
          AND (p_asset_id IS NULL OR q.asset_id = p_asset_id)
        ORDER BY q.created_at DESC, q.id DESC
        LIMIT v_limit
      ) e
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.caller_can_manage_invite_quota(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hand_over_asset_invite_quota(uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_asset_invite_quota(uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_resort_invite_quotas(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_invitation_quota_events(uuid, uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.caller_can_manage_invite_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hand_over_asset_invite_quota(uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_asset_invite_quota(uuid, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resort_invite_quotas(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_invitation_quota_events(uuid, uuid, integer) TO authenticated;
