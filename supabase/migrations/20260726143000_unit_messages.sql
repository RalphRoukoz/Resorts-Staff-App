-- One-way messages from staff dashboard to specific units (owners/tenants only).

CREATE TABLE IF NOT EXISTS public.unit_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resort_id uuid NOT NULL REFERENCES public.resorts(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unit_messages_resort_created_idx
  ON public.unit_messages (resort_id, created_at DESC);

CREATE INDEX IF NOT EXISTS unit_messages_asset_created_idx
  ON public.unit_messages (asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.unit_message_reads (
  message_id uuid NOT NULL REFERENCES public.unit_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.unit_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unit_messages_staff_all ON public.unit_messages;
CREATE POLICY unit_messages_staff_all ON public.unit_messages
  FOR ALL
  USING (
    is_superadmin()
    OR caller_has_resort_permission(resort_id, 'announcements.write')
    OR is_staff(resort_id, 'admin')
  )
  WITH CHECK (
    is_superadmin()
    OR caller_has_resort_permission(resort_id, 'announcements.write')
    OR is_staff(resort_id, 'admin')
  );

DROP POLICY IF EXISTS unit_messages_holder_read ON public.unit_messages;
CREATE POLICY unit_messages_holder_read ON public.unit_messages
  FOR SELECT
  USING (
    is_asset_owner(asset_id) OR is_current_tenant(asset_id)
  );

DROP POLICY IF EXISTS unit_message_reads_own ON public.unit_message_reads;
CREATE POLICY unit_message_reads_own ON public.unit_message_reads
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.unit_messages m
      WHERE m.id = message_id
        AND (is_asset_owner(m.asset_id) OR is_current_tenant(m.asset_id))
    )
  );

DROP POLICY IF EXISTS unit_message_reads_staff_read ON public.unit_message_reads;
CREATE POLICY unit_message_reads_staff_read ON public.unit_message_reads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.unit_messages m
      WHERE m.id = message_id
        AND (
          is_superadmin()
          OR caller_has_resort_permission(m.resort_id, 'announcements.write')
          OR is_staff(m.resort_id, 'admin')
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_message_reads TO authenticated;
