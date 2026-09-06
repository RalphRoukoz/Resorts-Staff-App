-- Hand-over defaults follow live resort-type quotas from superadmin,
-- not stale per-asset weekday_limit / weekend_limit overrides.

CREATE OR REPLACE FUNCTION public.list_resort_invite_quotas(
  p_resort_id uuid,
  p_period_ym text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ) THEN RETURN jsonb_build_object('error', 'NOT_AUTHORIZED'); END IF;

  IF v_period_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN jsonb_build_object('error', 'INVALID_PERIOD'); END IF;

  SELECT
    r.invitation_quota_mode, r.cabine_invites_enabled,
    r.chalet_weekday_limit, r.chalet_weekend_limit,
    r.cabine_weekday_limit, r.cabine_weekend_limit
  INTO
    v_quota_mode, v_cabine_invites_enabled,
    v_chalet_weekday_limit, v_chalet_weekend_limit,
    v_cabine_weekday_limit, v_cabine_weekend_limit
  FROM public.resorts r WHERE r.id = p_resort_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
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
        ) ORDER BY u.label, u.asset_id
      )
      FROM (
        SELECT
          a.id AS asset_id,
          a.label,
          a.asset_type,
          CASE
            WHEN v_quota_mode = 'automatic' THEN
              coalesce(a.weekday_limit, CASE WHEN a.asset_type = 'cabine' THEN v_cabine_weekday_limit ELSE v_chalet_weekday_limit END, 0)
              + coalesce(b.weekday_bonus, 0)
            WHEN q.handed_over_at IS NOT NULL THEN q.weekday_quota
            ELSE NULL
          END AS weekday_quota,
          CASE
            WHEN v_quota_mode = 'automatic' THEN
              coalesce(a.weekend_limit, CASE WHEN a.asset_type = 'cabine' THEN v_cabine_weekend_limit ELSE v_chalet_weekend_limit END, 0)
              + coalesce(b.weekend_bonus, 0)
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
          -- Hand-over prefill: always current resort-type defaults from superadmin.
          CASE
            WHEN a.asset_type = 'cabine' THEN coalesce(v_cabine_weekday_limit, 0)
            ELSE coalesce(v_chalet_weekday_limit, 0)
          END AS default_weekday,
          CASE
            WHEN a.asset_type = 'cabine' THEN coalesce(v_cabine_weekend_limit, 0)
            ELSE coalesce(v_chalet_weekend_limit, 0)
          END AS default_weekend
        FROM public.assets a
        LEFT JOIN public.asset_period_quotas q ON q.asset_id = a.id AND q.period_ym = v_period_ym
        LEFT JOIN public.asset_invite_bonuses b ON b.asset_id = a.id AND b.month_start = v_month_start
        LEFT JOIN LATERAL (
          SELECT
            count(*) FILTER (WHERE i.day_type = 'weekday')::integer AS weekday_used,
            count(*) FILTER (WHERE i.day_type = 'weekend')::integer AS weekend_used
          FROM public.invitations i
          WHERE i.asset_id = a.id
            AND i.visit_date >= v_month_start
            AND i.visit_date < (v_month_start + interval '1 month')::date
            AND (i.status = 'validated' OR (i.status = 'issued' AND i.visit_date >= public.today_beirut()))
        ) iu ON true
        WHERE a.resort_id = p_resort_id
          AND (a.asset_type <> 'cabine' OR v_cabine_invites_enabled)
      ) u
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_resort_invite_quotas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_resort_invite_quotas(uuid, text) TO authenticated;
