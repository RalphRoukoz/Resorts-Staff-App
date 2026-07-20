-- Marketplace listings (standalone, multi-resort) + public branding helper.
-- Hard delete only — no soft-delete / deleted_at.
-- (Mirrored from Resorts-App — apply once to shared Supabase project.)

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  listing_type text NOT NULL CHECK (listing_type IN ('sale', 'rental')),
  title text NOT NULL,
  description text,
  price_usd numeric(12, 2) NOT NULL CHECK (price_usd >= 0),
  size_sqm numeric(10, 2) CHECK (size_sqm IS NULL OR size_sqm >= 0),
  beds integer CHECK (beds IS NULL OR beds >= 0),
  baths integer CHECK (baths IS NULL OR baths >= 0),
  block text,
  floor_number text,
  chalet_number text,
  images text[] NOT NULL DEFAULT '{}',
  cover_url text,
  call_phone text,
  whatsapp_phone text,
  is_featured boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_listings_feed_idx
  ON public.marketplace_listings (
    resort_id,
    is_published,
    is_featured DESC,
    sort_order ASC,
    created_at DESC
  )
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS marketplace_listings_admin_idx
  ON public.marketplace_listings (resort_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_marketplace_listings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_listings_set_updated_at ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_set_updated_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_marketplace_listings_updated_at();

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_listings_public_read ON public.marketplace_listings;
CREATE POLICY marketplace_listings_public_read
  ON public.marketplace_listings
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);

DROP POLICY IF EXISTS marketplace_listings_staff_read ON public.marketplace_listings;
CREATE POLICY marketplace_listings_staff_read
  ON public.marketplace_listings
  FOR SELECT
  TO authenticated
  USING (
    public.caller_has_resort_permission(resort_id, 'dashboard.read')
    OR public.caller_has_resort_permission(resort_id, 'listings.write')
  );

DROP POLICY IF EXISTS marketplace_listings_staff_insert ON public.marketplace_listings;
CREATE POLICY marketplace_listings_staff_insert
  ON public.marketplace_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.caller_has_resort_permission(resort_id, 'listings.write'));

DROP POLICY IF EXISTS marketplace_listings_staff_update ON public.marketplace_listings;
CREATE POLICY marketplace_listings_staff_update
  ON public.marketplace_listings
  FOR UPDATE
  TO authenticated
  USING (public.caller_has_resort_permission(resort_id, 'listings.write'))
  WITH CHECK (public.caller_has_resort_permission(resort_id, 'listings.write'));

DROP POLICY IF EXISTS marketplace_listings_staff_delete ON public.marketplace_listings;
CREATE POLICY marketplace_listings_staff_delete
  ON public.marketplace_listings
  FOR DELETE
  TO authenticated
  USING (public.caller_has_resort_permission(resort_id, 'listings.write'));

GRANT SELECT ON public.marketplace_listings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-images',
  'listing-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS listing_images_public_read ON storage.objects;
CREATE POLICY listing_images_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'listing-images');

DROP POLICY IF EXISTS listing_images_staff_insert ON storage.objects;
CREATE POLICY listing_images_staff_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-images'
    AND public.caller_has_resort_permission(
      (string_to_array(name, '/'))[1]::uuid,
      'listings.write'
    )
  );

DROP POLICY IF EXISTS listing_images_staff_update ON storage.objects;
CREATE POLICY listing_images_staff_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listing-images'
    AND public.caller_has_resort_permission(
      (string_to_array(name, '/'))[1]::uuid,
      'listings.write'
    )
  )
  WITH CHECK (
    bucket_id = 'listing-images'
    AND public.caller_has_resort_permission(
      (string_to_array(name, '/'))[1]::uuid,
      'listings.write'
    )
  );

DROP POLICY IF EXISTS listing_images_staff_delete ON storage.objects;
CREATE POLICY listing_images_staff_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-images'
    AND public.caller_has_resort_permission(
      (string_to_array(name, '/'))[1]::uuid,
      'listings.write'
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
        'primary_color', r.primary_color
      )
      FROM public.resorts r
      WHERE r.id = p_resort_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.get_resort_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resort_public_profile(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible_core(
  p_phone text,
  p_resort_id uuid DEFAULT NULL
)
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
    WHERE v_phone = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
      AND (p_resort_id IS NULL OR a.resort_id = p_resort_id)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tenancies t
      JOIN public.assets a ON a.id = t.asset_id
     WHERE t.tenant_phone = v_phone
       AND t.starts_on <= v_today
       AND t.ends_on >= v_today
       AND (p_resort_id IS NULL OR a.resort_id = p_resort_id)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

DROP FUNCTION IF EXISTS public.check_owner_login_eligible_rate_limited(text, text);

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible_rate_limited(
  p_phone text,
  p_ip_hash text DEFAULT '',
  p_resort_id uuid DEFAULT NULL
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

  v_eligible := public.check_owner_login_eligible_core(v_phone, p_resort_id);

  RETURN jsonb_build_object('eligible', v_eligible);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible(p_phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_owner_login_eligible_core(p_phone, NULL);
$$;

REVOKE ALL ON FUNCTION public.check_owner_login_eligible_rate_limited(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_owner_login_eligible_rate_limited(text, text, uuid) TO service_role;
