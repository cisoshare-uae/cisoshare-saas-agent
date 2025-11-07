/**
 * Agent Internal API - HR Employees
 *
 * Standardized REST endpoints for ADHICS HR Module 01 (Employee Management)
 * These routes follow the Agent API contract defined in boyd-saas-core
 *
 * Base path: /agent/internal/employees
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";

export const internalEmployeesRouter = Router();

/**
 * Extract actor context from request headers for ADHICS-compliant audit logging
 */
function getActorContext(req: any) {
    return {
        actorId: req.header("X-User-Id") || null,
        actorEmail: req.header("X-User-Email") || null,
        actorRole: String(req.header("X-User-Role") || "system"),
        actorIp: req.header("X-User-IP") || null,
    };
}

/**
 * GET /agent/internal/employees/list
 * List employees for a tenant with pagination, search, and filtering
 */
internalEmployeesRouter.get("/list", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        // Extract tenant ID from header (set by agentFetch)
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        // Extract query parameters
        const page = Math.max(1, parseInt(String(req.query.page || "1")));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"))));
        const search = String(req.query.search || "").trim();
        const status = String(req.query.status || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "list",
                resource: "employees",
                eventCategory: "data",
                outcome: "failure",
                reason: "tenant_id_missing",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        // Build dynamic WHERE clause
        const conditions: string[] = ["tenant_id = $1", "deleted_at IS NULL"];
        const params: any[] = [tenantId];
        let paramIndex = 2;

        // Add search filter (searches first_name, last_name, email, employee_number)
        if (search) {
            conditions.push(`(
                first_name ILIKE $${paramIndex} OR
                last_name ILIKE $${paramIndex} OR
                email ILIKE $${paramIndex} OR
                employee_number ILIKE $${paramIndex}
            )`);
            params.push(`%${search}%`);
            paramIndex++;
        }

        // Add status filter (old schema uses 'status' column)
        if (status && ['active', 'inactive', 'terminated', 'on-leave'].includes(status)) {
            conditions.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        // Calculate offset
        const offset = (page - 1) * limit;

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM employees
            WHERE ${conditions.join(" AND ")}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data (using old schema columns with aliases for compatibility)
        const dataQuery = `
            SELECT
                id,
                tenant_id,
                employee_number as employee_id,
                (first_name || ' ' || last_name) as full_name,
                email,
                phone,
                national_id,
                nationality,
                date_of_birth,
                department,
                job_title as position,
                hire_date,
                employment_type,
                status as employment_status,
                NULL::uuid as manager_id,
                version,
                created_at,
                updated_at
            FROM employees
            WHERE ${conditions.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const dataResult = await pool.query(dataQuery, params);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "employees",
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        // Return paginated response
        return res.json({
            ok: true,
            data: {
                employees: dataResult.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (err) {
        console.error("[Agent] Error listing employees:", err);
        const tenantId = String(req.header("X-Tenant-Id") || "unknown");
        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "employees",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to list employees"
        });
    }
});

/**
 * GET /agent/internal/employees/:id
 * Get a single employee by ID
 */
internalEmployeesRouter.get("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const id = String(req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!id || !tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorRole,
                action: "get",
                resource: "employees",
                eventCategory: "data",
                targetId: id || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "id parameter and X-Tenant-Id header required"
            });
        }

        const query = `
            SELECT
                id,
                tenant_id,
                employee_number as employee_id,
                (first_name || ' ' || last_name) as full_name,
                email,
                phone,
                national_id,
                nationality,
                date_of_birth,
                department,
                job_title as position,
                hire_date,
                employment_type,
                status as employment_status,
                NULL::uuid as manager_id,
                version,
                created_at,
                updated_at
            FROM employees
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        `;
        const result = await pool.query(query, [id, tenantId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId,
                actorRole,
                action: "get",
                resource: "employees",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Employee not found or tenant mismatch"
            });
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "get",
            resource: "employees",
            eventCategory: "data",
            targetId: id,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("[Agent] Error getting employee:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
            actorRole,
            action: "get",
            resource: "employees",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get employee"
        });
    }
});

/**
 * POST /agent/internal/employees
 * Create a new employee
 */
internalEmployeesRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const {
            tenant_id,
            employee_id,
            full_name,
            email,
            phone,
            national_id,
            nationality,
            date_of_birth,
            department,
            position,
            hire_date,
            employment_type,
            employment_status,
            manager_id
        } = req.body || {};

        // Validate required fields
        if (!tenant_id || !employee_id || !full_name) {
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "employees",
                eventCategory: "data",
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "tenant_id, employee_id, and full_name are required"
            });
        }

        // Split full_name into first_name and last_name (old schema compatibility)
        const nameParts = full_name.trim().split(/\s+/);
        const first_name = nameParts[0] || '';
        const last_name = nameParts.slice(1).join(' ') || '';

        const insertQuery = `
            INSERT INTO employees (
                tenant_id,
                employee_number,
                first_name,
                last_name,
                email,
                phone,
                national_id,
                nationality,
                date_of_birth,
                department,
                job_title,
                hire_date,
                employment_type,
                status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING
                id,
                tenant_id,
                employee_number as employee_id,
                (first_name || ' ' || last_name) as full_name,
                email,
                phone,
                national_id,
                nationality,
                date_of_birth,
                department,
                job_title as position,
                hire_date,
                employment_type,
                status as employment_status,
                NULL::uuid as manager_id,
                version,
                created_at,
                updated_at
        `;

        const values = [
            tenant_id,
            employee_id,           // maps to employee_number
            first_name,
            last_name,
            email || null,
            phone || null,
            national_id || null,
            nationality || null,
            date_of_birth || null,
            department || null,
            position || null,      // maps to job_title
            hire_date || null,
            employment_type || 'full-time',
            employment_status || 'active'  // maps to status
        ];

        const result = await pool.query(insertQuery, values);
        const newEmployee = result.rows[0];

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "create",
            resource: "employees",
            eventCategory: "data",
            targetId: newEmployee.id,
            targetName: full_name,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: newEmployee
        });
    } catch (err: any) {
        console.error("[Agent] Error creating employee:", err);

        // Handle unique constraint violation
        if (err.code === '23505') {
            await recordAudit({
                tenantId: (req.body as any).tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "employees",
                eventCategory: "data",
                outcome: "failure",
                reason: "duplicate_employee_id",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Employee ID already exists for this tenant"
            });
        }

        await recordAudit({
            tenantId: (req.body as any).tenant_id || "unknown",
            actorRole,
            action: "create",
            resource: "employees",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create employee"
        });
    }
});

/**
 * PUT /agent/internal/employees/:id
 * Update an existing employee (with optimistic locking)
 */
internalEmployeesRouter.put("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const id = String(req.params.id || "").trim();
        const { tenant_id, version, ...updateFields } = req.body || {};

        if (!id || !tenant_id || typeof version !== "number") {
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "update",
                resource: "employees",
                eventCategory: "data",
                targetId: id || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "id, tenant_id, and version are required"
            });
        }

        // Build dynamic SET clause (map new fields to old schema columns)
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Map new field names to old schema column names
        const fieldMapping: Record<string, string> = {
            'full_name': null, // Special handling - split into first_name + last_name
            'email': 'email',
            'phone': 'phone',
            'national_id': 'national_id',
            'nationality': 'nationality',
            'date_of_birth': 'date_of_birth',
            'department': 'department',
            'position': 'job_title',
            'hire_date': 'hire_date',
            'employment_type': 'employment_type',
            'employment_status': 'status',
            'manager_id': null // Not in old schema
        };

        // Handle full_name special case - split into first_name and last_name
        if (updateFields.full_name !== undefined) {
            const nameParts = updateFields.full_name.trim().split(/\s+/);
            const first_name = nameParts[0] || '';
            const last_name = nameParts.slice(1).join(' ') || '';

            fields.push(`first_name = $${paramIndex}`);
            values.push(first_name);
            paramIndex++;

            fields.push(`last_name = $${paramIndex}`);
            values.push(last_name);
            paramIndex++;
        }

        // Handle other fields
        for (const [newField, oldField] of Object.entries(fieldMapping)) {
            if (newField === 'full_name') continue; // Already handled
            if (oldField && updateFields[newField] !== undefined) {
                fields.push(`${oldField} = $${paramIndex}`);
                values.push(updateFields[newField]);
                paramIndex++;
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "No fields to update"
            });
        }

        // Add version increment and updated_at
        fields.push(`version = version + 1`);
        fields.push(`updated_at = NOW()`);

        const updateQuery = `
            UPDATE employees
            SET ${fields.join(", ")}
            WHERE id = $${paramIndex}
              AND tenant_id = $${paramIndex + 1}
              AND version = $${paramIndex + 2}
              AND deleted_at IS NULL
            RETURNING
                id,
                tenant_id,
                employee_number as employee_id,
                (first_name || ' ' || last_name) as full_name,
                email,
                phone,
                national_id,
                nationality,
                date_of_birth,
                department,
                job_title as position,
                hire_date,
                employment_type,
                status as employment_status,
                NULL::uuid as manager_id,
                version,
                created_at,
                updated_at
        `;
        values.push(id, tenant_id, version);

        const result = await pool.query(updateQuery, values);

        if (result.rowCount === 0) {
            await recordAudit({
                tenantId: tenant_id,
                actorRole,
                action: "update",
                resource: "employees",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "version_conflict_or_not_found",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Version conflict or employee not found"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "employees",
            eventCategory: "data",
            targetId: id,
            outcome: "success",
            changes: updateFields,
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("[Agent] Error updating employee:", err);
        await recordAudit({
            tenantId: (req.body as any).tenant_id || "unknown",
            actorRole,
            action: "update",
            resource: "employees",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update employee"
        });
    }
});

/**
 * DELETE /agent/internal/employees/:id
 * Soft delete an employee
 */
internalEmployeesRouter.delete("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const id = String(req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!id || !tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorRole,
                action: "delete",
                resource: "employees",
                eventCategory: "data",
                targetId: id || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "id parameter and X-Tenant-Id header required"
            });
        }

        const deleteQuery = `
            UPDATE employees
            SET deleted_at = NOW(),
                status = 'terminated'
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            RETURNING id
        `;

        const result = await pool.query(deleteQuery, [id, tenantId]);

        if (result.rowCount === 0) {
            await recordAudit({
                tenantId,
                actorRole,
                action: "delete",
                resource: "employees",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Employee not found or already deleted"
            });
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "delete",
            resource: "employees",
            eventCategory: "data",
            targetId: id,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: { id, deleted: true }
        });
    } catch (err) {
        console.error("[Agent] Error deleting employee:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
            actorRole,
            action: "delete",
            resource: "employees",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delete employee"
        });
    }
});
