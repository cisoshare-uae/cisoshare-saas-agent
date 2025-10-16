-- UP
-- Create per-tenant user directory in the AGENT database (source of truth for tenant-internal users)

-- 1) Enable CITEXT for case-insensitive emails (safe if already exists)
CREATE EXTENSION IF NOT EXISTS citext;

-- 2) Users table
CREATE TABLE IF NOT EXISTS agent_users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,                                   -- control-plane tenant id
  email            CITEXT NOT NULL,                                  -- unique per tenant
  display_name     TEXT,                                             -- optional full name
  role             TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  status           TEXT NOT NULL CHECK (status IN ('active','invited','revoked')) DEFAULT 'invited',
  invited_token    UUID,                                             -- optional invite token (agent-side tracking if needed)
  invited_expires_at TIMESTAMPTZ,                                    -- optional TTL if agent tracks invites
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Uniqueness & lookups
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_users_tenant_email
  ON agent_users (tenant_id, email);

CREATE INDEX IF NOT EXISTS ix_agent_users_tenant
  ON agent_users (tenant_id);

CREATE INDEX IF NOT EXISTS ix_agent_users_status
  ON agent_users (status);

-- 4) Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_users_updated_at ON agent_users;
CREATE TRIGGER trg_agent_users_updated_at
BEFORE UPDATE ON agent_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- Rollback migration (careful in prod!)
DROP TRIGGER IF EXISTS trg_agent_users_updated_at ON agent_users;
DROP FUNCTION IF EXISTS set_updated_at();
DROP INDEX IF EXISTS ix_agent_users_status;
DROP INDEX IF EXISTS ix_agent_users_tenant;
DROP INDEX IF EXISTS ux_agent_users_tenant_email;
DROP TABLE IF EXISTS agent_users;
