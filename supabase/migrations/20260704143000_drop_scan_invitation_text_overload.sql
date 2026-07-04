-- PostgREST was resolving scan_invitation(text, text) and failing uuid = text comparison.
DROP FUNCTION IF EXISTS public.scan_invitation(text, text);
