-- Fix ambiguous month_start (PL/pgSQL var vs column) and add remove/adjust RPC.

CREATE OR REPLACE FUNCTION public.grant_asset_invite_bonus(
  p_asset uuid,
  p_weekday_add integer,
  p_weekend_add integer
)
RETURNS asset_invite_bonuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_resort_id uuid;
  v_month_start date;
  row public.asset_invite_bonuses;
begin
  if coalesce(p_weekday_add, 0) < 0 or coalesce(p_weekend_add, 0) < 0 then
    raise exception 'INVALID_BONUS';
  end if;
  if coalesce(p_weekday_add, 0) = 0 and coalesce(p_weekend_add, 0) = 0 then
    raise exception 'NO_BONUS';
  end if;

  select a.resort_id into v_resort_id from public.assets a where a.id = p_asset;
  if v_resort_id is null then raise exception 'NOT_FOUND'; end if;

  if not public.staff_has_permission(v_resort_id, 'invitations.bonus')
     and not public.is_staff(v_resort_id, 'admin') then
    raise exception 'FORBIDDEN';
  end if;

  v_month_start := date_trunc('month', public.today_beirut())::date;

  insert into public.asset_invite_bonuses (asset_id, month_start, weekday_bonus, weekend_bonus)
  values (p_asset, v_month_start, coalesce(p_weekday_add, 0), coalesce(p_weekend_add, 0))
  on conflict (asset_id, month_start) do update
    set weekday_bonus = public.asset_invite_bonuses.weekday_bonus + excluded.weekday_bonus,
        weekend_bonus = public.asset_invite_bonuses.weekend_bonus + excluded.weekend_bonus,
        updated_at = now()
  returning * into row;

  return row;
end;
$function$;

-- Subtract bonus invites for the current month; clamps each bonus at 0.
CREATE OR REPLACE FUNCTION public.remove_asset_invite_bonus(
  p_asset uuid,
  p_weekday_remove integer,
  p_weekend_remove integer
)
RETURNS asset_invite_bonuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_resort_id uuid;
  v_month_start date;
  row public.asset_invite_bonuses;
  v_wd int := greatest(coalesce(p_weekday_remove, 0), 0);
  v_we int := greatest(coalesce(p_weekend_remove, 0), 0);
begin
  if v_wd = 0 and v_we = 0 then
    raise exception 'NO_BONUS';
  end if;

  select a.resort_id into v_resort_id from public.assets a where a.id = p_asset;
  if v_resort_id is null then raise exception 'NOT_FOUND'; end if;

  if not public.staff_has_permission(v_resort_id, 'invitations.bonus')
     and not public.is_staff(v_resort_id, 'admin') then
    raise exception 'FORBIDDEN';
  end if;

  v_month_start := date_trunc('month', public.today_beirut())::date;

  insert into public.asset_invite_bonuses (asset_id, month_start, weekday_bonus, weekend_bonus)
  values (p_asset, v_month_start, 0, 0)
  on conflict (asset_id, month_start) do update
    set weekday_bonus = greatest(public.asset_invite_bonuses.weekday_bonus - v_wd, 0),
        weekend_bonus = greatest(public.asset_invite_bonuses.weekend_bonus - v_we, 0),
        updated_at = now()
  returning * into row;

  return row;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_asset_invite_bonus(uuid, integer, integer) TO authenticated;
