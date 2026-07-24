-- Device push tokens for FCM (announcements + events)
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  resort_id uuid NOT NULL REFERENCES public.resorts (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  app_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_tokens_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS device_push_tokens_resort_idx
  ON public.device_push_tokens (resort_id);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_push_tokens_select_own ON public.device_push_tokens;
CREATE POLICY device_push_tokens_select_own ON public.device_push_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_device_push_token(
  p_token text,
  p_platform text,
  p_resort_id uuid,
  p_app_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 20 THEN
    RAISE EXCEPTION 'BAD_TOKEN';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'BAD_PLATFORM';
  END IF;
  IF p_resort_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.resorts WHERE id = p_resort_id) THEN
    RAISE EXCEPTION 'BAD_RESORT';
  END IF;

  INSERT INTO public.device_push_tokens (token, platform, resort_id, user_id, app_id, updated_at)
  VALUES (trim(p_token), p_platform, p_resort_id, auth.uid(), nullif(trim(coalesce(p_app_id, '')), ''), now())
  ON CONFLICT (token) DO UPDATE SET
    platform = EXCLUDED.platform,
    resort_id = EXCLUDED.resort_id,
    user_id = COALESCE(EXCLUDED.user_id, public.device_push_tokens.user_id),
    app_id = COALESCE(EXCLUDED.app_id, public.device_push_tokens.app_id),
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_push_token(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_device_push_token(text, text, uuid, text) TO anon, authenticated;
