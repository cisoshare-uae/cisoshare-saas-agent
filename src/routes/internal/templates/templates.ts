/**
 * Agent Internal API - Document Template Management
 *
 * Standardized REST endpoints for ADHICS Document Template Module
 * These routes follow the Agent API contract defined in adhics-platform
 *
 * Base path: /agent/internal/templates
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformTemplate, transformArray } from "../../../helpers/transform";

export const templatesRouter = Router();

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
 * GET /agent/internal/templates/list
 * List document templates for a tenant with pagination and filtering
 */
templatesRouter.get("/list", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        // Extract tenant ID from header (set by agentFetch)
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        // Extract query parameters
        const page = Math.max(1, parseInt(String(req.query.page || "1")));
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || "20"))));
        const search = String(req.query.search || "").trim();
        const category = String(req.query.category || "").trim();
        const entityType = String(req.query.entity_type || "").trim();
        const isActive = req.query.is_active === "true" || req.query.is_active === undefined;
        const mcpGenerated = req.query.mcp_generated === "true" ? true : req.query.mcp_generated === "false" ? false : null;
        const sortBy = String(req.query.sort_by || "created_at");
        const sortOrder = String(req.query.sort_order || "desc").toUpperCase();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "list",
                resource: "templates",
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

        // Add search filter
        if (search) {
            conditions.push(`(
                template_name ILIKE $${paramIndex} OR
                template_code ILIKE $${paramIndex} OR
                description ILIKE $${paramIndex} OR
                title_ar ILIKE $${paramIndex} OR
                description_ar ILIKE $${paramIndex}
            )`);
            params.push(`%${search}%`);
            paramIndex++;
        }

        // Add category filter
        if (category) {
            conditions.push(`category = $${paramIndex}`);
            params.push(category);
            paramIndex++;
        }

        // Add entity type filter
        if (entityType) {
            conditions.push(`entity_type = $${paramIndex}`);
            params.push(entityType);
            paramIndex++;
        }

        // Add active filter
        if (isActive !== undefined) {
            conditions.push(`is_active = $${paramIndex}`);
            params.push(isActive);
            paramIndex++;
        }

        // Add MCP generated filter
        if (mcpGenerated !== null) {
            conditions.push(`mcp_generated = $${paramIndex}`);
            params.push(mcpGenerated);
            paramIndex++;
        }

        // Validate sort column
        const allowedSortColumns = ['created_at', 'updated_at', 'template_name', 'usage_count', 'last_used_at', 'rating'];
        const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
        const sortDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';

        // Calculate offset
        const offset = (page - 1) * pageSize;

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM document_templates
            WHERE ${conditions.join(" AND ")}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data
        const dataQuery = `
            SELECT
                id,
                tenant_id,
                template_name,
                template_code,
                description,
                category,
                entity_type,
                template_file_path,
                template_file_type,
                variables,
                is_active,
                require_approval,
                default_approval_workflow,
                has_expiry,
                default_validity_days,
                default_renewal_period_days,
                usage_count,
                last_used_at,
                version,
                adhics_domains,
                adhics_requirements,
                adhics_compliance_level,
                mcp_generated,
                mcp_version,
                mcp_last_sync,
                structured_sections,
                content_schema,
                title_ar,
                description_ar,
                language,
                complexity,
                estimated_time_minutes,
                required_approvals,
                tags,
                rating,
                thumbnail_url,
                created_by,
                created_at,
                updated_by,
                updated_at
            FROM document_templates
            WHERE ${conditions.join(" AND ")}
            ORDER BY ${sortColumn} ${sortDirection}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(pageSize, offset);

        const dataResult = await pool.query(dataQuery, params);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "templates",
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        // Return paginated response with transformed templates
        return res.json({
            ok: true,
            data: transformArray(dataResult.rows, transformTemplate),
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    } catch (error: any) {
        console.error(`[templates.list] Error listing templates:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "templates",
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to list templates"
        });
    }
});

/**
 * POST /agent/internal/templates
 * Create a new document template
 */
templatesRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: "unknown",
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "create",
                resource: "templates",
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

        // Extract and validate required fields
        const {
            template_name,
            template_code,
            description,
            category,
            entity_type,
            template_file_path,
            template_file_type,
            variables,
            is_active = true,
            require_approval = false,
            default_approval_workflow,
            has_expiry = false,
            default_validity_days,
            default_renewal_period_days,
            adhics_domains,
            adhics_requirements,
            adhics_compliance_level,
            mcp_generated = false,
            mcp_version,
            structured_sections,
            content_schema,
            title_ar,
            description_ar,
            language = 'both',
            complexity,
            estimated_time_minutes,
            required_approvals,
            tags,
            thumbnail_url
        } = req.body;

        // Validate required fields
        if (!template_name || !template_code || !category || !entity_type) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "template_name, template_code, category, and entity_type are required"
            });
        }

        // Check for duplicate template_code within tenant
        const duplicateCheck = await pool.query(
            `SELECT id FROM document_templates
             WHERE tenant_id = $1 AND template_code = $2 AND deleted_at IS NULL`,
            [tenantId, template_code]
        );

        if (duplicateCheck.rows.length > 0) {
            await recordAudit({
                tenantId,
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "create",
                resource: "templates",
                eventCategory: "data",
                outcome: "failure",
                reason: "duplicate_template_code",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "duplicate_error",
                message: "Template code already exists for this tenant"
            });
        }

        // Insert new template
        const insertQuery = `
            INSERT INTO document_templates (
                tenant_id,
                template_name,
                template_code,
                description,
                category,
                entity_type,
                template_file_path,
                template_file_type,
                variables,
                is_active,
                require_approval,
                default_approval_workflow,
                has_expiry,
                default_validity_days,
                default_renewal_period_days,
                adhics_domains,
                adhics_requirements,
                adhics_compliance_level,
                mcp_generated,
                mcp_version,
                structured_sections,
                content_schema,
                title_ar,
                description_ar,
                language,
                complexity,
                estimated_time_minutes,
                required_approvals,
                tags,
                thumbnail_url,
                created_by,
                updated_by,
                version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $31, 1
            )
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            tenantId,
            template_name,
            template_code,
            description,
            category,
            entity_type,
            template_file_path,
            template_file_type,
            variables ? JSON.stringify(variables) : null,
            is_active,
            require_approval,
            default_approval_workflow ? JSON.stringify(default_approval_workflow) : null,
            has_expiry,
            default_validity_days,
            default_renewal_period_days,
            adhics_domains,
            adhics_requirements,
            adhics_compliance_level,
            mcp_generated,
            mcp_version,
            structured_sections ? JSON.stringify(structured_sections) : null,
            content_schema ? JSON.stringify(content_schema) : null,
            title_ar,
            description_ar,
            language,
            complexity,
            estimated_time_minutes,
            required_approvals,
            tags,
            thumbnail_url,
            actorId
        ]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "templates",
            resourceId: result.rows[0].id,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformTemplate(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[templates.create] Error creating template:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "templates",
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create template"
        });
    }
});

/**
 * GET /agent/internal/templates/:id
 * Get a single document template by ID
 */
templatesRouter.get("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const templateId = req.params.id;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const query = `
            SELECT * FROM document_templates
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        `;
        const result = await pool.query(query, [tenantId, templateId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId,
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "read",
                resource: "templates",
                resourceId: templateId,
                eventCategory: "data",
                outcome: "failure",
                reason: "template_not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Template not found"
            });
        }

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "read",
            resource: "templates",
            resourceId: templateId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformTemplate(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[templates.get] Error fetching template:`, error);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to fetch template"
        });
    }
});

/**
 * PUT /agent/internal/templates/:id
 * Update a document template
 */
