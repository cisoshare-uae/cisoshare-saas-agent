import { Router } from "express";
import { pool } from "../lib/db";

export const audit = Router();

// GET /audit: list latest N events (no sensitive data)
audit.get("/audit", async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    try {
        const q = `
      SELECT event_time, actor_role, action, resource, target_id,
             decision, outcome, reason, request_id, schema_version, policy_version
      FROM audit_events
      ORDER BY event_time DESC
      LIMIT $1
    `;
        const r = await pool.query(q, [limit]);
        res.json({ ok: true, data: r.rows });
    } catch {
        res.status(500).json({ ok: false, error: "audit_list_failed" });
    }
});
