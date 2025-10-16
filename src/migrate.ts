/**
 * Tiny SQL migration runner:
 * - Ensures schema_migrations table exists
 * - Applies *.sql files in /migrations in order
 * - Records applied filenames to prevent re-running
 */
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { CONFIG } from "./config";

async function main() {
    const pool = new Pool({ connectionString: CONFIG.DATABASE_URL });
    try {
        // 1) Ensure tracking table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

        // 2) Read all .sql files sorted
        const dir = path.join(process.cwd(), "migrations");
        const all = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();

        // 3) Fetch already applied
        const appliedRes = await pool.query(`SELECT filename FROM schema_migrations`);
        const applied = new Set(appliedRes.rows.map(r => r.filename));

        // 4) Apply pending
        for (const file of all) {
            if (applied.has(file)) continue;
            const sql = fs.readFileSync(path.join(dir, file), "utf8");

            console.log(`Applying migration: ${file}`);
            await pool.query("BEGIN");
            try {
                await pool.query(sql);
                await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
                await pool.query("COMMIT");
            } catch (err) {
                await pool.query("ROLLBACK");
                console.error(`Migration failed: ${file}`, err);
                process.exit(1);
            }
        }

        console.log("Migrations up to date.");
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error("Migration runner error:", err);
    process.exit(1);
});
