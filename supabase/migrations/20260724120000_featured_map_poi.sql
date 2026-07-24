-- Featured place on Explore home: explicit POI pick (max one per resort).

ALTER TABLE public.resort_map_pois
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

-- At most one featured POI per resort.
CREATE UNIQUE INDEX IF NOT EXISTS resort_map_pois_one_featured_per_resort_idx
  ON public.resort_map_pois (resort_id)
  WHERE is_featured = true;

-- Preserve prior Explore behavior: first published POI by sort_order becomes featured.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY resort_id ORDER BY sort_order ASC, created_at ASC) AS rn
  FROM public.resort_map_pois
  WHERE is_published = true
)
UPDATE public.resort_map_pois p
SET is_featured = true
FROM ranked r
WHERE p.id = r.id
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.resort_map_pois x
    WHERE x.resort_id = p.resort_id AND x.is_featured = true
  );

CREATE OR REPLACE FUNCTION public.get_resort_explore_home(p_resort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.resorts%ROWTYPE;
  v_events jsonb;
  v_notice jsonb;
  v_open_poi jsonb;
BEGIN
  IF p_resort_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM public.resorts WHERE id = p_resort_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF r.events_enabled THEN
    SELECT coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT id, title, cover_url, starts_at, ends_at, location_label, poi_id
      FROM public.resort_events
      WHERE resort_id = p_resort_id
        AND is_published = true
        AND starts_at >= date_trunc('day', now())
      ORDER BY starts_at
      LIMIT 3
    ) e;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'id', a.id,
    'title', a.title,
    'body', a.body,
    'created_at', a.created_at
  )
  INTO v_notice
  FROM public.announcements a
  WHERE a.resort_id = p_resort_id
    AND a.is_public = true
    AND (a.expires_at IS NULL OR a.expires_at > now())
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF r.map_enabled THEN
    SELECT jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'poi_type', p.poi_type,
      'image_url', p.image_url
    )
    INTO v_open_poi
    FROM public.resort_map_pois p
    WHERE p.resort_id = p_resort_id
      AND p.is_published = true
      AND p.is_featured = true
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'map_enabled', r.map_enabled,
    'events_enabled', r.events_enabled,
    'gallery_enabled', r.gallery_enabled,
    'info_enabled', r.info_enabled,
    'marketplace_listings_enabled', r.marketplace_listings_enabled,
    'events', coalesce(v_events, '[]'::jsonb),
    'notice', v_notice,
    'featured_poi', v_open_poi
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_resort_explore_home(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resort_explore_home(uuid) TO anon, authenticated;
