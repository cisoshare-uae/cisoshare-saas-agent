/**
 * Test script for agent_users CRUD operations and audit events
 *
 * Usage:
 *   1. Ensure database migrations are applied (including 0007_create_agent_users.sql)
 *   2. Start the agent server: npm start
 *   3. Run this test: node tests/test-agent-users-audit.js
 *
 * This test verifies:
 *   - agent_users CRUD operations work correctly
 *   - Optimistic concurrency control (version checking)
 *   - Audit events are created for all operations
 *   - Audit event structure matches employees/contacts pattern
 */

const API_BASE = process.env.API_BASE || "http://localhost:4001";
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Colors for terminal output
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;
let createdUserId = null;
let currentVersion = 1;

function log(msg, color = RESET) {
    console.log(color + msg + RESET);
}

function assert(condition, message) {
    if (condition) {
        passCount++;
        log(`  ✓ ${message}`, GREEN);
    } else {
        failCount++;
        log(`  ✗ ${message}`, RED);
    }
}

async function request(method, path, body = null, headers = {}) {
    const url = `${API_BASE}${path}`;
    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-User-Role": "admin",
            ...headers
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data };
}

async function getAuditEvents(limit = 10) {
    const res = await request("GET", `/audit?limit=${limit}`);
    return res.data.data || [];
}

// ============================================================================
// Test Suite
// ============================================================================

async function testCreateUser() {
    log("\n[Test 1] CREATE agent_user", YELLOW);

    const res = await request("POST", "/agent-users", {
        tenant_id: TENANT_ID,
        email: "test.user@example.com",
        display_name: "Test User",
        role: "admin",
        status: "active"
    });

    assert(res.status === 201, "Returns 201 on successful create");
    assert(res.data.ok === true, "Response has ok: true");
    assert(res.data.data.id !== undefined, "User has ID");
    assert(res.data.data.version === 1, "User version starts at 1");
    assert(res.data.data.email === "test.user@example.com", "Email matches");
    assert(res.data.data.role === "admin", "Role matches");
    assert(res.data.data.tenant_id === TENANT_ID, "Tenant ID matches");

    createdUserId = res.data.data.id;
    currentVersion = res.data.data.version;

    // Check audit event
    const audits = await getAuditEvents(5);
    const createAudit = audits.find(e => e.action === "create" && e.resource === "agent_users");

    assert(createAudit !== undefined, "CREATE audit event exists");
    assert(createAudit.outcome === "success", "Audit outcome is 'success'");
    assert(createAudit.target_id === createdUserId, "Audit target_id matches user ID");
    assert(createAudit.decision === "n/a", "Audit decision is 'n/a'");

    log(`  ℹ Created user ID: ${createdUserId}`, BLUE);
}

async function testListUsers() {
    log("\n[Test 2] LIST agent_users", YELLOW);

    const res = await request("GET", `/agent-users?tenant_id=${TENANT_ID}`);

    assert(res.status === 200, "Returns 200 on list");
    assert(res.data.ok === true, "Response has ok: true");
    assert(Array.isArray(res.data.data), "Response data is array");
    assert(res.data.data.length >= 1, "At least one user exists");

    const user = res.data.data.find(u => u.id === createdUserId);
    assert(user !== undefined, "Created user appears in list");

    // Check audit event
    const audits = await getAuditEvents(5);
    const listAudit = audits.find(e => e.action === "list" && e.resource === "agent_users");

    assert(listAudit !== undefined, "LIST audit event exists");
    assert(listAudit.outcome === "success", "Audit outcome is 'success'");
}

async function testUpdateUser() {
    log("\n[Test 3] UPDATE agent_user (with version check)", YELLOW);

    const res = await request("PUT", `/agent-users/${createdUserId}`, {
        display_name: "Updated Test User",
        status: "invited",
        version: currentVersion
    });

    assert(res.status === 200, "Returns 200 on successful update");
    assert(res.data.ok === true, "Response has ok: true");
    assert(res.data.data.version === currentVersion + 1, "Version incremented");
    assert(res.data.data.display_name === "Updated Test User", "Display name updated");
    assert(res.data.data.status === "invited", "Status updated");

    currentVersion = res.data.data.version;

    // Check audit event
    const audits = await getAuditEvents(5);
    const updateAudit = audits.find(e =>
        e.action === "update" &&
        e.resource === "agent_users" &&
        e.target_id === createdUserId
    );

    assert(updateAudit !== undefined, "UPDATE audit event exists");
    assert(updateAudit.outcome === "success", "Audit outcome is 'success'");
    assert(updateAudit.target_id === createdUserId, "Audit target_id matches");

    log(`  ℹ User version after update: ${currentVersion}`, BLUE);
}

