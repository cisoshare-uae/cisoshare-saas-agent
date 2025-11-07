"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.health = void 0;
const express_1 = require("express");
const db_1 = require("../lib/db");
const config_1 = require("../config");
exports.health = (0, express_1.Router)();
// GET /health: prove agent liveness + DB reachability + versions
exports.health.get("/health", async (_req, res) => {
    const canReachDb = await (0, db_1.probeDb)();
    res.json({
        agent: canReachDb ? "online" : "degraded",
        canReachDb,
        schemaVersion: config_1.CONFIG.SCHEMA_VERSION,
        policyVersion: config_1.CONFIG.POLICY_VERSION,
    });
});
