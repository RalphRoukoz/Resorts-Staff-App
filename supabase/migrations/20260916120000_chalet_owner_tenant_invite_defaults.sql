-- Optional owner vs tenant chalet invitation defaults for manual hand-over prefills.

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS chalet_owner_tenant_limits_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chalet_owner_weekday_limit integer,
  ADD COLUMN IF NOT EXISTS chalet_owner_weekend_limit integer,
  ADD COLUMN IF NOT EXISTS chalet_tenant_weekday_limit integer,
  ADD COLUMN IF NOT EXISTS chalet_tenant_weekend_limit integer;

UPDATE public.resorts
SET
  chalet_owner_weekday_limit = coalesce(chalet_owner_weekday_limit, chalet_weekday_limit, 0),
  chalet_owner_weekend_limit = coalesce(chalet_owner_weekend_limit, chalet_weekend_limit, 0),
  chalet_tenant_weekday_limit = coalesce(chalet_tenant_weekday_limit, chalet_weekday_limit, 0),
  chalet_tenant_weekend_limit = coalesce(chalet_tenant_weekend_limit, chalet_weekend_limit, 0);

ALTER TABLE public.resorts
  ALTER COLUMN chalet_owner_weekday_limit SET DEFAULT 0,
  ALTER COLUMN chalet_owner_weekend_limit SET DEFAULT 0,
  ALTER COLUMN chalet_tenant_weekday_limit SET DEFAULT 0,
  ALTER COLUMN chalet_tenant_weekend_limit SET DEFAULT 0;

ALTER TABLE public.resorts
  ALTER COLUMN chalet_owner_weekday_limit SET NOT NULL,
  ALTER COLUMN chalet_owner_weekend_limit SET NOT NULL,
  ALTER COLUMN chalet_tenant_weekday_limit SET NOT NULL,
  ALTER COLUMN chalet_tenant_weekend_limit SET NOT NULL;

