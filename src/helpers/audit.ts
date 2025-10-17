// Centralized audit writer. Called by routes to record allow/deny + outcome.
// Keep it minimal and safe: never log raw PII payloads.
import { pool } from "../lib/db";
import { CONFIG } from "../config";

export type AuditInput = {
    requestId: string;
    actorRole: string;          // e.g., "admin" | "user"
    action: "create" | "list" | "update" | "delete";
    resource: "contacts" | "employees" | "agent_users";
    targetId?: string | null;   // contact/employee/user id if applicable
    idempotencyKey?: string | null;

    decision: "allow" | "deny" | "n/a"; // OPA decision or n/a for reads/creates when not gated
    outcome: "success" | "failure" | "conflict" | "forbidden" | "not_found";
    reason?: string | null;     // short code: "version_conflict" | "create_failed" | etc.
};

export async function recordAudit(a: AuditInput) {
    const sql = `
    INSERT INTO audit_events
      (event_time, actor_role, action, resource, target_id, idempotency_key,
       decision, outcome, reason, request_id, schema_version, policy_version)
    VALUES (now(), $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11)
  `;
    const params = [
        a.actorRole,
        a.action, a.resource,
        a.targetId ?? null,
        a.idempotencyKey ?? null,
        a.decision,
        a.outcome,
        a.reason ?? null,
        a.requestId,
        CONFIG.SCHEMA_VERSION,
        CONFIG.POLICY_VERSION,
    ];
    try { await pool.query(sql, params); } catch { /* avoid throwing from audit */ }
}
