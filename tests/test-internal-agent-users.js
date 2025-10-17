/**
 * Test script for internal agent_users endpoints
 * Focuses on robustness: empty arrays, proper error codes, no 500s on happy path
 *
 * Usage:
 *   1. Start the agent server: npm start
 *   2. Run this test: node tests/test-internal-agent-users.js
 *
 * Requirements:
 *   - Server running on http://localhost:4001
 *   - AGENT_API_SECRET set (defaults to "dev-secret-change-in-prod")
 *   - Database with agent_users table created (migration 0007)
 */

const API_BASE = process.env.API_BASE || "http://localhost:4001";
const AGENT_API_SECRET = process.env.AGENT_API_SECRET || "dev-secret-change-in-prod";

// Test tenant ID (UUID) - use one that doesn't exist to test empty array
const EMPTY_TENANT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const TEST_TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Colors for terminal output
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

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

async function request(path, headers = {}) {
    const url = `${API_BASE}${path}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    return { status: response.status, data };
}

// ============================================================================
// Test Suite
// ============================================================================

async function testAuthRequired() {
    log("\n[Test 1] Auth required for internal endpoints", YELLOW);

    // Test without secret header
    const res1 = await request("/agent-users/internal/users.list?tenant_id=" + TEST_TENANT);
    assert(res1.status === 401, "Returns 401 without X-Agent-Secret header");
    assert(res1.data.error === "unauthorized", "Error is 'unauthorized'");

    // Test with wrong secret
    const res2 = await request(
        "/agent-users/internal/users.list?tenant_id=" + TEST_TENANT,
        { "X-Agent-Secret": "wrong-secret" }
    );
    assert(res2.status === 403, "Returns 403 with wrong secret");
    assert(res2.data.error === "forbidden", "Error is 'forbidden'");
}

async function testMissingTenantId() {
    log("\n[Test 2] Missing tenant_id validation", YELLOW);

    const res = await request(
        "/agent-users/internal/users.list",
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    assert(res.status === 400, "Returns 400 when tenant_id is missing");
    assert(res.data.ok === false, "Response has ok: false");
    assert(res.data.error === "tenant_id_required", "Error code is 'tenant_id_required'");
    assert(res.data.message === "tenant_id query parameter required", "Has proper error message");
}

async function testEmptyArray() {
    log("\n[Test 3] Empty array for tenant with no users (no 500s)", YELLOW);

    const res = await request(
        `/agent-users/internal/users.list?tenant_id=${EMPTY_TENANT}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    assert(res.status === 200, "Returns 200 for empty tenant");
    assert(res.data.ok === true, "Response has ok: true");
    assert(Array.isArray(res.data.data), "Response data is an array");
    assert(res.data.data.length === 0, "Array is empty for tenant with no users");

    log(`  ℹ Verified: Empty table returns [] not 500`, BLUE);
}

async function testValidRequest() {
    log("\n[Test 4] Valid request with proper schema", YELLOW);

    const res = await request(
        `/agent-users/internal/users.list?tenant_id=${TEST_TENANT}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    assert(res.status === 200, "Returns 200 for valid request");
    assert(res.data.ok === true, "Response has ok: true");
    assert(Array.isArray(res.data.data), "Response data is an array");

    log(`  ℹ Found ${res.data.data.length} users for tenant ${TEST_TENANT}`, BLUE);

    // Verify response shape if data exists
    if (res.data.data.length > 0) {
        const user = res.data.data[0];
        assert("id" in user, "User has 'id' field");
        assert("tenant_id" in user, "User has 'tenant_id' field");
        assert("email" in user, "User has 'email' field");
        assert("display_name" in user, "User has 'display_name' field (NOT 'name')");
        assert("role" in user, "User has 'role' field");
        assert("status" in user, "User has 'status' field");
        assert("employee_id" in user, "User has 'employee_id' field");
        assert("version" in user, "User has 'version' field");
        assert("created_at" in user, "User has 'created_at' field");
        assert("updated_at" in user, "User has 'updated_at' field");
        assert(!("name" in user), "User does NOT have 'name' field (uses display_name)");

        log(`  ℹ Verified: All schema fields present`, BLUE);
    } else {
        log(`  ℹ No users found - create one to test schema`, BLUE);
    }
}

async function testUsersGet() {
    log("\n[Test 5] GET /agent-users/internal/users.get", YELLOW);

    // Test missing parameters
    const res1 = await request(
        "/agent-users/internal/users.get",
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res1.status === 400, "Returns 400 when id and tenant_id are missing");
    assert(res1.data.error === "bad_request", "Error is 'bad_request'");

    const res2 = await request(
        `/agent-users/internal/users.get?id=11111111-1111-1111-1111-111111111111`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res2.status === 400, "Returns 400 when tenant_id is missing");

    // Test non-existent user
    const fakeId = "99999999-9999-9999-9999-999999999999";
    const res3 = await request(
        `/agent-users/internal/users.get?id=${fakeId}&tenant_id=${EMPTY_TENANT}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res3.status === 404, "Returns 404 for non-existent user");
    assert(res3.data.error === "not_found", "Error is 'not_found'");
}

async function testNoNameColumn() {
    log("\n[Test 6] Verify query uses display_name NOT name", YELLOW);

    // This test verifies the query doesn't select a non-existent 'name' column
    // If the query had 'name', it would fail with a DB error (500)
    const res = await request(
        `/agent-users/internal/users.list?tenant_id=${EMPTY_TENANT}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    assert(res.status === 200, "No 500 error (query schema is correct)");
    assert(res.data.ok === true, "Response is successful");

    log(`  ℹ Verified: Query uses 'display_name' not 'name'`, BLUE);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    log("\n" + "=".repeat(70), YELLOW);
    log("Internal Agent Users Endpoints - Robustness Tests", YELLOW);
    log("=".repeat(70), YELLOW);
    log(`API Base: ${API_BASE}`);
    log(`Secret: ${AGENT_API_SECRET.substring(0, 10)}...`);
    log(`Empty Tenant ID: ${EMPTY_TENANT}`);
    log(`Test Tenant ID: ${TEST_TENANT}`);

    try {
        await testAuthRequired();
        await testMissingTenantId();
        await testEmptyArray();          // Key test for PROMPT-6
        await testValidRequest();
        await testUsersGet();
        await testNoNameColumn();        // Verifies schema fix

        log("\n" + "=".repeat(70), YELLOW);
        log(`Tests completed: ${passCount} passed, ${failCount} failed`,
            failCount === 0 ? GREEN : RED);
        log("=".repeat(70), YELLOW);

        if (failCount === 0) {
            log("\n✅ All robustness tests passed!", GREEN);
            log("✅ users.list returns empty array (not 500) for empty tables", GREEN);
            log("✅ Proper error codes (400 for validation, 404 for not found)", GREEN);
            log("✅ Query schema matches agent_users table (display_name not name)", GREEN);
            log("✅ No 500 errors on happy path", GREEN);
        }

        process.exit(failCount > 0 ? 1 : 0);
    } catch (error) {
        log("\nTest suite failed with error:", RED);
        console.error(error);
        process.exit(1);
    }
}

main();
