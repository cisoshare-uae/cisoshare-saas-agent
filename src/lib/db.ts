// Postgres pool — BYOD principle: creds live here (customer side).
import { Pool } from "pg";
import { CONFIG } from "../config";

export const pool = new Pool({ connectionString: CONFIG.DATABASE_URL });

// Tiny helper to check DB reachability
export async function probeDb(): Promise<boolean> {
    try {
        const r = await pool.query("SELECT 1 as ok");
        return r.rows?.[0]?.ok === 1;
    } catch {
        return false;
    }
}