COMMENT ON COLUMN public.resorts.chalet_owner_tenant_limits_enabled IS
  'When true, hand-over prefills use owner vs tenant chalet limit pairs based on active tenancy.';

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
  v_owner_tenant_enabled boolean;
  v_owner_weekday integer;
  v_owner_weekend integer;
  v_tenant_weekday integer;
  v_tenant_weekend integer;
  v_today date := public.today_beirut();
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
    r.cabine_weekday_limit, r.cabine_weekend_limit,
    r.chalet_owner_tenant_limits_enabled,
    r.chalet_owner_weekday_limit, r.chalet_owner_weekend_limit,
    r.chalet_tenant_weekday_limit, r.chalet_tenant_weekend_limit
  INTO
    v_quota_mode, v_cabine_invites_enabled,
    v_chalet_weekday_limit, v_chalet_weekend_limit,
    v_cabine_weekday_limit, v_cabine_weekend_limit,
    v_owner_tenant_enabled,
    v_owner_weekday, v_owner_weekend,
    v_tenant_weekday, v_tenant_weekend
  FROM public.resorts r WHERE r.id = p_resort_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  v_month_start := to_date(v_period_ym || '-01', 'YYYY-MM-DD');

  RETURN jsonb_build_object(
    'ok', true,
    'period_ym', v_period_ym,
    'quota_mode', v_quota_mode,
    'chalet_owner_tenant_limits_enabled', coalesce(v_owner_tenant_enabled, false),
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
          'default_weekend', u.default_weekend,
          'occupancy', u.occupancy,
          'is_rented', u.is_rented
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
          CASE
            WHEN a.asset_type = 'cabine' THEN coalesce(v_cabine_weekday_limit, 0)
            WHEN coalesce(v_owner_tenant_enabled, false)
              AND EXISTS (
                SELECT 1 FROM public.tenancies t
                WHERE t.asset_id = a.id
                  AND t.starts_on <= v_today
                  AND t.ends_on >= v_today
              )
              THEN coalesce(v_tenant_weekday, 0)
            WHEN coalesce(v_owner_tenant_enabled, false)
              THEN coalesce(v_owner_weekday, 0)
            ELSE coalesce(v_chalet_weekday_limit, 0)
          END AS default_weekday,
          CASE
            WHEN a.asset_type = 'cabine' THEN coalesce(v_cabine_weekend_limit, 0)
            WHEN coalesce(v_owner_tenant_enabled, false)
              AND EXISTS (
                SELECT 1 FROM public.tenancies t
                WHERE t.asset_id = a.id
                  AND t.starts_on <= v_today
                  AND t.ends_on >= v_today
              )
              THEN coalesce(v_tenant_weekend, 0)
            WHEN coalesce(v_owner_tenant_enabled, false)
              THEN coalesce(v_owner_weekend, 0)
            ELSE coalesce(v_chalet_weekend_limit, 0)
          END AS default_weekend,
          CASE
            WHEN a.asset_type = 'cabine' THEN 'n/a'
            WHEN EXISTS (
              SELECT 1 FROM public.tenancies t
              WHERE t.asset_id = a.id
                AND t.starts_on <= v_today
                AND t.ends_on >= v_today
            ) THEN 'rented'
            ELSE 'owner'
          END AS occupancy,
          CASE
            WHEN a.asset_type = 'cabine' THEN false
            ELSE EXISTS (
              SELECT 1 FROM public.tenancies t
              WHERE t.asset_id = a.id
                AND t.starts_on <= v_today
                AND t.ends_on >= v_today
            )
          END AS is_rented
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

-- Extend admin settings RPC (new optional params at end).
DROP FUNCTION IF EXISTS public.update_resort_admin_settings(uuid, integer, integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.update_resort_admin_settings(
  p_resort_id uuid,
  p_chalet_weekday_limit integer,
  p_chalet_weekend_limit integer,
  p_daily_invitation_cap integer DEFAULT NULL,
  p_max_advance_days integer DEFAULT NULL,
  p_distinct_guests_flag_chalet integer DEFAULT NULL,
  p_distinct_guests_flag_cabine integer DEFAULT NULL,
  p_chalet_owner_tenant_limits_enabled boolean DEFAULT NULL,
  p_chalet_owner_weekday_limit integer DEFAULT NULL,
  p_chalet_owner_weekend_limit integer DEFAULT NULL,
  p_chalet_tenant_weekday_limit integer DEFAULT NULL,
  p_chalet_tenant_weekend_limit integer DEFAULT NULL
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

  IF p_chalet_owner_weekday_limit IS NOT NULL AND p_chalet_owner_weekday_limit < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_CHALET_LIMIT');
  END IF;
  IF p_chalet_owner_weekend_limit IS NOT NULL AND p_chalet_owner_weekend_limit < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_CHALET_LIMIT');
  END IF;
  IF p_chalet_tenant_weekday_limit IS NOT NULL AND p_chalet_tenant_weekday_limit < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_CHALET_LIMIT');
  END IF;
  IF p_chalet_tenant_weekend_limit IS NOT NULL AND p_chalet_tenant_weekend_limit < 0 THEN
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
    distinct_guests_flag_cabine = COALESCE(p_distinct_guests_flag_cabine, distinct_guests_flag_cabine),
    chalet_owner_tenant_limits_enabled = COALESCE(p_chalet_owner_tenant_limits_enabled, chalet_owner_tenant_limits_enabled),
    chalet_owner_weekday_limit = COALESCE(p_chalet_owner_weekday_limit, chalet_owner_weekday_limit),
    chalet_owner_weekend_limit = COALESCE(p_chalet_owner_weekend_limit, chalet_owner_weekend_limit),
    chalet_tenant_weekday_limit = COALESCE(p_chalet_tenant_weekday_limit, chalet_tenant_weekday_limit),
    chalet_tenant_weekend_limit = COALESCE(p_chalet_tenant_weekend_limit, chalet_tenant_weekend_limit)
  WHERE id = p_resort_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'RESORT_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.update_resort_admin_settings IS
  'Resort staff: update chalet default invite limits (legacy + optional owner/tenant pairs) and anti-resale settings.';

GRANT EXECUTE ON FUNCTION public.update_resort_admin_settings(
  uuid, integer, integer, integer, integer, integer, integer, boolean, integer, integer, integer, integer
) TO authenticated;
