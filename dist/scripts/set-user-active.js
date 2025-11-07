"use strict";
// agent/src/scripts/set-user-active.ts
// Manually set a user's status to 'active' for testing Deactivate/Restore UI
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../lib/db");
/**
 * Usage:
 * npx tsx agent/src/scripts/set-user-active.ts <email>
 *
 * Example:
 * npx tsx agent/src/scripts/set-user-active.ts test@test.com
 */
async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error("❌ Usage: npx tsx agent/src/scripts/set-user-active.ts <email>");
        process.exit(1);
    }
    console.log(`\n🔍 Looking for user: ${email}`);
    // Find the user
    const result = await db_1.pool.query(`SELECT id, email, role, status, version FROM agent_users WHERE email = $1`, [email]);
    if (result.rows.length === 0) {
        console.error(`❌ User not found: ${email}`);
        process.exit(1);
    }
    const user = result.rows[0];
    console.log(`\n✅ Found user:
  ID: ${user.id}
  Email: ${user.email}
  Role: ${user.role}
  Status: ${user.status} (version ${user.version})
`);
    if (user.status === "active") {
        console.log("ℹ️  User is already active. No changes needed.");
        process.exit(0);
    }
    // Update to active
    console.log(`\n🔄 Updating status to 'active'...`);
    const updateResult = await db_1.pool.query(`UPDATE agent_users
     SET status = 'active',
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, role, status, version`, [user.id]);
    const updated = updateResult.rows[0];
    console.log(`\n✅ User updated successfully:
  ID: ${updated.id}
  Email: ${updated.email}
  Role: ${updated.role}
  Status: ${updated.status} (version ${updated.version})
`);
    console.log(`\n🎉 Done! Now refresh the Team page to see the Deactivate button.`);
    process.exit(0);
}
main().catch((err) => {
    console.error("❌ Error:", err.message);
    console.error(err);
    process.exit(1);
});
