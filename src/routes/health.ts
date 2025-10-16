import { Router } from "express";
import { probeDb } from "../lib/db";
import { CONFIG } from "../config";

export const health = Router();

// GET /health: prove agent liveness + DB reachability + versions
health.get("/health", async (_req, res) => {
    const canReachDb = await probeDb();
    res.json({
        agent: canReachDb ? "online" : "degraded",
        canReachDb,
        schemaVersion: CONFIG.SCHEMA_VERSION,
        policyVersion: CONFIG.POLICY_VERSION,
    });
});
