-- Per-resort marketplace listings feature flag.
-- When false: hide Listings tab in owner app and Marketplace nav in staff dashboard.
-- (Mirrored from Resorts-App — apply once to shared Supabase project.)

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS marketplace_listings_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.resorts.marketplace_listings_enabled IS
  'When true, owner app and staff dashboard show marketplace listings surfaces.';

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
        'marketplace_listings_enabled', r.marketplace_listings_enabled
      )
      FROM public.resorts r
      WHERE r.id = p_resort_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.get_resort_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resort_public_profile(uuid) TO anon, authenticated;
