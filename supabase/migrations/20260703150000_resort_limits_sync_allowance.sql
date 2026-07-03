-- Resort default limits are the source of truth for allowance base caps.
-- Sync asset rows when resort limits change so all consumers stay consistent.

CREATE OR REPLACE FUNCTION public.resorts_sync_asset_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.chalet_weekday_limit IS DISTINCT FROM NEW.chalet_weekday_limit
     OR OLD.chalet_weekend_limit IS DISTINCT FROM NEW.chalet_weekend_limit THEN
    UPDATE public.assets
       SET weekday_limit = NEW.chalet_weekday_limit,
           weekend_limit = NEW.chalet_weekend_limit
     WHERE resort_id = NEW.id
       AND asset_type = 'chalet';
  END IF;

  IF OLD.cabine_weekday_limit IS DISTINCT FROM NEW.cabine_weekday_limit
     OR OLD.cabine_weekend_limit IS DISTINCT FROM NEW.cabine_weekend_limit THEN
    UPDATE public.assets
       SET weekday_limit = NEW.cabine_weekday_limit,
           weekend_limit = NEW.cabine_weekend_limit
     WHERE resort_id = NEW.id
       AND asset_type = 'cabine';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resorts_sync_asset_limits ON public.resorts;
CREATE TRIGGER resorts_sync_asset_limits
  AFTER UPDATE ON public.resorts
  FOR EACH ROW
  EXECUTE FUNCTION public.resorts_sync_asset_limits();

CREATE OR REPLACE FUNCTION public.asset_invite_allowance(p_asset uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resort_id uuid;
  v_asset_type text;
  v_month_start date;
  v_cabine_limit_invites boolean;
  base_wd int;
  base_we int;
  bonus_wd int;
  bonus_we int;
  used_wd int;
  used_we int;
  total_wd int;
  total_we int;
BEGIN
  SELECT a.resort_id, a.asset_type
    INTO v_resort_id, v_asset_type
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
    SELECT coalesce(r.cabine_weekday_limit, 0), coalesce(r.cabine_weekend_limit, 0)
      INTO base_wd, base_we
      FROM public.resorts r
     WHERE r.id = v_resort_id;
  ELSE
    SELECT coalesce(r.chalet_weekday_limit, 0), coalesce(r.chalet_weekend_limit, 0)
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

  total_wd := base_wd + bonus_wd;
  total_we := base_we + bonus_we;

  RETURN jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'weekday', jsonb_build_object(
      'base', base_wd,
      'bonus', bonus_wd,
      'total', total_wd,
      'used', used_wd,
      'remaining', greatest(total_wd - used_wd, 0)
    ),
    'weekend', jsonb_build_object(
      'base', base_we,
      'bonus', bonus_we,
      'total', total_we,
      'used', used_we,
      'remaining', greatest(total_we - used_we, 0)
    )
  );
END;
$$;
