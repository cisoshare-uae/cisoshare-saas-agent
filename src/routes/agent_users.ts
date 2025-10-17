import { Router } from "express";
import { pool } from "../lib/db";
import { checkPolicy } from "../policy";
import { recordAudit } from "../helpers/audit";
import { requireInternalAuth } from "../middleware/internalAuth";

export const agentUsers = Router();

// CREATE
agentUsers.post("/", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const { tenant_id, email, display_name, role, status, employee_id } = req.body || {};

        if (!tenant_id || !email || !role) {
            await recordAudit({
                requestId: reqId, actorRole, action: "create", resource: "agent_users",
                decision: "n/a", outcome: "failure", reason: "validation_error"
            });
            return res.status(400).json({
                ok: false,
                error: "tenant_id, email, and role are required"
            });
        }

        // Validate role
        if (!['owner', 'admin', 'member'].includes(role)) {
            await recordAudit({
                requestId: reqId, actorRole, action: "create", resource: "agent_users",
                decision: "n/a", outcome: "failure", reason: "invalid_role"
            });
            return res.status(400).json({
                ok: false,
                error: "role must be owner, admin, or member"
            });
        }

        const insertSQL = `
            INSERT INTO agent_users (tenant_id, email, display_name, role, status, employee_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, tenant_id, email, display_name, role, status, employee_id, version, created_at, updated_at
        `;
        const values = [
            tenant_id,
            email,
            display_name || null,
            role,
            status || 'invited',
            employee_id || null
        ];

        const r = await pool.query(insertSQL, values);
        const row = r.rows[0];

        await recordAudit({
            requestId: reqId, actorRole, action: "create", resource: "agent_users",
            targetId: row.id, decision: "n/a", outcome: "success"
        });

        return res.status(201).json({ ok: true, data: row });
    } catch (err: any) {
        // Check for unique constraint violation
        if (err.code === '23505') {
            await recordAudit({
                requestId: reqId, actorRole, action: "create", resource: "agent_users",
                decision: "n/a", outcome: "conflict", reason: "duplicate_email"
            });
            return res.status(409).json({
                ok: false,
                error: "user with this email already exists for tenant"
            });
        }

        await recordAudit({
            requestId: reqId, actorRole, action: "create", resource: "agent_users",
            decision: "n/a", outcome: "failure", reason: "create_failed"
        });
        return res.status(500).json({ ok: false, error: "create_failed" });
    }
});


// LIST
agentUsers.get("/", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const tenantId = req.query.tenant_id as string;

        if (!tenantId) {
            await recordAudit({
                requestId: reqId, actorRole, action: "list", resource: "agent_users",
                decision: "n/a", outcome: "failure", reason: "missing_tenant_id"
            });
            return res.status(400).json({
                ok: false,
                error: "tenant_id query parameter required"
            });
        }

        const q = `
            SELECT id, tenant_id, email, display_name, role, status, employee_id,
                   version, created_at, updated_at
            FROM agent_users
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT 100
        `;
        const r = await pool.query(q, [tenantId]);

        await recordAudit({
            requestId: reqId, actorRole, action: "list", resource: "agent_users",
            decision: "n/a", outcome: "success"
        });

        return res.json({ ok: true, data: r.rows });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "list", resource: "agent_users",
            decision: "n/a", outcome: "failure", reason: "list_failed"
        });
        return res.status(500).json({ ok: false, error: "list_failed" });
    }
});


