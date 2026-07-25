-- Resort invite/season config is super-admin only.
-- Previously resort staff with role = 'admin' could UPDATE resorts via RLS.

DROP POLICY IF EXISTS resorts_admin_update ON public.resorts;
