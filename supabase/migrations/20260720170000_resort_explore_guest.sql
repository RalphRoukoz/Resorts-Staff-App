-- Guest Explore: feature flags, map/POIs, events (staff), gallery, FAQ, public notices.

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS map_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS map_image_url text,
  ADD COLUMN IF NOT EXISTS events_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gallery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS info_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_phone text,
  ADD COLUMN IF NOT EXISTS public_whatsapp text,
  ADD COLUMN IF NOT EXISTS arrival_notes text,
  ADD COLUMN IF NOT EXISTS gate_notes text;

CREATE TABLE IF NOT EXISTS public.resort_map_pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  poi_type text NOT NULL CHECK (poi_type IN ('restaurant', 'sports', 'playground', 'pool', 'beach', 'other')),
  title text NOT NULL,
  description text,
  image_url text,
  x_pct numeric(5, 2) NOT NULL CHECK (x_pct >= 0 AND x_pct <= 100),
  y_pct numeric(5, 2) NOT NULL CHECK (y_pct >= 0 AND y_pct <= 100),
  hours_json jsonb,
  hours_note text,
  menu_urls text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_map_pois_resort_pub_idx
  ON public.resort_map_pois (resort_id, is_published, sort_order);

CREATE OR REPLACE FUNCTION public.set_resort_map_pois_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resort_map_pois_set_updated_at ON public.resort_map_pois;
CREATE TRIGGER resort_map_pois_set_updated_at
  BEFORE UPDATE ON public.resort_map_pois
  FOR EACH ROW EXECUTE FUNCTION public.set_resort_map_pois_updated_at();

ALTER TABLE public.resort_map_pois ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resort_map_pois_public_read ON public.resort_map_pois;
CREATE POLICY resort_map_pois_public_read ON public.resort_map_pois
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.resorts r
      WHERE r.id = resort_id AND r.map_enabled = true
    )
  );

DROP POLICY IF EXISTS resort_map_pois_super_all ON public.resort_map_pois;
CREATE POLICY resort_map_pois_super_all ON public.resort_map_pois
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.resort_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  cover_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_label text,
  poi_id uuid REFERENCES public.resort_map_pois(id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_events_resort_starts_idx
  ON public.resort_events (resort_id, starts_at);

CREATE OR REPLACE FUNCTION public.set_resort_events_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resort_events_set_updated_at ON public.resort_events;
CREATE TRIGGER resort_events_set_updated_at
  BEFORE UPDATE ON public.resort_events
  FOR EACH ROW EXECUTE FUNCTION public.set_resort_events_updated_at();

ALTER TABLE public.resort_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resort_events_public_read ON public.resort_events;
CREATE POLICY resort_events_public_read ON public.resort_events
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.resorts r
      WHERE r.id = resort_id AND r.events_enabled = true
    )
  );

DROP POLICY IF EXISTS resort_events_staff_read ON public.resort_events;
CREATE POLICY resort_events_staff_read ON public.resort_events
  FOR SELECT TO authenticated
  USING (
    public.caller_has_resort_permission(resort_id, 'dashboard.read')
    OR public.caller_has_resort_permission(resort_id, 'events.write')
    OR public.caller_has_resort_permission(resort_id, 'announcements.write')
  );

DROP POLICY IF EXISTS resort_events_staff_insert ON public.resort_events;
CREATE POLICY resort_events_staff_insert ON public.resort_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.caller_has_resort_permission(resort_id, 'events.write')
    OR public.caller_has_resort_permission(resort_id, 'announcements.write')
  );

DROP POLICY IF EXISTS resort_events_staff_update ON public.resort_events;
CREATE POLICY resort_events_staff_update ON public.resort_events
  FOR UPDATE TO authenticated
  USING (
    public.caller_has_resort_permission(resort_id, 'events.write')
    OR public.caller_has_resort_permission(resort_id, 'announcements.write')
  )
  WITH CHECK (
    public.caller_has_resort_permission(resort_id, 'events.write')
    OR public.caller_has_resort_permission(resort_id, 'announcements.write')
  );

DROP POLICY IF EXISTS resort_events_staff_delete ON public.resort_events;
CREATE POLICY resort_events_staff_delete ON public.resort_events
  FOR DELETE TO authenticated
  USING (
    public.caller_has_resort_permission(resort_id, 'events.write')
    OR public.caller_has_resort_permission(resort_id, 'announcements.write')
  );

CREATE TABLE IF NOT EXISTS public.resort_gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_gallery_resort_idx
  ON public.resort_gallery_images (resort_id, sort_order);

