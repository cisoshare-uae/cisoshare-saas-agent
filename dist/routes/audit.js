"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = void 0;
const express_1 = require("express");
const db_1 = require("../lib/db");
exports.audit = (0, express_1.Router)();
// GET /audit: list latest N events (no sensitive data)
exports.audit.get("/audit", async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    try {
        const q = `
      SELECT
        id,
        tenant_id,
        occurred_at,
        event_type,
        event_category,
        actor_id,
        actor_email,
        actor_role,
        actor_ip,
        target_type,
        target_id,
        target_name,
        action,
        result,
        changes,
        metadata
      FROM audit_events
      ORDER BY occurred_at DESC
      LIMIT $1
    `;
        const r = await db_1.pool.query(q, [limit]);
        res.json({ ok: true, data: r.rows });
    }
    catch (err) {
        console.error('[Audit] Error fetching audit logs:', err);
        res.status(500).json({ ok: false, error: "audit_list_failed" });
    }
});