async function testVersionConflict() {
    log("\n[Test 4] UPDATE with version conflict", YELLOW);

    const res = await request("PUT", `/agent-users/${createdUserId}`, {
        display_name: "Conflict Test",
        version: 1  // Old version
    });

    assert(res.status === 409, "Returns 409 on version conflict");
    assert(res.data.error === "version_conflict", "Error is 'version_conflict'");

    // Check audit event
    const audits = await getAuditEvents(5);
    const conflictAudit = audits.find(e =>
        e.action === "update" &&
        e.resource === "agent_users" &&
        e.outcome === "conflict"
    );

    assert(conflictAudit !== undefined, "CONFLICT audit event exists");
    assert(conflictAudit.reason === "version_conflict", "Audit reason is 'version_conflict'");
    assert(conflictAudit.outcome === "conflict", "Audit outcome is 'conflict'");
}

async function testValidationErrors() {
    log("\n[Test 5] Validation errors", YELLOW);

    // Missing required fields
    const res1 = await request("POST", "/agent-users", {
        email: "incomplete@example.com"
    });
    assert(res1.status === 400, "Returns 400 for missing tenant_id/role");

    // Invalid role
    const res2 = await request("POST", "/agent-users", {
        tenant_id: TENANT_ID,
        email: "badRole@example.com",
        role: "superuser"  // Invalid
    });
    assert(res2.status === 400, "Returns 400 for invalid role");

    // Check audit events for validation failures
    const audits = await getAuditEvents(5);
    const validationAudits = audits.filter(e =>
        e.resource === "agent_users" &&
        e.outcome === "failure" &&
        (e.reason === "validation_error" || e.reason === "invalid_role")
    );

    assert(validationAudits.length >= 1, "Validation error audit events exist");
}

async function testDeleteUser() {
    log("\n[Test 6] DELETE agent_user", YELLOW);

    const res = await request("DELETE", `/agent-users/${createdUserId}`);

    assert(res.status === 200, "Returns 200 on successful delete");
    assert(res.data.ok === true, "Response has ok: true");

    // Verify user is deleted
    const listRes = await request("GET", `/agent-users?tenant_id=${TENANT_ID}`);
    const deletedUser = listRes.data.data.find(u => u.id === createdUserId);
    assert(deletedUser === undefined, "Deleted user no longer appears in list");

    // Check audit event
    const audits = await getAuditEvents(5);
    const deleteAudit = audits.find(e =>
        e.action === "delete" &&
        e.resource === "agent_users" &&
        e.target_id === createdUserId
    );

    assert(deleteAudit !== undefined, "DELETE audit event exists");
    assert(deleteAudit.outcome === "success", "Audit outcome is 'success'");
    assert(deleteAudit.decision === "allow", "Audit decision is 'allow'");
}

async function testAuditStructure() {
    log("\n[Test 7] Audit event structure validation", YELLOW);

    const audits = await getAuditEvents(20);
    const agentUserAudits = audits.filter(e => e.resource === "agent_users");

    assert(agentUserAudits.length >= 4, "Multiple agent_users audit events exist");

    if (agentUserAudits.length > 0) {
        const audit = agentUserAudits[0];

        // Verify structure matches employees/contacts pattern
        assert("event_time" in audit, "Has event_time field");
        assert("actor_role" in audit, "Has actor_role field");
        assert("action" in audit, "Has action field");
        assert("resource" in audit, "Has resource field");
        assert("decision" in audit, "Has decision field");
        assert("outcome" in audit, "Has outcome field");
        assert("request_id" in audit, "Has request_id field");
        assert("schema_version" in audit, "Has schema_version field");
        assert("policy_version" in audit, "Has policy_version field");

        assert(audit.resource === "agent_users", "Resource is 'agent_users'");
        assert(["create", "list", "update", "delete"].includes(audit.action), "Action is valid");
        assert(["allow", "deny", "n/a"].includes(audit.decision), "Decision is valid");
        assert(["success", "failure", "conflict", "forbidden", "not_found"].includes(audit.outcome), "Outcome is valid");

        log(`  ℹ Audit structure matches employees/contacts pattern`, BLUE);
    }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    log("\n" + "=".repeat(70), YELLOW);
    log("Agent Users CRUD & Audit Events Test Suite", YELLOW);
    log("=".repeat(70), YELLOW);
    log(`API Base: ${API_BASE}`);
    log(`Tenant ID: ${TENANT_ID}`);

    try {
        await testCreateUser();
        await testListUsers();
        await testUpdateUser();
        await testVersionConflict();
        await testValidationErrors();
        await testDeleteUser();
        await testAuditStructure();

        log("\n" + "=".repeat(70), YELLOW);
        log(`Tests completed: ${passCount} passed, ${failCount} failed`,
            failCount === 0 ? GREEN : RED);
        log("=".repeat(70), YELLOW);

        if (failCount === 0) {
            log("\n✅ All tests passed!", GREEN);
            log("✅ agent_users table has versioning (version INT column)", GREEN);
            log("✅ Optimistic concurrency control works (version conflicts)", GREEN);
            log("✅ Audit events created for all operations", GREEN);
            log("✅ Audit structure matches employees/contacts pattern", GREEN);
        }

        process.exit(failCount > 0 ? 1 : 0);
    } catch (error) {
        log("\nTest suite failed with error:", RED);
        console.error(error);
        process.exit(1);
    }
}

main();
