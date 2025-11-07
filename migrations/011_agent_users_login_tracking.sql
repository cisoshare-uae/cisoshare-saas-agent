-- Migration 011: Add login tracking to agent_users
-- Records last login timestamp for ADHICS compliance
-- See: PLAN03-SESSION-AUDIT-IMPLEMENTATION.md

BEGIN;

-- Add last_login_at column to track user login timestamps
ALTER TABLE agent_users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Create index for last_login_at queries (e.g., inactive user reports)
CREATE INDEX IF NOT EXISTS idx_agent_users_last_login
    ON agent_users(last_login_at)
    WHERE last_login_at IS NOT NULL;

-- Create composite index for tenant + last_login queries
CREATE INDEX IF NOT EXISTS idx_agent_users_tenant_last_login
    ON agent_users(tenant_id, last_login_at)
    WHERE last_login_at IS NOT NULL;

-- Update comments for documentation
COMMENT ON COLUMN agent_users.last_login_at IS
    'Timestamp of user''s most recent login (updated by control-plane via login-notify endpoint)';

-- Example audit event for migration tracking
INSERT INTO audit_events (
    tenant_id,
    event_type,
    event_category,
    action,
    result,
    metadata,
    occurred_at
)
VALUES (
    '00000000-0000-0000-0000-000000000000', -- System tenant
    'migration_executed',
    'system',
    'schema_update',
    'success',
    jsonb_build_object(
        'migration', '011_agent_users_login_tracking',
        'changes', jsonb_build_array(
            'Added last_login_at column to agent_users',
            'Created indexes for login tracking queries'
        )
    ),
    NOW()
);

COMMIT;
