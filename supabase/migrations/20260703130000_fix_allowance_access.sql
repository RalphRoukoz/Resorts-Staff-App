-- Fix allowance visibility for staff (dashboard/units permissions) and owners (owner_phones array).

CREATE OR REPLACE FUNCTION public.asset_controller(p_asset uuid, p_date date)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT t.tenant_phone
        FROM public.tenancies t
       WHERE t.asset_id = p_asset
         AND p_date BETWEEN t.starts_on AND t.ends_on
       ORDER BY t.starts_on DESC
       LIMIT 1
    ),
    (
      SELECT a.owner_phone
        FROM public.assets a
       WHERE a.id = p_asset
    ),
    (
      SELECT op
        FROM public.assets a
        CROSS JOIN LATERAL unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS op
       WHERE a.id = p_asset
       ORDER BY op
       LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_controls_asset(p_asset uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
      LEFT JOIN LATERAL (
        SELECT t.tenant_phone
          FROM public.tenancies t
         WHERE t.asset_id = a.id
           AND p_date BETWEEN t.starts_on AND t.ends_on
         ORDER BY t.starts_on DESC
         LIMIT 1
      ) ten ON true
     WHERE a.id = p_asset
       AND public.current_user_phone() IS NOT NULL
       AND (
         public.current_user_phone() = ten.tenant_phone
         OR public.current_user_phone() = a.owner_phone
         OR public.current_user_phone() = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_can_read_asset_allowance(
  p_resort_id uuid,
  p_asset uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.caller_has_resort_permission(p_resort_id, 'dashboard.read') THEN
    RETURN true;
  END IF;

  IF public.caller_has_resort_permission(p_resort_id, 'units.write') THEN
    RETURN true;
  END IF;

  RETURN public.caller_controls_asset(p_asset, public.today_beirut());
END;
$$;

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
BEGIN
  SELECT a.resort_id, a.asset_type, a.weekday_limit, a.weekend_limit
    INTO v_resort_id, v_asset_type, v_asset_weekday_limit, v_asset_weekend_limit
    FROM public.assets a
   WHERE a.id = p_asset;

  IF v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF NOT public.caller_can_read_asset_allowance(v_resort_id, p_asset) THEN
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

CREATE OR REPLACE FUNCTION public.asset_invite_allowances_batch(p_asset_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_id uuid;
  v_row jsonb;
  v_resort_id uuid;
  v_resort_count int;
BEGIN
  IF auth.uid() IS NULL OR p_asset_ids IS NULL OR cardinality(p_asset_ids) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT count(DISTINCT a.resort_id), min(a.resort_id)
    INTO v_resort_count, v_resort_id
    FROM public.assets a
   WHERE a.id = ANY (p_asset_ids);

  IF v_resort_count <> 1 OR v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ASSETS');
  END IF;

  IF NOT public.caller_has_resort_permission(v_resort_id, 'dashboard.read')
     AND NOT public.caller_has_resort_permission(v_resort_id, 'units.write') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  FOREACH v_id IN ARRAY p_asset_ids
  LOOP
    v_row := public.asset_invite_allowance(v_id);
    IF v_row ? 'error' THEN
      CONTINUE;
    END IF;
    v_result := v_result || jsonb_build_object(v_id::text, v_row);
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.caller_controls_asset(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_can_read_asset_allowance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asset_invite_allowance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asset_invite_allowances_batch(uuid[]) TO authenticated;
