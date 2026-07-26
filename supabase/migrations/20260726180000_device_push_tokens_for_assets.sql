-- Resolve FCM tokens for owners + current tenants of specific assets (unit messages).
CREATE OR REPLACE FUNCTION public.device_push_tokens_for_assets(
  p_resort_id uuid,
  p_asset_ids uuid[]
)
RETURNS TABLE (id uuid, token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target_assets AS (
    SELECT a.id
    FROM public.assets a
    WHERE a.resort_id = p_resort_id
      AND a.id = ANY (coalesce(p_asset_ids, ARRAY[]::uuid[]))
  ),
  phones AS (
    SELECT DISTINCT public.normalize_phone_digits(phone) AS digits
    FROM (
      SELECT unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS phone
      FROM public.assets a
      JOIN target_assets ta ON ta.id = a.id
      UNION ALL
      SELECT t.tenant_phone
      FROM public.tenancies t
      JOIN target_assets ta ON ta.id = t.asset_id
      WHERE public.today_beirut() BETWEEN t.starts_on AND t.ends_on
    ) x
    WHERE phone IS NOT NULL
      AND length(trim(phone)) > 0
  ),
  recipients AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    JOIN phones ph ON public.normalize_phone_digits(p.phone) = ph.digits
  )
  SELECT DISTINCT d.id, d.token
  FROM public.device_push_tokens d
  JOIN recipients r ON r.user_id = d.user_id
  WHERE d.resort_id = p_resort_id;
$$;

REVOKE ALL ON FUNCTION public.device_push_tokens_for_assets(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_push_tokens_for_assets(uuid, uuid[]) TO service_role;
