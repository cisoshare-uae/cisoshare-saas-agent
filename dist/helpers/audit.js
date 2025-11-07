"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAudit = recordAudit;
// Centralized ADHICS-compliant audit writer.
// Called by routes to record all database operations for compliance tracking.
// ADHICS Requirements: AC 5.1, IM 2.1, SA 3.1, TP 3.1, DP 4.1
// Keep it minimal and safe: never log raw PII payloads.
const db_1 = require("../lib/db");
const config_1 = require("../config");
async function recordAudit(a) {
    // Map outcome to result (normalize values)
    const resultMap = {
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
    const metadata = {};
    if (a.requestId)
        metadata.request_id = a.requestId;
    if (a.idempotencyKey)
        metadata.idempotency_key = a.idempotencyKey;
    if (a.decision)
        metadata.decision = a.decision;
    if (a.reason)
        metadata.reason = a.reason;
    if (a.schemaVersion || config_1.CONFIG.SCHEMA_VERSION)
        metadata.schema_version = a.schemaVersion || config_1.CONFIG.SCHEMA_VERSION;
    if (a.policyVersion || config_1.CONFIG.POLICY_VERSION)
        metadata.policy_version = a.policyVersion || config_1.CONFIG.POLICY_VERSION;
    const sql = `
    INSERT INTO audit_events
      (tenant_id, event_type, event_category, actor_id, actor_email, actor_role, actor_ip,
       target_type, target_id, target_name, action, result, changes, metadata, occurred_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
  `;
    const params = [
        a.tenantId,
        a.resource, // event_type = resource (employees, contacts, etc.)
        eventCategory, // event_category (auth, data, system, compliance, security)
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
        await db_1.pool.query(sql, params);
    }
    catch (err) {
        // Avoid throwing from audit to prevent disrupting main operations
        console.error('[Audit] Failed to record audit event:', err);
    }
}
