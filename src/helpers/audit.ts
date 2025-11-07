// Centralized ADHICS-compliant audit writer.
// Called by routes to record all database operations for compliance tracking.
// ADHICS Requirements: AC 5.1, IM 2.1, SA 3.1, TP 3.1, DP 4.1
// Keep it minimal and safe: never log raw PII payloads.
import { pool } from "../lib/db";
import { CONFIG } from "../config";

export type AuditInput = {
    // ADHICS Required: Tenant isolation
    tenantId: string;

    // ADHICS Required: Actor identification (User ID + Role)
    actorId?: string | null;        // User UUID
    actorEmail?: string | null;     // User email
    actorRole: string;               // owner, admin, member
    actorIp?: string | null;        // Source IP address (ADHICS requirement)

    // ADHICS Required: Action tracking
    action: "create" | "list" | "update" | "delete" | "get";
    resource: "contacts" | "employees" | "agent_users" | "policies" | "vendors" | "documents";

    // ADHICS Required: Event classification
    eventCategory?: "auth" | "data" | "system" | "compliance" | "security";

    // ADHICS Required: Target tracking (Affected data)
    targetId?: string | null;       // Affected record UUID
    targetType?: string | null;     // Resource type
    targetName?: string | null;     // Human-readable identifier (no PII)

    // ADHICS Required: Outcome/Result
    outcome: "success" | "failure" | "partial";

    // ADHICS Optional: Additional context
    decision?: "allow" | "deny" | "n/a";
    reason?: string | null;
    changes?: any;                  // What changed (before/after)

    // Extra metadata
    requestId?: string;
    idempotencyKey?: string | null;
    schemaVersion?: string;
    policyVersion?: string;
};

export async function recordAudit(a: AuditInput) {
    // Map outcome to result (normalize values)
    const resultMap: Record<string, "success" | "failure" | "partial"> = {
        "success": "success",
        "failure": "failure",
        "partial": "partial",
        "conflict": "failure",
        "forbidden": "failure",
        "not_found": "failure",
    };
    const result = resultMap[a.outcome] || "failure";

    // Default event category to 'data' for CRUD operations
    const eventCategory = a.eventCategory || "data";

    // Build metadata JSONB with extra fields
    const metadata: any = {};
    if (a.requestId) metadata.request_id = a.requestId;
    if (a.idempotencyKey) metadata.idempotency_key = a.idempotencyKey;
    if (a.decision) metadata.decision = a.decision;
    if (a.reason) metadata.reason = a.reason;
    if (a.schemaVersion || CONFIG.SCHEMA_VERSION) metadata.schema_version = a.schemaVersion || CONFIG.SCHEMA_VERSION;
    if (a.policyVersion || CONFIG.POLICY_VERSION) metadata.policy_version = a.policyVersion || CONFIG.POLICY_VERSION;

    const sql = `
    INSERT INTO audit_events
      (tenant_id, event_type, event_category, actor_id, actor_email, actor_role, actor_ip,
       target_type, target_id, target_name, action, result, changes, metadata, occurred_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
  `;

    const params = [
        a.tenantId,
        a.resource,              // event_type = resource (employees, contacts, etc.)
        eventCategory,           // event_category (auth, data, system, compliance, security)
        a.actorId ?? null,
        a.actorEmail ?? null,
        a.actorRole,
        a.actorIp ?? null,
        a.targetType ?? a.resource, // target_type defaults to resource
        a.targetId ?? null,
        a.targetName ?? null,
        a.action,
        result,
        a.changes ? JSON.stringify(a.changes) : null,
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    ];

    try {
        await pool.query(sql, params);
    } catch (err) {
        // Avoid throwing from audit to prevent disrupting main operations
        console.error('[Audit] Failed to record audit event:', err);
    }
}
