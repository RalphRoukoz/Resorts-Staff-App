-- Owner and tenant display names for units and rentals.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS owner_first_name text,
  ADD COLUMN IF NOT EXISTS owner_last_name text;

ALTER TABLE public.tenancies
  ADD COLUMN IF NOT EXISTS tenant_first_name text,
  ADD COLUMN IF NOT EXISTS tenant_last_name text;