ALTER TABLE public.resort_gallery_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resort_gallery_public_read ON public.resort_gallery_images;
CREATE POLICY resort_gallery_public_read ON public.resort_gallery_images
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.resorts r
      WHERE r.id = resort_id AND r.gallery_enabled = true
    )
  );

DROP POLICY IF EXISTS resort_gallery_super_all ON public.resort_gallery_images;
CREATE POLICY resort_gallery_super_all ON public.resort_gallery_images
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.resort_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_faqs_resort_idx
  ON public.resort_faqs (resort_id, sort_order);

ALTER TABLE public.resort_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resort_faqs_public_read ON public.resort_faqs;
CREATE POLICY resort_faqs_public_read ON public.resort_faqs
  FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.resorts r
      WHERE r.id = resort_id AND r.info_enabled = true
    )
  );

DROP POLICY IF EXISTS resort_faqs_super_all ON public.resort_faqs;
CREATE POLICY resort_faqs_super_all ON public.resort_faqs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid()));

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS announcements_public_idx
  ON public.announcements (resort_id, created_at DESC)
  WHERE is_public = true;

DROP POLICY IF EXISTS announcements_public_guest_read ON public.announcements;
CREATE POLICY announcements_public_guest_read ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (
    is_public = true
    AND (expires_at IS NULL OR expires_at > now())
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resort-guest',
  'resort-guest',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS resort_guest_public_read ON storage.objects;
CREATE POLICY resort_guest_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'resort-guest');

DROP POLICY IF EXISTS resort_guest_super_write ON storage.objects;
CREATE POLICY resort_guest_super_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'resort-guest'
    AND EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'resort-guest'
    AND EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid())
  );

DROP POLICY IF EXISTS resort_guest_staff_events_write ON storage.objects;
CREATE POLICY resort_guest_staff_events_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'resort-guest'
    AND (storage.foldername(name))[1] IS NOT NULL
    AND (
      public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'events.write')
      OR public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'announcements.write')
    )
  );

DROP POLICY IF EXISTS resort_guest_staff_events_update ON storage.objects;
CREATE POLICY resort_guest_staff_events_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'resort-guest'
    AND (
      public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'events.write')
      OR public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'announcements.write')
    )
  );

DROP POLICY IF EXISTS resort_guest_staff_events_delete ON storage.objects;
CREATE POLICY resort_guest_staff_events_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'resort-guest'
    AND (
      public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'events.write')
      OR public.caller_has_resort_permission(((storage.foldername(name))[1])::uuid, 'announcements.write')
    )
  );

CREATE OR REPLACE FUNCTION public.get_resort_public_profile(p_resort_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_resort_id IS NULL THEN NULL
    ELSE (
      SELECT jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'logo_url', r.logo_url,
        'primary_color', r.primary_color,
        'marketplace_listings_enabled', r.marketplace_listings_enabled,
        'map_enabled', r.map_enabled,
        'events_enabled', r.events_enabled,
        'gallery_enabled', r.gallery_enabled,
        'info_enabled', r.info_enabled,
        'public_phone', r.public_phone,
        'public_whatsapp', r.public_whatsapp,
        'arrival_notes', r.arrival_notes,
        'gate_notes', r.gate_notes
      )
      FROM public.resorts r
      WHERE r.id = p_resort_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.get_resort_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resort_public_profile(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_resort_map(p_resort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_image text;
  v_pois jsonb;
BEGIN
  IF p_resort_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.map_enabled, r.map_image_url
    INTO v_enabled, v_image
    FROM public.resorts r
   WHERE r.id = p_resort_id;

  IF NOT FOUND OR NOT coalesce(v_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'map_image_url', null, 'pois', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'poi_type', p.poi_type,
      'title', p.title,
      'description', p.description,
      'image_url', p.image_url,
      'x_pct', p.x_pct,
      'y_pct', p.y_pct,
      'hours_json', p.hours_json,
      'hours_note', p.hours_note,
      'menu_urls', p.menu_urls,
      'sort_order', p.sort_order
    )
    ORDER BY p.sort_order, p.created_at
  ), '[]'::jsonb)
  INTO v_pois
  FROM public.resort_map_pois p
  WHERE p.resort_id = p_resort_id AND p.is_published = true;

  RETURN jsonb_build_object(
    'enabled', true,
    'map_image_url', v_image,
    'pois', v_pois
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_resort_map(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resort_map(uuid) TO anon, authenticated;

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
    WHERE p.resort_id = p_resort_id AND p.is_published = true
    ORDER BY p.sort_order
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
