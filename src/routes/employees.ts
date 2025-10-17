import { Router } from "express";
import { pool } from "../lib/db";
import { checkPolicy } from "../policy";
import { recordAudit } from "../helpers/audit";
import { requireInternalAuth } from "../middleware/internalAuth";

export const employees = Router();

// Ephemeral idempotency cache for PoC
const idemCache = new Map<string, { id: string; email: string }>();

// CREATE/UPSERT
employees.post("/", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user"); // optional for create

    try {
        const idemKey = (req.header("Idempotency-Key") || "").trim();
        if (idemKey && idemCache.has(idemKey)) {
            const data = idemCache.get(idemKey)!;
            await recordAudit({
                requestId: reqId, actorRole, action: "create", resource: "employees",
                targetId: data.id, idempotencyKey: idemKey,
                decision: "n/a", outcome: "success", reason: "idempotent_hit"
            });
            return res.status(200).json({ ok: true, idempotent: true, data });
        }

        const { email, name, phone } = req.body || {};
        if (!email || !name) {
            await recordAudit({
                requestId: reqId, actorRole, action: "create", resource: "employees",
                decision: "n/a", outcome: "failure", reason: "validation_error"
            });
            return res.status(400).json({ ok: false, error: "email and name are required" });
        }

        const insertSQL = `
      INSERT INTO employees (email, name, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            version = employees.version + 1,
            updated_at = now()
      RETURNING id, email;
    `;
        const r = await pool.query(insertSQL, [email, name, phone || null]);
        const row = r.rows[0];
        if (idemKey) idemCache.set(idemKey, { id: row.id, email: row.email });

        await recordAudit({
            requestId: reqId, actorRole, action: "create", resource: "employees",
            targetId: row.id, idempotencyKey: idemKey || null,
            decision: "n/a", outcome: "success"
        });
        return res.status(201).json({ ok: true, data: { id: row.id, email: row.email } });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "create", resource: "employees",
            decision: "n/a", outcome: "failure", reason: "create_failed"
        });
        return res.status(500).json({ ok: false, error: "create_failed" });
    }
});


// LIST
employees.get("/", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const q = `
      SELECT id, email, name, phone, version, created_at, updated_at
      FROM employees
      ORDER BY created_at DESC
      LIMIT 50;
    `;
        const r = await pool.query(q);
        await recordAudit({
            requestId: reqId, actorRole, action: "list", resource: "employees",
            decision: "n/a", outcome: "success"
        });
        return res.json({ ok: true, data: r.rows });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "list", resource: "employees",
            decision: "n/a", outcome: "failure", reason: "list_failed"
        });
        return res.status(500).json({ ok: false, error: "list_failed" });
    }
});


// UPDATE (optimistic concurrency)
employees.put("/:id", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const id = String(req.params.id || "").trim();
        const { name, phone, version } = req.body || {};
        if (!id || typeof version !== "number") {
            await recordAudit({
                requestId: reqId, actorRole, action: "update", resource: "employees",
                targetId: id || null, decision: "n/a", outcome: "failure", reason: "validation_error"
            });
            return res.status(400).json({ ok: false, error: "id and version are required" });
        }

        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;

        if (typeof name === "string") { fields.push(`name = $${i++}`); values.push(name); }
        if (typeof phone === "string" || phone === null) { fields.push(`phone = $${i++}`); values.push(phone ?? null); }
        fields.push(`version = version + 1`, `updated_at = now()`);

        const sql = `
      UPDATE employees
         SET ${fields.join(", ")}
       WHERE id = $${i++} AND version = $${i++}
       RETURNING id, email, version;
    `;
        values.push(id, version);

        const r = await pool.query(sql, values);
        if (r.rowCount === 0) {
            await recordAudit({
                requestId: reqId, actorRole, action: "update", resource: "employees",
                targetId: id, decision: "n/a", outcome: "conflict", reason: "version_conflict"
            });
            return res.status(409).json({ ok: false, error: "version_conflict" });
        }

        const row = r.rows[0];
        await recordAudit({
            requestId: reqId, actorRole, action: "update", resource: "employees",
            targetId: row.id, decision: "n/a", outcome: "success"
        });
        return res.json({ ok: true, data: { id: row.id, email: row.email, version: row.version } });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "update", resource: "employees",
            decision: "n/a", outcome: "failure", reason: "update_failed"
        });
        return res.status(500).json({ ok: false, error: "update_failed" });
    }
});


// DELETE (policy-gated via OPA)
employees.delete("/:id", async (req, res) => {
    const reqId = (req as any).reqId as string;
    const actorRole = String(req.header("X-User-Role") || "user");

    try {
        const id = String(req.params.id || "").trim();
        if (!id) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "employees",
                decision: "deny", outcome: "failure", reason: "id_missing"
            });
            return res.status(400).json({ ok: false, error: "id_required" });
        }

        const allowed = await checkPolicy({
            action: "delete",
            resource: "employees",
            user: { role: actorRole },
        });

        if (!allowed) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "employees",
                targetId: id, decision: "deny", outcome: "forbidden", reason: "policy_denied"
            });
            return res.status(403).json({ ok: false, error: "forbidden" });
        }

        const r = await pool.query("DELETE FROM employees WHERE id = $1", [id]);
        if (r.rowCount === 0) {
            await recordAudit({
                requestId: reqId, actorRole, action: "delete", resource: "employees",
                targetId: id, decision: "allow", outcome: "not_found"
            });
            return res.status(404).json({ ok: false, error: "not_found" });
        }

        await recordAudit({
            requestId: reqId, actorRole, action: "delete", resource: "employees",
            targetId: id, decision: "allow", outcome: "success"
        });
        return res.json({ ok: true });
    } catch {
        await recordAudit({
            requestId: reqId, actorRole, action: "delete", resource: "employees",
            decision: "allow", outcome: "failure", reason: "delete_failed"
        });
        return res.status(500).json({ ok: false, error: "delete_failed" });
    }
});


// ============================================================================
// INTERNAL ENDPOINTS (read-only, auth-gated)
// ============================================================================

// GET /internal/employees.list?tenant_id=<uuid>
employees.get("/internal/employees.list", requireInternalAuth, async (req, res) => {
    try {
        const tenantId = String(req.query.tenant_id || "").trim();
        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "tenant_id query parameter required"
            });
        }

        const q = `
            SELECT id, tenant_id, email, name AS display_name, phone, version, created_at, updated_at
            FROM employees
            WHERE tenant_id = $1
            ORDER BY created_at DESC
        `;
        const r = await pool.query(q, [tenantId]);
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to list employees"
        });
    }
});

// GET /internal/employees.get?id=<uuid>&tenant_id=<uuid>
employees.get("/internal/employees.get", requireInternalAuth, async (req, res) => {
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
            SELECT id, tenant_id, email, name AS display_name, phone, version, created_at, updated_at
            FROM employees
            WHERE id = $1 AND tenant_id = $2
        `;
        const r = await pool.query(q, [id, tenantId]);

        if (r.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Employee not found or tenant mismatch"
            });
        }

        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get employee"
        });
    }
});
