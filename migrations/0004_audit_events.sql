-- Minimal audit trail stored WITH the tenant (BYOD principle)
-- Who did what, on which resource, decision + outcome, when

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Actor (demo: we only pass role; in real life you'd store user/tenant IDs)
  actor_role      TEXT NOT NULL,

  -- What happened
  action          TEXT NOT NULL,           -- e.g., create | list | update | delete
  resource        TEXT NOT NULL,           -- e.g., contacts
  target_id       UUID,                    -- affected row (if any)
  idempotency_key TEXT,                    -- for create safety

  -- Decision & outcome
  decision        TEXT NOT NULL,           -- allow | deny | n/a
  outcome         TEXT NOT NULL,           -- success | failure | conflict | forbidden | not_found
  reason          TEXT,                    -- short machine-readable reason

  -- Traceability
  request_id      TEXT NOT NULL,           -- correlation id per request
  schema_version  TEXT NOT NULL,
  policy_version  TEXT NOT NULL
);

-- Handy indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events (action, resource);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events (target_id);
