"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.probeDb = probeDb;
// Postgres pool — BYOD principle: creds live here (customer side).
const pg_1 = require("pg");
const config_1 = require("../config");
exports.pool = new pg_1.Pool({ connectionString: config_1.CONFIG.DATABASE_URL });
// Tiny helper to check DB reachability
async function probeDb() {
    try {
        const r = await exports.pool.query("SELECT 1 as ok");
        return r.rows?.[0]?.ok === 1;
    }
    catch {
        return false;
    }
}
