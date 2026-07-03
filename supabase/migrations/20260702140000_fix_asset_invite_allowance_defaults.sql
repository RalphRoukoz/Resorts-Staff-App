-- Fix allowance RPC null totals when no bonus row exists, backfill asset limits from resort defaults,
-- and auto-populate limits on new assets.

-- Backfill existing units with null limits from resort configuration
UPDATE public.assets a
SET
  weekday_limit = CASE
    WHEN a.asset_type = 'cabine' THEN r.cabine_weekday_limit
    ELSE r.chalet_weekday_limit
  END,
  weekend_limit = CASE
    WHEN a.asset_type = 'cabine' THEN r.cabine_weekend_limit
    ELSE r.chalet_weekend_limit
  END
FROM public.resorts r
WHERE r.id = a.resort_id
  AND (a.weekday_limit IS NULL OR a.weekend_limit IS NULL);

-- Ensure new/updated assets inherit resort defaults when limits are omitted
CREATE OR REPLACE FUNCTION public.assets_apply_resort_default_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_weekday int;
  v_weekend int;
BEGIN
  IF NEW.weekday_limit IS NULL OR NEW.weekend_limit IS NULL THEN
    IF NEW.asset_type = 'cabine' THEN
      SELECT r.cabine_weekday_limit, r.cabine_weekend_limit
        INTO v_weekday, v_weekend
        FROM public.resorts r
       WHERE r.id = NEW.resort_id;
    ELSE
      SELECT r.chalet_weekday_limit, r.chalet_weekend_limit
        INTO v_weekday, v_weekend
        FROM public.resorts r
       WHERE r.id = NEW.resort_id;
    END IF;

    IF NEW.weekday_limit IS NULL THEN
      NEW.weekday_limit := coalesce(v_weekday, 0);
    END IF;
    IF NEW.weekend_limit IS NULL THEN
      NEW.weekend_limit := coalesce(v_weekend, 0);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_apply_resort_default_limits ON public.assets;
CREATE TRIGGER assets_apply_resort_default_limits
  BEFORE INSERT OR UPDATE ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.assets_apply_resort_default_limits();

-- Fix asset_invite_allowance: bonus SELECT INTO was nulling totals when no bonus row exists
CREATE OR REPLACE FUNCTION public.asset_invite_allowance(p_asset uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_resort_id uuid;
  v_asset_type text;
  v_asset_weekday_limit int;
  v_asset_weekend_limit int;
  v_month_start date;
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
