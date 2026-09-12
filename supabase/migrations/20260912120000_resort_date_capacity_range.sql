-- Month calendar: capacity for a date range in one round-trip.
CREATE OR REPLACE FUNCTION public.resort_date_capacity_range(
  p_resort uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  IF p_resort IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN jsonb_build_object('error', 'BAD_ARGS');
  END IF;

  -- Guard against unbounded ranges
  IF (p_to - p_from) > 62 THEN
    RETURN jsonb_build_object('error', 'RANGE_TOO_LARGE');
  END IF;

  SELECT r.daily_invitation_cap INTO v_cap
    FROM public.resorts r
   WHERE r.id = p_resort;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.date), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        d::date AS date,
        coalesce(u.used, 0)::int AS used,
        v_cap AS cap,
        CASE WHEN v_cap IS NULL THEN NULL ELSE greatest(v_cap - coalesce(u.used, 0), 0) END AS remaining,
        CASE WHEN v_cap IS NULL THEN false ELSE coalesce(u.used, 0) >= v_cap END AS is_full
      FROM generate_series(p_from, p_to, interval '1 day') AS d
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS used
          FROM public.invitations i
          JOIN public.assets a ON a.id = i.asset_id
         WHERE a.resort_id = p_resort
           AND i.visit_date = d::date
           AND i.status IN ('issued', 'validated')
      ) u ON true
    ) x;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resort_date_capacity_range(uuid, date, date) TO authenticated;
