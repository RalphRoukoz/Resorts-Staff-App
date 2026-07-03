-- Analytics CTE rewrite, indexes, platform RPCs, OTP rate limiting.

-- ---------------------------------------------------------------------------
-- Indexes for hot query paths
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS invitations_token_idx
  ON public.invitations (token);

CREATE INDEX IF NOT EXISTS invitations_asset_visit_status_idx
  ON public.invitations (asset_id, visit_date, status);

CREATE INDEX IF NOT EXISTS invitations_visit_date_status_idx
  ON public.invitations (visit_date, status);

CREATE INDEX IF NOT EXISTS invitations_validated_at_idx
  ON public.invitations (validated_at)
  WHERE status = 'validated';

CREATE INDEX IF NOT EXISTS assets_resort_label_idx
  ON public.assets (resort_id, label);

CREATE INDEX IF NOT EXISTS assets_owner_phone_idx
  ON public.assets (owner_phone);

CREATE INDEX IF NOT EXISTS assets_label_trgm_idx
  ON public.assets USING gin (label gin_trgm_ops);

CREATE INDEX IF NOT EXISTS assets_owner_phone_trgm_idx
  ON public.assets USING gin (owner_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tenancies_phone_dates_idx
  ON public.tenancies (tenant_phone, starts_on, ends_on);

CREATE INDEX IF NOT EXISTS resort_staff_user_resort_idx
  ON public.resort_staff (user_id, resort_id);

CREATE INDEX IF NOT EXISTS asset_invite_bonuses_asset_month_idx
  ON public.asset_invite_bonuses (asset_id, month_start);

CREATE INDEX IF NOT EXISTS announcements_resort_created_idx
  ON public.announcements (resort_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- OTP eligibility rate-limit log (used by edge function via service role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otp_eligibility_attempts (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  ip_hash text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_eligibility_attempts_phone_idx
  ON public.otp_eligibility_attempts (phone, attempted_at DESC);

CREATE INDEX IF NOT EXISTS otp_eligibility_attempts_ip_idx
  ON public.otp_eligibility_attempts (ip_hash, attempted_at DESC);

ALTER TABLE public.otp_eligibility_attempts ENABLE ROW LEVEL SECURITY;

-- No client policies: only service role / SECURITY DEFINER functions access this table.

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible_core(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_today date;
BEGIN
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone) < 8 THEN
    RETURN false;
  END IF;

  v_today := (timezone('Asia/Beirut', now()))::date;

  IF EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.owner_phone = v_phone
       OR v_phone = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenancies t
    WHERE t.tenant_phone = v_phone
      AND t.starts_on <= v_today
      AND t.ends_on >= v_today
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible_rate_limited(
  p_phone text,
  p_ip_hash text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_ip text;
  v_phone_count int;
  v_ip_count int;
  v_eligible boolean;
BEGIN
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_ip := coalesce(nullif(trim(p_ip_hash), ''), 'unknown');

  IF length(v_phone) < 8 THEN
    RETURN jsonb_build_object('eligible', false);
  END IF;

  SELECT count(*)::int INTO v_phone_count
    FROM public.otp_eligibility_attempts
   WHERE phone = v_phone
     AND attempted_at > now() - interval '15 minutes';

  IF v_phone_count >= 5 THEN
    RETURN jsonb_build_object('eligible', false, 'error', 'RATE_LIMITED');
  END IF;

  SELECT count(*)::int INTO v_ip_count
    FROM public.otp_eligibility_attempts
   WHERE ip_hash = v_ip
     AND attempted_at > now() - interval '15 minutes';

  IF v_ip_count >= 30 THEN
    RETURN jsonb_build_object('eligible', false, 'error', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.otp_eligibility_attempts (phone, ip_hash)
  VALUES (v_phone, v_ip);

  v_eligible := public.check_owner_login_eligible_core(v_phone);

  RETURN jsonb_build_object('eligible', v_eligible);
END;
$$;

-- Replace direct anon RPC with rate-limited service-only path
CREATE OR REPLACE FUNCTION public.check_owner_login_eligible(p_phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_owner_login_eligible_core(p_phone);
$$;

REVOKE ALL ON FUNCTION public.check_owner_login_eligible(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_owner_login_eligible_rate_limited(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_owner_login_eligible_rate_limited(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Analytics v2: single-pass CTE + paginated guests
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_visit_analytics_v2(
  p_resort_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_guest_limit int DEFAULT 100,
  p_guest_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from date;
  v_to date;
  v_guest text;
  v_limit int;
  v_offset int;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT public.caller_has_resort_permission(p_resort_id, 'analytics.read') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_from := coalesce(p_date_from, date_trunc('month', timezone('Asia/Beirut', now()))::date);
  v_to := coalesce(p_date_to, (timezone('Asia/Beirut', now()))::date);
  v_guest := nullif(trim(coalesce(p_guest_name, '')), '');
  v_limit := greatest(least(coalesce(p_guest_limit, 100), 500), 1);
  v_offset := greatest(coalesce(p_guest_offset, 0), 0);

  WITH filtered AS (
    SELECT
      i.invitee_name,
      a.label AS unit_label,
      i.day_type,
      extract(day FROM (i.validated_at AT TIME ZONE 'Asia/Beirut'))::int AS day_of_month,
      (i.validated_at AT TIME ZONE 'Asia/Beirut')::date AS validated_date
    FROM public.invitations i
    JOIN public.assets a ON a.id = i.asset_id
    WHERE a.resort_id = p_resort_id
      AND i.status = 'validated'
      AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date BETWEEN v_from AND v_to
      AND (p_asset_id IS NULL OR i.asset_id = p_asset_id)
      AND (v_guest IS NULL OR i.invitee_name ILIKE '%' || v_guest || '%')
  ),
  guest_groups AS (
    SELECT
      invitee_name,
      unit_label,
      count(*)::int AS visits,
      max(validated_date)::text AS last_visit
    FROM filtered
    GROUP BY invitee_name, unit_label
  ),
  guest_page AS (
    SELECT invitee_name, unit_label, visits, last_visit
    FROM guest_groups
    ORDER BY visits DESC, invitee_name
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'visits', (SELECT count(*)::int FROM filtered),
      'unique_guests', (SELECT count(DISTINCT lower(trim(invitee_name)))::int FROM filtered)
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day_of_month, 'visits', c) ORDER BY day_of_month)
      FROM (
        SELECT day_of_month, count(*)::int AS c
        FROM filtered
        GROUP BY day_of_month
      ) d
    ), '[]'::jsonb),
    'by_unit', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', unit_label, 'visits', c) ORDER BY c DESC)
      FROM (
        SELECT unit_label, count(*)::int AS c
        FROM filtered
        GROUP BY unit_label
      ) u
    ), '[]'::jsonb),
    'guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', invitee_name,
        'unit', unit_label,
        'visits', visits,
        'last_visit', last_visit
      ) ORDER BY visits DESC)
      FROM guest_page
    ), '[]'::jsonb),
    'guests_total', (SELECT count(*)::int FROM guest_groups),
    'weekday', (SELECT count(*)::int FROM filtered WHERE day_type = 'weekday'),
    'weekend', (SELECT count(*)::int FROM filtered WHERE day_type = 'weekend'),
    'date_from', v_from,
    'date_to', v_to,
    'guest_limit', v_limit,
    'guest_offset', v_offset
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_visit_analytics_v2(uuid, uuid, date, date, text, int, int) TO authenticated;

-- Drop old 5-arg overload if it exists (signature changed)
DROP FUNCTION IF EXISTS public.resort_visit_analytics_v2(uuid, uuid, date, date, text);

-- ---------------------------------------------------------------------------
-- Super-admin: resort list with stats in one query
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_resorts_with_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      to_jsonb(r) || jsonb_build_object(
        'chalet_count', coalesce(a.unit_count, 0),
        'invitation_count', coalesce(i.invite_count, 0)
      )
      ORDER BY r.name
    )
    FROM public.resorts r
    LEFT JOIN (
      SELECT resort_id, count(*)::int AS unit_count
      FROM public.assets
      GROUP BY resort_id
    ) a ON a.resort_id = r.id
    LEFT JOIN (
      SELECT a2.resort_id, count(*)::int AS invite_count
      FROM public.invitations i2
      JOIN public.assets a2 ON a2.id = i2.asset_id
      GROUP BY a2.resort_id
    ) i ON i.resort_id = r.id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_resorts_with_stats() TO authenticated;

-- ---------------------------------------------------------------------------
-- Super-admin: platform overview in one query
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_overview_stats(p_month_start date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  v_month_start := coalesce(
    p_month_start,
    date_trunc('month', timezone('Asia/Beirut', now()))::date
  );

  RETURN jsonb_build_object(
    'resort_count', (SELECT count(*)::int FROM public.resorts),
    'chalet_count', (SELECT count(*)::int FROM public.assets),
    'invitations_this_month', (
      SELECT count(*)::int FROM public.invitations
      WHERE visit_date >= v_month_start
    ),
    'check_ins_this_month', (
      SELECT count(*)::int FROM public.invitations
      WHERE status = 'validated'
        AND validated_at >= v_month_start::timestamptz
    ),
    'month_start', v_month_start
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_overview_stats(date) TO authenticated;

-- Purge eligibility attempts older than 7 days (when pg_cron available)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_otp_eligibility_attempts') THEN
      PERFORM cron.schedule(
        'purge_otp_eligibility_attempts',
        '15 3 * * *',
        $cron$DELETE FROM public.otp_eligibility_attempts WHERE attempted_at < now() - interval '7 days';$cron$
      );
    END IF;
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_object OR insufficient_privilege THEN
    NULL;
END;
$do$;
