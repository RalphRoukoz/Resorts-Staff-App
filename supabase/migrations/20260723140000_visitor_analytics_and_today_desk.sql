-- Visitor analytics RPC, today-desk aggregate, supporting indexes.

-- ---------------------------------------------------------------------------
-- Indexes (idempotent; visitor_announcements_resort_date_idx may already exist)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS visitor_announcements_resort_date_idx
  ON public.visitor_announcements (resort_id, visit_date, status);

CREATE INDEX IF NOT EXISTS invitations_asset_visit_date_desc_idx
  ON public.invitations (asset_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS invitations_token_idx
  ON public.invitations (token);

-- ---------------------------------------------------------------------------
-- Visitor analytics (mirrors resort_visit_analytics_v2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_visitor_analytics_v2(
  p_resort_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_guest_limit int DEFAULT 100,
  p_guest_offset int DEFAULT 0,
  p_unit_label text DEFAULT NULL
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
  v_unit text;
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
  v_unit := nullif(trim(coalesce(p_unit_label, '')), '');
  v_limit := greatest(least(coalesce(p_guest_limit, 100), 500), 1);
  v_offset := greatest(coalesce(p_guest_offset, 0), 0);

  WITH filtered AS (
    SELECT
      v.id,
      v.visitor_name,
      v.visitor_phone,
      v.visit_date,
      v.status,
      v.arrived_at,
      v.notes,
      a.label AS unit_label
    FROM public.visitor_announcements v
    JOIN public.assets a ON a.id = v.asset_id
    WHERE v.resort_id = p_resort_id
      AND v.visit_date BETWEEN v_from AND v_to
      AND (p_asset_id IS NULL OR v.asset_id = p_asset_id)
      AND (v_guest IS NULL OR v.visitor_name ILIKE '%' || v_guest || '%')
      AND (v_unit IS NULL OR a.label ILIKE '%' || v_unit || '%')
  ),
  guest_groups AS (
    SELECT
      visitor_name,
      unit_label,
      count(*) FILTER (WHERE status = 'arrived')::int AS visits,
      max(visit_date) FILTER (WHERE status = 'arrived')::text AS last_visit
    FROM filtered
    GROUP BY visitor_name, unit_label
  ),
  guest_page AS (
    SELECT visitor_name, unit_label, visits, last_visit
    FROM guest_groups
    WHERE visits > 0
    ORDER BY visits DESC, visitor_name
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'visits', (SELECT count(*)::int FROM filtered WHERE status = 'arrived'),
      'unique_guests', (
        SELECT count(DISTINCT lower(trim(visitor_name)))::int
        FROM filtered
        WHERE status = 'arrived'
      ),
      'announced', (SELECT count(*)::int FROM filtered WHERE status = 'announced'),
      'arrived', (SELECT count(*)::int FROM filtered WHERE status = 'arrived'),
      'other', (
        SELECT count(*)::int FROM filtered
        WHERE status NOT IN ('announced', 'arrived')
      )
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('date', d, 'visits', c) ORDER BY d)
      FROM (
        SELECT visit_date AS d, count(*)::int AS c
        FROM filtered
        WHERE status = 'arrived'
        GROUP BY visit_date
      ) x
    ), '[]'::jsonb),
    'by_unit', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', unit_label, 'visits', c) ORDER BY c DESC)
      FROM (
        SELECT unit_label, count(*)::int AS c
        FROM filtered
        WHERE status = 'arrived'
        GROUP BY unit_label
      ) u
    ), '[]'::jsonb),
    'guests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', visitor_name,
        'unit', unit_label,
        'visits', visits,
        'last_visit', last_visit
      ) ORDER BY visits DESC)
      FROM guest_page
    ), '[]'::jsonb),
    'guests_total', (SELECT count(*)::int FROM guest_groups WHERE visits > 0),
    'recent', coalesce((
      SELECT jsonb_agg(row_to_json(r) ORDER BY sort_at DESC)
      FROM (
        SELECT
          id,
          visitor_name,
          visitor_phone,
          visit_date,
          status,
          arrived_at,
          notes,
          unit_label AS label,
          coalesce(arrived_at, visit_date::timestamptz) AS sort_at
        FROM filtered
        WHERE status = 'arrived'
        ORDER BY coalesce(arrived_at, visit_date::timestamptz) DESC
        LIMIT 50
      ) r
    ), '[]'::jsonb),
    'date_from', v_from,
    'date_to', v_to,
    'guest_limit', v_limit,
    'guest_offset', v_offset
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_visitor_analytics_v2(uuid, uuid, date, date, text, int, int, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Today desk: one round-trip for reception dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resort_today_desk(p_resort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_month_start date;
  v_month_end date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF NOT (
    public.caller_has_resort_permission(p_resort_id, 'dashboard.read')
    OR public.caller_has_resort_permission(p_resort_id, 'scanner')
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  -- Best-effort expire stale visitor announcements for this resort's today.
  PERFORM public.expire_visitor_announcements();

  v_today := (timezone('Asia/Beirut', now()))::date;
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

  SELECT jsonb_build_object(
    'today', v_today,
    'expected_invitations', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.invitee_name)
      FROM (
        SELECT
          i.id,
          i.asset_id,
          i.invitee_name,
          i.invitee_phone,
          i.visit_date,
          i.day_type,
          i.token,
          i.status,
          i.payment_status,
          i.reception_scanned_at,
          i.gate_scanned_at,
          i.validated_at,
          jsonb_build_object('label', a.label, 'resort_id', a.resort_id) AS assets
        FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.visit_date = v_today
          AND i.status = 'issued'
      ) x
    ), '[]'::jsonb),
    'checked_in_invitations', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.validated_at DESC)
      FROM (
        SELECT
          i.id,
          i.asset_id,
          i.invitee_name,
          i.invitee_phone,
          i.visit_date,
          i.day_type,
          i.token,
          i.status,
          i.payment_status,
          i.reception_scanned_at,
          i.gate_scanned_at,
          i.validated_at,
          jsonb_build_object('label', a.label, 'resort_id', a.resort_id) AS assets
        FROM public.invitations i
        JOIN public.assets a ON a.id = i.asset_id
        WHERE a.resort_id = p_resort_id
          AND i.status = 'validated'
          AND (i.validated_at AT TIME ZONE 'Asia/Beirut')::date = v_today
      ) x
    ), '[]'::jsonb),
    'visitors', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.visitor_name)
      FROM (
        SELECT
          v.id,
          v.visitor_name,
          v.visitor_phone,
          v.visit_date,
          v.notes,
          v.status,
          v.arrived_at,
          jsonb_build_object('label', a.label, 'resort_id', a.resort_id) AS assets
        FROM public.visitor_announcements v
        JOIN public.assets a ON a.id = v.asset_id
        WHERE v.resort_id = p_resort_id
          AND v.visit_date = v_today
          AND v.status IN ('announced', 'arrived')
      ) x
    ), '[]'::jsonb),
    'invitations_validated_month', (
      SELECT count(*)::int
      FROM public.invitations i
      JOIN public.assets a ON a.id = i.asset_id
      WHERE a.resort_id = p_resort_id
        AND i.status = 'validated'
        AND i.visit_date BETWEEN v_month_start AND v_month_end
    ),
    'visitors_arrived_month', (
      SELECT count(*)::int
      FROM public.visitor_announcements v
      WHERE v.resort_id = p_resort_id
        AND v.status = 'arrived'
        AND v.visit_date BETWEEN v_month_start AND v_month_end
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_today_desk(uuid) TO authenticated;
