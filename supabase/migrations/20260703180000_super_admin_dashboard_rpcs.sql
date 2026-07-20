-- Super-admin dashboard RPCs (from analytics migration, deployed separately)

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