// UPDATE (optimistic concurrency with version)
agentUsers.put("/:id", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const id = String(req.params.id || "").trim();
        const { display_name, role, status, employee_id, version } = req.body || {};

        if (!id || typeof version !== "number") {
            await recordAudit({
                requestId: reqId, actorRole, action: "update", resource: "agent_users",
                targetId: id || null, decision: "n/a", outcome: "failure", reason: "validation_error"
            });
            return res.status(400).json({
                ok: false,
                error: "id and version are required"
            });
        }

        // Build dynamic update fields
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;

        if (display_name !== undefined) {
            fields.push(`display_name = $${i++}`);
            values.push(display_name || null);
        }
        if (role !== undefined) {
            if (!['owner', 'admin', 'member'].includes(role)) {
                await recordAudit({
                    requestId: reqId, actorRole, action: "update", resource: "agent_users",
                    targetId: id, decision: "n/a", outcome: "failure", reason: "invalid_role"
                });
                return res.status(400).json({ ok: false, error: "invalid role" });
            }
            fields.push(`role = $${i++}`);
            values.push(role);
        }
        if (status !== undefined) {
            if (!['invited', 'active', 'revoked'].includes(status)) {
                await recordAudit({
                    requestId: reqId, actorRole, action: "update", resource: "agent_users",
                    targetId: id, decision: "n/a", outcome: "failure", reason: "invalid_status"
                });
                return res.status(400).json({ ok: false, error: "invalid status" });
            }
            fields.push(`status = $${i++}`);
            values.push(status);
        }
        if (employee_id !== undefined) {
            fields.push(`employee_id = $${i++}`);
            values.push(employee_id || null);
        }

        // Always increment version and update timestamp
        fields.push(`version = version + 1`, `updated_at = NOW()`);

        const sql = `
            UPDATE agent_users
            SET ${fields.join(", ")}
            WHERE id = $${i++} AND version = $${i++}
            RETURNING id, tenant_id, email, display_name, role, status, employee_id, version, created_at, updated_at
        `;
        values.push(id, version);

        const r = await pool.query(sql, values);

        if (r.rowCount === 0) {
            await recordAudit({
                requestId: reqId, actorRole, action: "update", resource: "agent_users",
                targetId: id, decision: "n/a", outcome: "conflict", reason: "version_conflict"
            });
            return res.status(409).json({ ok: false, error: "version_conflict" });
        }

        const row = r.rows[0];
        await recordAudit({
            requestId: reqId, actorRole, action: "update", resource: "agent_users",
            targetId: row.id, decision: "n/a", outcome: "success"
        });

        return res.json({ ok: true, data: row });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "update", resource: "agent_users",
            decision: "n/a", outcome: "failure", reason: "update_failed"
        });
        return res.status(500).json({ ok: false, error: "update_failed" });
    }
});


// DELETE (policy-gated via OPA)
agentUsers.delete("/:id", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const id = String(req.params.id || "").trim();
        if (!id) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "agent_users",
                decision: "deny", outcome: "failure", reason: "id_missing"
            });
            return res.status(400).json({ ok: false, error: "id_required" });
        }

        const allowed = await checkPolicy({
            action: "delete",
            resource: "agent_users",
            user: { role: actorRole },
        });

        if (!allowed) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "agent_users",
                targetId: id, decision: "deny", outcome: "forbidden", reason: "policy_denied"
            });
            return res.status(403).json({ ok: false, error: "forbidden" });
        }

        const r = await pool.query("DELETE FROM agent_users WHERE id = $1", [id]);

        if (r.rowCount === 0) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "agent_users",
                targetId: id, decision: "allow", outcome: "not_found"
            });
            return res.status(404).json({ ok: false, error: "not_found" });
        }

        await recordAudit({
            requestId: reqId, actorRole, action: "delete", resource: "agent_users",
            targetId: id, decision: "allow", outcome: "success"
        });

        return res.json({ ok: true });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "delete", resource: "agent_users",
            decision: "allow", outcome: "failure", reason: "delete_failed"
        });
        return res.status(500).json({ ok: false, error: "delete_failed" });
    }
});


// ============================================================================
// INTERNAL ENDPOINTS (read-only, auth-gated)
// ============================================================================

// GET /agent-users/internal/users.list?tenant_id=<uuid>
agentUsers.get("/internal/users.list", requireInternalAuth, async (req, res) => {
    try {
        const tenantId = String(req.query.tenant_id || "").trim();
        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "tenant_id_required",
                message: "tenant_id query parameter required"
            });
        }

        const q = `
            SELECT id, tenant_id, email, display_name, role, status, employee_id,
                   version, created_at, updated_at
            FROM agent_users
            WHERE tenant_id = $1
            ORDER BY created_at DESC
        `;
        const r = await pool.query(q, [tenantId]);
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        console.error("[users.list] Database error:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to list users"
        });
    }
});

// GET /agent-users/internal/users.get?id=<uuid>&tenant_id=<uuid>
agentUsers.get("/internal/users.get", requireInternalAuth, async (req, res) => {
    try {
        const id = String(req.query.id || "").trim();
        const tenantId = String(req.query.tenant_id || "").trim();

        if (!id || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "id and tenant_id query parameters required"
            });
        }

        const q = `
            SELECT id, tenant_id, email, display_name, role, status, employee_id,
                   version, created_at, updated_at
            FROM agent_users
            WHERE id = $1 AND tenant_id = $2
        `;
        const r = await pool.query(q, [id, tenantId]);

        if (r.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "User not found or tenant mismatch"
            });
        }

        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        console.error("[users.get] Database error:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get user"
        });
    }
});