templatesRouter.put("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const templateId = req.params.id;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        // Check if template exists
        const existingTemplate = await pool.query(
            `SELECT version FROM document_templates
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, templateId]
        );

        if (existingTemplate.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Template not found"
            });
        }

        // Extract updatable fields
        const {
            template_name,
            description,
            category,
            entity_type,
            template_file_path,
            template_file_type,
            variables,
            is_active,
            require_approval,
            default_approval_workflow,
            has_expiry,
            default_validity_days,
            default_renewal_period_days,
            adhics_domains,
            adhics_requirements,
            adhics_compliance_level,
            mcp_version,
            mcp_last_sync,
            structured_sections,
            content_schema,
            title_ar,
            description_ar,
            language,
            complexity,
            estimated_time_minutes,
            required_approvals,
            tags,
            rating,
            thumbnail_url
        } = req.body;

        // Build dynamic UPDATE query
        const updates: string[] = [];
        const params: any[] = [tenantId, templateId];
        let paramIndex = 3;

        if (template_name !== undefined) {
            updates.push(`template_name = $${paramIndex}`);
            params.push(template_name);
            paramIndex++;
        }
        if (description !== undefined) {
            updates.push(`description = $${paramIndex}`);
            params.push(description);
            paramIndex++;
        }
        if (category !== undefined) {
            updates.push(`category = $${paramIndex}`);
            params.push(category);
            paramIndex++;
        }
        if (entity_type !== undefined) {
            updates.push(`entity_type = $${paramIndex}`);
            params.push(entity_type);
            paramIndex++;
        }
        if (template_file_path !== undefined) {
            updates.push(`template_file_path = $${paramIndex}`);
            params.push(template_file_path);
            paramIndex++;
        }
        if (template_file_type !== undefined) {
            updates.push(`template_file_type = $${paramIndex}`);
            params.push(template_file_type);
            paramIndex++;
        }
        if (variables !== undefined) {
            updates.push(`variables = $${paramIndex}`);
            params.push(JSON.stringify(variables));
            paramIndex++;
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${paramIndex}`);
            params.push(is_active);
            paramIndex++;
        }
        if (require_approval !== undefined) {
            updates.push(`require_approval = $${paramIndex}`);
            params.push(require_approval);
            paramIndex++;
        }
        if (default_approval_workflow !== undefined) {
            updates.push(`default_approval_workflow = $${paramIndex}`);
            params.push(JSON.stringify(default_approval_workflow));
            paramIndex++;
        }
        if (has_expiry !== undefined) {
            updates.push(`has_expiry = $${paramIndex}`);
            params.push(has_expiry);
            paramIndex++;
        }
        if (default_validity_days !== undefined) {
            updates.push(`default_validity_days = $${paramIndex}`);
            params.push(default_validity_days);
            paramIndex++;
        }
        if (default_renewal_period_days !== undefined) {
            updates.push(`default_renewal_period_days = $${paramIndex}`);
            params.push(default_renewal_period_days);
            paramIndex++;
        }
        if (adhics_domains !== undefined) {
            updates.push(`adhics_domains = $${paramIndex}`);
            params.push(adhics_domains);
            paramIndex++;
        }
        if (adhics_requirements !== undefined) {
            updates.push(`adhics_requirements = $${paramIndex}`);
            params.push(adhics_requirements);
            paramIndex++;
        }
        if (adhics_compliance_level !== undefined) {
            updates.push(`adhics_compliance_level = $${paramIndex}`);
            params.push(adhics_compliance_level);
            paramIndex++;
        }
        if (mcp_version !== undefined) {
            updates.push(`mcp_version = $${paramIndex}`);
            params.push(mcp_version);
            paramIndex++;
        }
        if (mcp_last_sync !== undefined) {
            updates.push(`mcp_last_sync = $${paramIndex}`);
            params.push(mcp_last_sync);
            paramIndex++;
        }
        if (structured_sections !== undefined) {
            updates.push(`structured_sections = $${paramIndex}`);
            params.push(JSON.stringify(structured_sections));
            paramIndex++;
        }
        if (content_schema !== undefined) {
            updates.push(`content_schema = $${paramIndex}`);
            params.push(JSON.stringify(content_schema));
            paramIndex++;
        }
        if (title_ar !== undefined) {
            updates.push(`title_ar = $${paramIndex}`);
            params.push(title_ar);
            paramIndex++;
        }
        if (description_ar !== undefined) {
            updates.push(`description_ar = $${paramIndex}`);
            params.push(description_ar);
            paramIndex++;
        }
        if (language !== undefined) {
            updates.push(`language = $${paramIndex}`);
            params.push(language);
            paramIndex++;
        }
        if (complexity !== undefined) {
            updates.push(`complexity = $${paramIndex}`);
            params.push(complexity);
            paramIndex++;
        }
        if (estimated_time_minutes !== undefined) {
            updates.push(`estimated_time_minutes = $${paramIndex}`);
            params.push(estimated_time_minutes);
            paramIndex++;
        }
        if (required_approvals !== undefined) {
            updates.push(`required_approvals = $${paramIndex}`);
            params.push(required_approvals);
            paramIndex++;
        }
        if (tags !== undefined) {
            updates.push(`tags = $${paramIndex}`);
            params.push(tags);
            paramIndex++;
        }
        if (rating !== undefined) {
            updates.push(`rating = $${paramIndex}`);
            params.push(rating);
            paramIndex++;
        }
        if (thumbnail_url !== undefined) {
            updates.push(`thumbnail_url = $${paramIndex}`);
            params.push(thumbnail_url);
            paramIndex++;
        }

        // Always update these fields
        updates.push(`updated_by = $${paramIndex}`);
        params.push(actorId);
        paramIndex++;

        updates.push(`updated_at = NOW()`);

        updates.push(`version = version + 1`);

        if (updates.length === 3) { // Only metadata updates (updated_by, updated_at, version)
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "No fields to update"
            });
        }

        const updateQuery = `
            UPDATE document_templates
            SET ${updates.join(", ")}
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
            RETURNING *
        `;

        const result = await pool.query(updateQuery, params);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update",
            resource: "templates",
            resourceId: templateId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformTemplate(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[templates.update] Error updating template:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update",
            resource: "templates",
            resourceId: req.params.id,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update template"
        });
    }
});

/**
 * DELETE /agent/internal/templates/:id
 * Soft delete a document template
 */
