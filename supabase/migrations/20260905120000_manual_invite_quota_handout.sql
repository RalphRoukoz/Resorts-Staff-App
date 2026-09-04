-- Manual vs automatic invitation quota handout + audit log.
-- Mirrored in Resortly — apply once to shared Supabase.

ALTER TABLE public.resorts
  ADD COLUMN IF NOT EXISTS invitation_quota_mode text NOT NULL DEFAULT 'automatic';

ALTER TABLE public.resorts
  DROP CONSTRAINT IF EXISTS resorts_invitation_quota_mode_check;

ALTER TABLE public.resorts
  ADD CONSTRAINT resorts_invitation_quota_mode_check
  CHECK (invitation_quota_mode IN ('automatic', 'manual'));

COMMENT ON COLUMN public.resorts.invitation_quota_mode IS
  'automatic = resort defaults + bonuses; manual = staff must hand over monthly quotas';

CREATE TABLE IF NOT EXISTS public.asset_period_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  period_ym text NOT NULL,
  weekday_quota integer NOT NULL DEFAULT 0 CHECK (weekday_quota >= 0),
  weekend_quota integer NOT NULL DEFAULT 0 CHECK (weekend_quota >= 0),
  handed_over_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_ym)
);

CREATE INDEX IF NOT EXISTS asset_period_quotas_resort_period_idx
  ON public.asset_period_quotas (resort_id, period_ym);

CREATE TABLE IF NOT EXISTS public.invitation_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  period_ym text NOT NULL,
  action text NOT NULL CHECK (action IN ('hand_over', 'add', 'remove', 'month_reset')),
  weekday_delta integer NOT NULL DEFAULT 0,
  weekend_delta integer NOT NULL DEFAULT 0,
  weekday_after integer NOT NULL DEFAULT 0,
  weekend_after integer NOT NULL DEFAULT 0,
  actor_user_id uuid,
  actor_username text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_quota_events_resort_created_idx
  ON public.invitation_quota_events (resort_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invitation_quota_events_asset_created_idx
  ON public.invitation_quota_events (asset_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.current_period_ym()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(date_trunc('month', public.today_beirut())::date, 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public.staff_username_for_actor(p_resort_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT rs.username
       FROM public.resort_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.resort_id = p_resort_id
      ORDER BY rs.id
      LIMIT 1),
    (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()),
    'unknown'
  );
$$;

-- Expand invitations.bonus → invitations.quota on custom roles
UPDATE public.resort_roles
   SET permissions = (
     SELECT array_agg(DISTINCT p)
       FROM unnest(
         permissions || CASE
           WHEN 'invitations.bonus' = ANY (permissions)
             AND NOT ('invitations.quota' = ANY (permissions))
           THEN ARRAY['invitations.quota']
           ELSE ARRAY[]::text[]
         END
       ) AS p
   )
 WHERE permissions IS NOT NULL
   AND 'invitations.bonus' = ANY (permissions);

ALTER TABLE public.asset_period_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_quota_events ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated → only SECURITY DEFINER RPCs access.
-- Match owner_device_locks / device_takeovers: revoke PUBLIC too, grant postgres + service_role.
REVOKE ALL ON TABLE public.asset_period_quotas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invitation_quota_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.asset_period_quotas TO postgres, service_role;
GRANT SELECT, INSERT ON TABLE public.invitation_quota_events TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.current_period_ym() TO authenticated;
