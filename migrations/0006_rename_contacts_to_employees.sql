-- ============================================================================
-- UP: public.contacts -> public.employees + tenant_id + tenant-scoped unique
-- ============================================================================

-- 0) Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Rename table
ALTER TABLE public.contacts RENAME TO employees;

-- 2) Add tenant_id and backfill placeholder, then enforce NOT NULL
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE public.employees
SET tenant_id = '00000000-0000-0000-0000-000000000000'::UUID
WHERE tenant_id IS NULL;
ALTER TABLE public.employees ALTER COLUMN tenant_id SET NOT NULL;

-- 3) Replace global unique(email) with tenant-scoped unique(tenant_id,email)
--    We know from your schema the original constraint name is contacts_email_key
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS contacts_email_key;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_email_key;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_tenant_email_key UNIQUE (tenant_id, email);

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_employees_tenant_id ON public.employees (tenant_id);

-- 5) Keep updated_at fresh: function + trigger (no procedural conditionals)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;

CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) (Optional) Grants; comment out if you don't use these roles
-- GRANT SELECT ON public.employees TO app_read;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO app_write;

-- ============================================================================
-- DOWN: revert cleanly (plain SQL)
-- ============================================================================

-- Drop tenant-scoped unique; restore original unique(email)
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_tenant_email_key;

DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;

-- Only drop function if you’re sure nothing else uses it.
-- If other tables rely on set_updated_at, you may want to keep it.
-- DROP FUNCTION IF EXISTS set_updated_at();

DROP INDEX IF EXISTS idx_employees_tenant_id;

-- Make tenant_id nullable then drop it
ALTER TABLE public.employees ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.employees DROP COLUMN IF EXISTS tenant_id;

-- Rename back to contacts
ALTER TABLE public.employees RENAME TO contacts;

-- Restore original unique(email) if missing
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_email_key UNIQUE (email);
