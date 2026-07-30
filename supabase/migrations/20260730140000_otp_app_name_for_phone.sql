-- Resolve SMS OTP product name from phone → owner/tenant resort (white-label).
CREATE OR REPLACE FUNCTION public.otp_app_name_for_phone(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH digits AS (
    SELECT public.normalize_phone_digits(p_phone) AS d
  ),
  owner_hit AS (
    SELECT r.name
      FROM public.assets a
      JOIN public.resorts r ON r.id = a.resort_id
      CROSS JOIN digits
     WHERE digits.d IS NOT NULL
       AND digits.d = ANY (
             SELECT public.normalize_phone_digits(x)
               FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
           )
     ORDER BY a.created_at DESC
     LIMIT 1
  ),
  tenant_hit AS (
    SELECT r.name
      FROM public.tenancies t
      JOIN public.assets a ON a.id = t.asset_id
      JOIN public.resorts r ON r.id = a.resort_id
      CROSS JOIN digits
     WHERE digits.d IS NOT NULL
       AND public.normalize_phone_digits(t.tenant_phone) = digits.d
       AND public.today_beirut() BETWEEN t.starts_on AND t.ends_on
     ORDER BY t.starts_on DESC
     LIMIT 1
  )
  SELECT coalesce(
    (SELECT name FROM owner_hit),
    (SELECT name FROM tenant_hit)
  );
$$;

REVOKE ALL ON FUNCTION public.otp_app_name_for_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.otp_app_name_for_phone(text) TO service_role;
