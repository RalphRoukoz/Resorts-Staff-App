-- Consolidate assets.owner_phone + assets.owner_phones into owner_phones only.

-- 1) Backfill array from scalar where needed
UPDATE public.assets
SET owner_phones = ARRAY[owner_phone]
WHERE (owner_phones IS NULL OR cardinality(owner_phones) = 0)
  AND owner_phone IS NOT NULL
  AND btrim(owner_phone) <> '';

-- 2) Replace sync trigger: validate/normalize owner_phones only
CREATE OR REPLACE FUNCTION public.sync_asset_owner_phones()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.owner_phones := ARRAY(
    SELECT DISTINCT phone
    FROM unnest(coalesce(NEW.owner_phones, ARRAY[]::text[])) AS phone
    WHERE phone IS NOT NULL AND btrim(phone) <> ''
  );

  IF coalesce(cardinality(NEW.owner_phones), 0) = 0 THEN
    RAISE EXCEPTION 'Asset must have at least one owner phone';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Functions that referenced owner_phone
CREATE OR REPLACE FUNCTION public.asset_controller(p_asset uuid, p_date date)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT t.tenant_phone
        FROM public.tenancies t
       WHERE t.asset_id = p_asset
         AND p_date BETWEEN t.starts_on AND t.ends_on
       ORDER BY t.starts_on DESC
       LIMIT 1
    ),
    (
      SELECT a.owner_phones[1]
        FROM public.assets a
       WHERE a.id = p_asset
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_controls_asset(p_asset uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
      LEFT JOIN LATERAL (
        SELECT t.tenant_phone
          FROM public.tenancies t
         WHERE t.asset_id = a.id
           AND p_date BETWEEN t.starts_on AND t.ends_on
         ORDER BY t.starts_on DESC
         LIMIT 1
      ) ten ON true
     WHERE a.id = p_asset
       AND public.current_user_phone() IS NOT NULL
       AND (
         public.current_user_phone() = ten.tenant_phone
         OR public.current_user_phone() = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.check_owner_login_eligible_core(p_phone text)
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
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenancies t
    WHERE t.tenant_phone = v_phone
      AND t.starts_on <= v_today
      AND t.ends_on >= v_today
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_asset_owner(p_asset uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
     WHERE a.id = p_asset
       AND public.current_user_phone() = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
  );
$$;

CREATE OR REPLACE FUNCTION public.revoke_owner_invites_on_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invitations i
     SET status = 'cancelled'
    FROM public.assets a
   WHERE a.id = NEW.asset_id
     AND i.asset_id = NEW.asset_id
     AND i.issued_by_phone = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
     AND i.status = 'issued'
     AND i.visit_date BETWEEN NEW.starts_on AND NEW.ends_on;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_holds_type_in_resort(p_resort uuid, p_type text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
     WHERE a.resort_id = p_resort
       AND a.asset_type = p_type
       AND (
         public.current_user_phone() = ANY (coalesce(a.owner_phones, ARRAY[]::text[]))
         OR EXISTS (
           SELECT 1
             FROM public.tenancies t
            WHERE t.asset_id = a.id
              AND public.today_beirut() BETWEEN t.starts_on AND t.ends_on
              AND t.tenant_phone = public.current_user_phone()
         )
       )
  );
$$;

-- 4) Indexes: drop scalar, add array GIN
DROP INDEX IF EXISTS public.assets_owner_phone_idx;
DROP INDEX IF EXISTS public.assets_owner_phone_trgm_idx;

CREATE INDEX IF NOT EXISTS assets_owner_phones_gin_idx
  ON public.assets USING gin (owner_phones);

-- 5) Drop scalar column
ALTER TABLE public.assets DROP COLUMN IF EXISTS owner_phone;
