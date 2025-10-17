/**
 * Test script for internal employees endpoints
 *
 * Usage:
 *   1. Start the agent server: npm start
 *   2. Run this test: node tests/test-internal-employees.js
 *
 * Requirements:
 *   - Server running on http://localhost:4001
 *   - AGENT_API_SECRET set (defaults to "dev-secret-change-in-prod")
 *   - Database populated with test data (see setup section)
 */

const API_BASE = process.env.API_BASE || "http://localhost:4001";
const AGENT_API_SECRET = process.env.AGENT_API_SECRET || "dev-secret-change-in-prod";

// Test tenant IDs (UUIDs)
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// Colors for terminal output
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
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
    log("\n[Test] Auth required for internal endpoints", YELLOW);

    // Test without secret header
    const res1 = await request("/employees/internal/employees.list?tenant_id=" + TENANT_A);
    assert(res1.status === 401, "Returns 401 without X-Agent-Secret header");
    assert(res1.data.error === "unauthorized", "Error is 'unauthorized'");

    // Test with wrong secret
    const res2 = await request(
        "/employees/internal/employees.list?tenant_id=" + TENANT_A,
        { "X-Agent-Secret": "wrong-secret" }
    );
    assert(res2.status === 403, "Returns 403 with wrong secret");
    assert(res2.data.error === "forbidden", "Error is 'forbidden'");
}

async function testEmployeesList() {
    log("\n[Test] GET /employees/internal/employees.list", YELLOW);

    // Test missing tenant_id
    const res1 = await request(
        "/employees/internal/employees.list",
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res1.status === 400, "Returns 400 when tenant_id is missing");
    assert(res1.data.error === "bad_request", "Error is 'bad_request'");

    // Test valid request (should return empty array if no data, or array with data)
    const res2 = await request(
        `/employees/internal/employees.list?tenant_id=${TENANT_A}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res2.status === 200, "Returns 200 for valid request");
    assert(res2.data.ok === true, "Response has ok: true");
    assert(Array.isArray(res2.data.data), "Response data is an array");

    log(`  ℹ Found ${res2.data.data.length} employees for tenant ${TENANT_A}`);

    // Verify response shape if data exists
    if (res2.data.data.length > 0) {
        const employee = res2.data.data[0];
        assert("id" in employee, "Employee has 'id' field");
        assert("tenant_id" in employee, "Employee has 'tenant_id' field");
        assert("email" in employee, "Employee has 'email' field");
        assert("display_name" in employee, "Employee has 'display_name' field (name aliased)");
        assert("version" in employee, "Employee has 'version' field");
        assert("created_at" in employee, "Employee has 'created_at' field");
        assert("updated_at" in employee, "Employee has 'updated_at' field");
    }
}

async function testEmployeesGet() {
    log("\n[Test] GET /employees/internal/employees.get", YELLOW);

    // Test missing parameters
    const res1 = await request(
        "/employees/internal/employees.get",
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res1.status === 400, "Returns 400 when id and tenant_id are missing");

    const res2 = await request(
        `/employees/internal/employees.get?id=11111111-1111-1111-1111-111111111111`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res2.status === 400, "Returns 400 when tenant_id is missing");

    // Test non-existent employee
    const fakeId = "99999999-9999-9999-9999-999999999999";
    const res3 = await request(
        `/employees/internal/employees.get?id=${fakeId}&tenant_id=${TENANT_A}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );
    assert(res3.status === 404, "Returns 404 for non-existent employee");
    assert(res3.data.error === "not_found", "Error is 'not_found'");

    log("\n  ℹ To test successful GET, first create an employee:");
    log(`  curl -X POST http://localhost:4001/employees \\`, YELLOW);
    log(`    -H "Content-Type: application/json" \\`, YELLOW);
    log(`    -d '{"email":"test@example.com","name":"Test User","phone":"123-456-7890"}'`, YELLOW);
    log(`  Then update the migration to set tenant_id, and test with the returned ID`, YELLOW);
}

async function testTenantIsolation() {
    log("\n[Test] Tenant isolation", YELLOW);

    // This test assumes you have data for different tenants
    // For now, just verify the query structure
    const resA = await request(
        `/employees/internal/employees.list?tenant_id=${TENANT_A}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    const resB = await request(
        `/employees/internal/employees.list?tenant_id=${TENANT_B}`,
        { "X-Agent-Secret": AGENT_API_SECRET }
    );

    assert(resA.status === 200, "Can query tenant A");
    assert(resB.status === 200, "Can query tenant B");

    log(`  ℹ Tenant A has ${resA.data.data.length} employees`);
    log(`  ℹ Tenant B has ${resB.data.data.length} employees`);
    log("  ℹ To verify isolation, create employees with different tenant_ids", YELLOW);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    log("\n" + "=".repeat(60), YELLOW);
    log("Internal Employees Endpoints Test Suite", YELLOW);
    log("=".repeat(60), YELLOW);
    log(`API Base: ${API_BASE}`);
    log(`Secret: ${AGENT_API_SECRET.substring(0, 10)}...`);

    try {
        await testAuthRequired();
        await testEmployeesList();
        await testEmployeesGet();
        await testTenantIsolation();

        log("\n" + "=".repeat(60), YELLOW);
        log(`Tests completed: ${passCount} passed, ${failCount} failed`,
            failCount === 0 ? GREEN : RED);
        log("=".repeat(60), YELLOW);

        process.exit(failCount > 0 ? 1 : 0);
    } catch (error) {
        log("\nTest suite failed with error:", RED);
        console.error(error);
        process.exit(1);
    }
}

main();
