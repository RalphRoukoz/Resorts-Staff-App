-- Per-chalet flag: when false (default), only one active owner-app device per phone.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS allow_multiple_logins boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.assets.allow_multiple_logins IS
  'When true, multiple devices may stay signed in with the same owner phone. When false, a new login replaces the previous device.';

CREATE TABLE IF NOT EXISTS public.owner_device_locks (
  phone text PRIMARY KEY,
  device_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_device_locks_user_id_idx
  ON public.owner_device_locks (user_id);

ALTER TABLE public.owner_device_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.owner_device_locks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.owner_device_locks TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.normalize_phone_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.phone_requires_single_device(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.assets a
     WHERE public.normalize_phone_digits(p_phone) = ANY (
             SELECT public.normalize_phone_digits(x)
               FROM unnest(coalesce(a.owner_phones, ARRAY[]::text[])) AS x
           )
       AND a.allow_multiple_logins = false
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_owner_device(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_digits text;
  v_device text := nullif(btrim(coalesce(p_device_id, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_DEVICE');
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = v_uid;
  IF v_phone IS NULL OR btrim(v_phone) = '' THEN
    v_phone := nullif(auth.jwt() ->> 'phone', '');
    IF v_phone IS NOT NULL THEN
      INSERT INTO public.profiles (id, phone)
      VALUES (v_uid, v_phone)
      ON CONFLICT (id) DO UPDATE
        SET phone = excluded.phone
      WHERE public.profiles.phone IS DISTINCT FROM excluded.phone;
    END IF;
  END IF;

  v_digits := public.normalize_phone_digits(v_phone);

  IF v_digits IS NULL OR length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PHONE');
  END IF;

  IF NOT public.phone_requires_single_device(v_digits) THEN
    DELETE FROM public.owner_device_locks WHERE phone = v_digits;
    RETURN jsonb_build_object(
      'ok', true,
      'single_device', false,
      'allowed', true
    );
  END IF;

  INSERT INTO public.owner_device_locks AS l (phone, device_id, user_id, updated_at)
  VALUES (v_digits, v_device, v_uid, now())
  ON CONFLICT (phone) DO UPDATE
    SET device_id = excluded.device_id,
        user_id = excluded.user_id,
        updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'single_device', true,
    'allowed', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_owner_device(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_digits text;
  v_device text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_active text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF v_device IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_DEVICE');
  END IF;

  SELECT phone INTO v_phone FROM public.profiles WHERE id = v_uid;
  v_digits := public.normalize_phone_digits(v_phone);

  IF v_digits IS NULL OR length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'single_device', false);
  END IF;

  IF NOT public.phone_requires_single_device(v_digits) THEN
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'single_device', false);
  END IF;

  SELECT device_id INTO v_active
    FROM public.owner_device_locks
   WHERE phone = v_digits;

  IF v_active IS NULL THEN
    -- No lock yet: allow this device to claim on next claim_owner_device call.
    RETURN jsonb_build_object('ok', true, 'allowed', true, 'single_device', true, 'needs_claim', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'allowed', v_active = v_device,
    'single_device', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_phone_digits(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_requires_single_device(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_owner_device(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_owner_device(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.normalize_phone_digits(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.phone_requires_single_device(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_owner_device(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_owner_device(text) TO authenticated, service_role;
