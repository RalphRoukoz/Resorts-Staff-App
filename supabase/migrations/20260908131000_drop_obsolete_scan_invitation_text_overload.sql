-- PostgREST must resolve scanner calls to the UUID overload, which supports
-- scanner.reception and scanner.gate permissions. The legacy text overload
-- only checks the deprecated scanner permission and rejects current staff roles.
DROP FUNCTION IF EXISTS public.scan_invitation(text, text);
