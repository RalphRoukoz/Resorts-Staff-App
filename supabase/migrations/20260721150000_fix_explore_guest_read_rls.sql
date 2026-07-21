-- Fix guest (anon) reads of published explore content.
--
-- public.resorts is protected by the `resorts_read` policy: USING (auth.uid() IS NOT NULL).
-- The explore public-read policies (map POIs, events, gallery, info) gated visibility with
-- an EXISTS subquery against public.resorts. That subquery is itself evaluated under RLS,
-- so for anonymous guests it always returned no rows -- hiding ALL published explore content
-- (most visibly the resort gallery, which the client reads directly from the table).
--
-- Resolve the resort's explore flags with a SECURITY DEFINER helper that bypasses resorts RLS,
-- then reference it from each public-read policy.

CREATE OR REPLACE FUNCTION public.resort_explore_flags(p_resort_id uuid)
RETURNS TABLE (
  map_enabled boolean,
  events_enabled boolean,
  gallery_enabled boolean,
  info_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.map_enabled, r.events_enabled, r.gallery_enabled, r.info_enabled
  FROM public.resorts r
  WHERE r.id = p_resort_id;
$$;

REVOKE ALL ON FUNCTION public.resort_explore_flags(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resort_explore_flags(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS resort_map_pois_public_read ON public.resort_map_pois;
CREATE POLICY resort_map_pois_public_read ON public.resort_map_pois
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND coalesce((SELECT f.map_enabled FROM public.resort_explore_flags(resort_id) f), false)
  );

DROP POLICY IF EXISTS resort_events_public_read ON public.resort_events;
CREATE POLICY resort_events_public_read ON public.resort_events
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND coalesce((SELECT f.events_enabled FROM public.resort_explore_flags(resort_id) f), false)
  );

DROP POLICY IF EXISTS resort_gallery_public_read ON public.resort_gallery_images;
CREATE POLICY resort_gallery_public_read ON public.resort_gallery_images
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND coalesce((SELECT f.gallery_enabled FROM public.resort_explore_flags(resort_id) f), false)
  );

DROP POLICY IF EXISTS resort_faqs_public_read ON public.resort_faqs;
CREATE POLICY resort_faqs_public_read ON public.resort_faqs
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND coalesce((SELECT f.info_enabled FROM public.resort_explore_flags(resort_id) f), false)
  );
