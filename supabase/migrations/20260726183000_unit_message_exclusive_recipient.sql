-- Unit messages + push: exclusive recipient = current external tenant OR owners (never both).

CREATE OR REPLACE FUNCTION public.is_unit_message_recipient(p_asset uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
     WHERE a.id = p_asset
       AND public.current_user_phone() IS NOT NULL
       AND (
         -- Rented to a non-owner tenant: only that tenant
         EXISTS (
           SELECT 1
             FROM public.tenancies t
            WHERE t.asset_id = a.id
              AND public.today_beirut() BETWEEN t.starts_on AND t.ends_on
              AND NOT (
                public.normalize_phone_digits(t.tenant_phone) = ANY (
                  SELECT public.normalize_phone_digits(x)
                    FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
                )
              )
              AND public.normalize_phone_digits(t.tenant_phone)
                = public.normalize_phone_digits(public.current_user_phone())
         )
         OR (
           -- Not rented externally: any listed owner
           NOT EXISTS (
             SELECT 1
               FROM public.tenancies t
              WHERE t.asset_id = a.id
                AND public.today_beirut() BETWEEN t.starts_on AND t.ends_on
                AND NOT (
                  public.normalize_phone_digits(t.tenant_phone) = ANY (
                    SELECT public.normalize_phone_digits(x)
                      FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
                  )
                )
           )
           AND public.normalize_phone_digits(public.current_user_phone()) = ANY (
             SELECT public.normalize_phone_digits(x)
               FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
           )
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.is_unit_message_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_unit_message_recipient(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS unit_messages_holder_read ON public.unit_messages;
CREATE POLICY unit_messages_holder_read ON public.unit_messages
  FOR SELECT
  USING (public.is_unit_message_recipient(asset_id));

DROP POLICY IF EXISTS unit_message_reads_own ON public.unit_message_reads;
CREATE POLICY unit_message_reads_own ON public.unit_message_reads
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.unit_messages m
      WHERE m.id = message_id
        AND public.is_unit_message_recipient(m.asset_id)
    )
  );

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
    SELECT a.id, a.owner_phones
    FROM public.assets a
    WHERE a.resort_id = p_resort_id
      AND a.id = ANY (coalesce(p_asset_ids, ARRAY[]::uuid[]))
  ),
  active_external_tenant AS (
    SELECT DISTINCT ON (t.asset_id)
           t.asset_id,
           t.tenant_phone AS phone
      FROM public.tenancies t
      JOIN target_assets a ON a.id = t.asset_id
     WHERE public.today_beirut() BETWEEN t.starts_on AND t.ends_on
       AND NOT (
         public.normalize_phone_digits(t.tenant_phone) = ANY (
           SELECT public.normalize_phone_digits(x)
             FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
         )
       )
     ORDER BY t.asset_id, t.starts_on DESC
  ),
  phones AS (
    SELECT DISTINCT public.normalize_phone_digits(phone) AS digits
    FROM (
      -- Rented units: current external tenant only
      SELECT aet.phone
        FROM active_external_tenant aet
      UNION ALL
      -- Unrented units: all owners
      SELECT unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS phone
        FROM target_assets a
       WHERE NOT EXISTS (
         SELECT 1 FROM active_external_tenant aet WHERE aet.asset_id = a.id
       )
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
