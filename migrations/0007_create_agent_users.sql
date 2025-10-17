-- ============================================================================
-- UP: Create agent_users table with audit/versioning pattern
-- ============================================================================

-- 1) Create the agent_users table
CREATE TABLE IF NOT EXISTS agent_users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  email            TEXT NOT NULL,
  display_name     TEXT,
  role             TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  status           TEXT NOT NULL CHECK (status IN ('invited','active','revoked')) DEFAULT 'invited',
  employee_id      UUID NULL REFERENCES employees(id) ON DELETE SET NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_users_tenant_email
  ON agent_users (tenant_id, email);

CREATE INDEX IF NOT EXISTS ix_agent_users_tenant
  ON agent_users (tenant_id);

CREATE INDEX IF NOT EXISTS ix_agent_users_status
  ON agent_users (status);

CREATE INDEX IF NOT EXISTS ix_agent_users_employee
  ON agent_users (employee_id);

-- 3) Create trigger function for updated_at auto-refresh
CREATE OR REPLACE FUNCTION set_agent_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Create trigger for updated_at
DROP TRIGGER IF EXISTS trg_agent_users_updated_at ON agent_users;
CREATE TRIGGER trg_agent_users_updated_at
BEFORE UPDATE ON agent_users
FOR EACH ROW EXECUTE FUNCTION set_agent_users_updated_at();

-- 5) Grant permissions to app roles
GRANT SELECT ON agent_users TO app_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_users TO app_write;

-- ============================================================================
-- DOWN: Rollback agent_users table
-- ============================================================================

/*
-- Revoke permissions
REVOKE ALL ON agent_users FROM app_read, app_write;

-- Drop trigger
DROP TRIGGER IF EXISTS trg_agent_users_updated_at ON agent_users;

-- Drop function
DROP FUNCTION IF EXISTS set_agent_users_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS ix_agent_users_employee;
DROP INDEX IF EXISTS ix_agent_users_status;
DROP INDEX IF EXISTS ix_agent_users_tenant;
DROP INDEX IF EXISTS ux_agent_users_tenant_email;

-- Drop table
DROP TABLE IF EXISTS agent_users;
*/