templatesRouter.delete("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const templateId = req.params.id;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        // Check if template exists and is not already deleted
        const existingTemplate = await pool.query(
            `SELECT id FROM document_templates
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, templateId]
        );

        if (existingTemplate.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Template not found"
            });
        }

        // Soft delete the template
        const deleteQuery = `
            UPDATE document_templates
            SET deleted_at = NOW(), updated_by = $3, updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
            RETURNING id
        `;

        await pool.query(deleteQuery, [tenantId, templateId, actorId]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "delete",
            resource: "templates",
            resourceId: templateId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            message: "Template deleted successfully"
        });
    } catch (error: any) {
        console.error(`[templates.delete] Error deleting template:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "delete",
            resource: "templates",
            resourceId: req.params.id,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delete template"
        });
    }
});

/**
 * POST /agent/internal/templates/:id/use
 * Record template usage and increment usage counter
 */
templatesRouter.post("/:id/use", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const templateId = req.params.id;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const {
            document_id,
            usage_context = "document_creation",
            fields_total,
            fields_completed,
            fields_auto_populated,
            completion_time_seconds
        } = req.body;

        if (!document_id) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "document_id is required"
            });
        }

        // Check if template exists
        const templateCheck = await pool.query(
            `SELECT id FROM document_templates
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, templateId]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Template not found"
            });
        }

        // Record usage in template_usage table
        const usageInsert = `
            INSERT INTO template_usage (
                template_id,
                tenant_id,
                document_id,
                used_by,
                usage_context,
                fields_total,
                fields_completed,
                fields_auto_populated,
                completion_time_seconds
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `;

        await pool.query(usageInsert, [
            templateId,
            tenantId,
            document_id,
            actorId,
            usage_context,
            fields_total,
            fields_completed,
            fields_auto_populated,
            completion_time_seconds
        ]);

        // Update template usage count and last_used_at
        const updateTemplate = `
            UPDATE document_templates
            SET
                usage_count = COALESCE(usage_count, 0) + 1,
                last_used_at = NOW(),
                updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *
        `;

        const result = await pool.query(updateTemplate, [tenantId, templateId]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "use",
            resource: "templates",
            resourceId: templateId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformTemplate(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[templates.use] Error recording template usage:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "use",
            resource: "templates",
            resourceId: req.params.id,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to record template usage"
        });
    }
});

/**
 * POST /agent/internal/templates/generate
 * Generate template from MCP ADHICS knowledge base
 * Note: The actual MCP integration happens in the Platform layer
 * This endpoint stores the generated template in the database
 */
templatesRouter.post("/generate", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        // Extract template data (already generated by Platform/MCP)
        const {
            template_name,
            template_code,
            description,
            category,
            entity_type,
            adhics_domains,
            adhics_requirements,
            adhics_compliance_level,
            mcp_version,
            structured_sections,
            content_schema,
            title_ar,
            description_ar,
            complexity,
            estimated_time_minutes,
            required_approvals,
            tags
        } = req.body;

        // Validate required fields
        if (!template_name || !template_code || !category || !entity_type) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "template_name, template_code, category, and entity_type are required"
            });
        }

        // Check for duplicate template_code
        const duplicateCheck = await pool.query(
            `SELECT id FROM document_templates
             WHERE tenant_id = $1 AND template_code = $2 AND deleted_at IS NULL`,
            [tenantId, template_code]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({
                ok: false,
                error: "duplicate_error",
                message: "Template code already exists for this tenant"
            });
        }

        // Insert MCP-generated template
        const insertQuery = `
            INSERT INTO document_templates (
                tenant_id,
                template_name,
                template_code,
                description,
                category,
                entity_type,
                is_active,
                adhics_domains,
                adhics_requirements,
                adhics_compliance_level,
                mcp_generated,
                mcp_version,
                mcp_last_sync,
                structured_sections,
                content_schema,
                title_ar,
                description_ar,
                language,
                complexity,
                estimated_time_minutes,
                required_approvals,
                tags,
                created_by,
                updated_by,
                version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, NOW(), $13, $14, $15, $16, $17, $18, $19,
                $20, $21, $22, $22, 1
            )
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            tenantId,
            template_name,
            template_code,
            description,
            category,
            entity_type,
            true, // is_active
            adhics_domains,
            adhics_requirements,
            adhics_compliance_level,
            true, // mcp_generated
            mcp_version,
            structured_sections ? JSON.stringify(structured_sections) : null,
            content_schema ? JSON.stringify(content_schema) : null,
            title_ar,
            description_ar,
            'both', // language
            complexity,
            estimated_time_minutes,
            required_approvals,
            tags,
            actorId
        ]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "generate",
            resource: "templates",
            resourceId: result.rows[0].id,
            eventCategory: "data",
            outcome: "success",
            metadata: { mcp_version, adhics_domains },
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformTemplate(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[templates.generate] Error generating template:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "generate",
            resource: "templates",
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to generate template"
        });
    }
});
