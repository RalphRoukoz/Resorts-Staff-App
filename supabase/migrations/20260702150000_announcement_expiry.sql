-- Optional announcement expiry: auto-hide from owners and purge after expires_at.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS announcements_expires_at_idx
  ON public.announcements (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purge_expired_announcements()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM public.announcements
    WHERE expires_at IS NOT NULL
      AND expires_at <= now()
    RETURNING id
  )
  SELECT count(*)::int FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_announcements() TO authenticated;

-- Hide expired announcements from owner and viewer read policies
DROP POLICY IF EXISTS announcements_read ON public.announcements;
CREATE POLICY announcements_read ON public.announcements
  FOR SELECT
  USING (
    (expires_at IS NULL OR expires_at > now())
    AND (
      (user_holds_type_in_resort(resort_id, 'chalet') AND audience = ANY (ARRAY['chalet', 'both']))
      OR (user_holds_type_in_resort(resort_id, 'cabine') AND audience = ANY (ARRAY['cabine', 'both']))
    )
  );

DROP POLICY IF EXISTS announcements_viewer_read ON public.announcements;
CREATE POLICY announcements_viewer_read ON public.announcements
  FOR SELECT
  USING (
    (expires_at IS NULL OR expires_at > now())
    AND is_staff(resort_id, 'viewer')
  );

-- Schedule hourly purge when pg_cron is available (enable in Supabase Dashboard → Database → Extensions)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_expired_announcements') THEN
      PERFORM cron.schedule(
        'purge_expired_announcements',
        '0 * * * *',
        $cron$SELECT public.purge_expired_announcements();$cron$
      );
    END IF;
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_object OR insufficient_privilege THEN
    NULL;
END;
$do$;
