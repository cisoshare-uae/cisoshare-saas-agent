/**
 * Agent Internal API - Template Fields Management
 * Base path: /agent/internal/templates/:templateId/fields
 *
 * Provides CRUD operations for template field definitions
 * Follows Agent route pattern with transformation at boundary
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformTemplateField, transformArray } from "../../../helpers/transform";

export const templateFieldsRouter = Router({ mergeParams: true });

/**
 * Extract actor context from request headers
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
 * GET /agent/internal/templates/:templateId/fields
 * List all fields for a template
 */
templateFieldsRouter.get("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const templateId = req.params.templateId;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "list", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        if (!templateId) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "list", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "template_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "Template ID required"
            });
        }

        // Query fields ordered by order_index
        const query = `
            SELECT * FROM template_fields
            WHERE tenant_id = $1 AND template_id = $2
            ORDER BY order_index ASC, created_at ASC
        `;
        const result = await pool.query(query, [tenantId, templateId]);

        await recordAudit({
            tenantId, actorId, actorEmail, actorRole, actorIp,
            action: "list", resource: "template_fields",
            eventCategory: "data", outcome: "success",
            resourceId: templateId, requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformArray(result.rows, transformTemplateField)
        });
    } catch (err) {
        console.error("[Agent] Error listing template fields:", err);
        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "list", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to list template fields"
        });
    }
});

/**
 * POST /agent/internal/templates/:templateId/fields
 * Create a new template field
 */
templateFieldsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const templateId = req.params.templateId;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "create", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        if (!templateId) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "create", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "template_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "Template ID required"
            });
        }

        const {
            fieldName,
            fieldLabel,
            fieldLabelAr,
            fieldType,
            dataSource,
            dataSourceEntity,
            dataSourceField,
            dataSourceQuery,
            isRequired,
            validationRules,
            defaultValue,
            placeholder,
            helpText,
            options,
            orderIndex,
            groupName,
            isConditional,
            conditionalLogic
        } = req.body;

        // Validate required fields
        if (!fieldName || !fieldLabel || !fieldType) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "create", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "validation_error", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "validation_error",
                message: "fieldName, fieldLabel, and fieldType are required"
            });
        }

        const query = `
            INSERT INTO template_fields (
                template_id, tenant_id, field_name, field_label, field_label_ar,
                field_type, data_source, data_source_entity, data_source_field,
                data_source_query, is_required, validation_rules, default_value,
                placeholder, help_text, options, order_index, group_name,
                is_conditional, conditional_logic
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
            RETURNING *
        `;

        const values = [
            templateId,
            tenantId,
            fieldName,
            fieldLabel,
            fieldLabelAr || null,
            fieldType,
            dataSource || null,
            dataSourceEntity || null,
            dataSourceField || null,
            dataSourceQuery || null,
            isRequired || false,
            validationRules || null,
            defaultValue || null,
            placeholder || null,
            helpText || null,
            options || null,
            orderIndex || 0,
            groupName || null,
            isConditional || false,
            conditionalLogic || null
        ];

        const result = await pool.query(query, values);
        const newField = result.rows[0];

        await recordAudit({
            tenantId, actorId, actorEmail, actorRole, actorIp,
            action: "create", resource: "template_fields",
            eventCategory: "data", outcome: "success",
            resourceId: newField.id, requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformTemplateField(newField)
        });
    } catch (err: any) {
        console.error("[Agent] Error creating template field:", err);

        // Handle unique constraint violation
        if (err.code === "23505" && err.constraint === "unique_template_field") {
            await recordAudit({
                tenantId: req.header("X-Tenant-Id") || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "create", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "duplicate_field_name", requestId: reqId
            });
            return res.status(409).json({
                ok: false, error: "duplicate_field_name",
                message: "A field with this name already exists in this template"
            });
        }

        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "create", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to create template field"
        });
    }
});

/**
 * GET /agent/internal/templates/:templateId/fields/:id
 * Get a single template field by ID
 */
templateFieldsRouter.get("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const { templateId, id } = req.params;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "read", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const query = `
            SELECT * FROM template_fields
            WHERE id = $1 AND tenant_id = $2 AND template_id = $3
        `;
        const result = await pool.query(query, [id, tenantId, templateId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "read", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "not_found", resourceId: id, requestId: reqId
            });
            return res.status(404).json({
                ok: false, error: "not_found",
                message: "Template field not found"
            });
        }

        await recordAudit({
            tenantId, actorId, actorEmail, actorRole, actorIp,
            action: "read", resource: "template_fields",
            eventCategory: "data", outcome: "success",
            resourceId: id, requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformTemplateField(result.rows[0])
        });
    } catch (err) {
        console.error("[Agent] Error getting template field:", err);
        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "read", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", resourceId: req.params.id, requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to get template field"
        });
    }
});

/**
 * PUT /agent/internal/templates/:templateId/fields/:id
 * Update a template field
 */
templateFieldsRouter.put("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const { templateId, id } = req.params;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "update", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const {
            fieldName,
            fieldLabel,
            fieldLabelAr,
            fieldType,
            dataSource,
            dataSourceEntity,
            dataSourceField,
            dataSourceQuery,
            isRequired,
            validationRules,
            defaultValue,
            placeholder,
            helpText,
            options,
            orderIndex,
            groupName,
            isConditional,
            conditionalLogic
        } = req.body;

        // Build dynamic update query
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (fieldName !== undefined) {
            updates.push(`field_name = $${paramCount++}`);
            values.push(fieldName);
        }
        if (fieldLabel !== undefined) {
            updates.push(`field_label = $${paramCount++}`);
            values.push(fieldLabel);
        }
        if (fieldLabelAr !== undefined) {
            updates.push(`field_label_ar = $${paramCount++}`);
            values.push(fieldLabelAr);
        }
        if (fieldType !== undefined) {
            updates.push(`field_type = $${paramCount++}`);
            values.push(fieldType);
        }
        if (dataSource !== undefined) {
            updates.push(`data_source = $${paramCount++}`);
            values.push(dataSource);
        }
        if (dataSourceEntity !== undefined) {
            updates.push(`data_source_entity = $${paramCount++}`);
            values.push(dataSourceEntity);
        }
        if (dataSourceField !== undefined) {
            updates.push(`data_source_field = $${paramCount++}`);
            values.push(dataSourceField);
        }
        if (dataSourceQuery !== undefined) {
            updates.push(`data_source_query = $${paramCount++}`);
            values.push(dataSourceQuery);
        }
        if (isRequired !== undefined) {
            updates.push(`is_required = $${paramCount++}`);
            values.push(isRequired);
        }
        if (validationRules !== undefined) {
            updates.push(`validation_rules = $${paramCount++}`);
            values.push(validationRules);
        }
        if (defaultValue !== undefined) {
            updates.push(`default_value = $${paramCount++}`);
            values.push(defaultValue);
        }
        if (placeholder !== undefined) {
            updates.push(`placeholder = $${paramCount++}`);
            values.push(placeholder);
        }
        if (helpText !== undefined) {
            updates.push(`help_text = $${paramCount++}`);
            values.push(helpText);
        }
        if (options !== undefined) {
            updates.push(`options = $${paramCount++}`);
            values.push(options);
        }
        if (orderIndex !== undefined) {
            updates.push(`order_index = $${paramCount++}`);
            values.push(orderIndex);
        }
        if (groupName !== undefined) {
            updates.push(`group_name = $${paramCount++}`);
            values.push(groupName);
        }
        if (isConditional !== undefined) {
            updates.push(`is_conditional = $${paramCount++}`);
            values.push(isConditional);
        }
        if (conditionalLogic !== undefined) {
            updates.push(`conditional_logic = $${paramCount++}`);
            values.push(conditionalLogic);
        }

        if (updates.length === 0) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "update", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "no_updates", resourceId: id, requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "No fields to update"
            });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id, tenantId, templateId);

        const query = `
            UPDATE template_fields
            SET ${updates.join(", ")}
            WHERE id = $${paramCount++} AND tenant_id = $${paramCount++} AND template_id = $${paramCount++}
            RETURNING *
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "update", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "not_found", resourceId: id, requestId: reqId
            });
            return res.status(404).json({
                ok: false, error: "not_found",
                message: "Template field not found"
            });
        }

        await recordAudit({
            tenantId, actorId, actorEmail, actorRole, actorIp,
            action: "update", resource: "template_fields",
            eventCategory: "data", outcome: "success",
            resourceId: id, requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformTemplateField(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error updating template field:", err);

        // Handle unique constraint violation
        if (err.code === "23505" && err.constraint === "unique_template_field") {
            await recordAudit({
                tenantId: req.header("X-Tenant-Id") || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "update", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "duplicate_field_name", resourceId: id, requestId: reqId
            });
            return res.status(409).json({
                ok: false, error: "duplicate_field_name",
                message: "A field with this name already exists in this template"
            });
        }

        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "update", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", resourceId: id, requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to update template field"
        });
    }
});

/**
 * DELETE /agent/internal/templates/:templateId/fields/:id
 * Delete a template field
 */
templateFieldsRouter.delete("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const { templateId, id } = req.params;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "delete", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const query = `
            DELETE FROM template_fields
            WHERE id = $1 AND tenant_id = $2 AND template_id = $3
            RETURNING id
        `;
        const result = await pool.query(query, [id, tenantId, templateId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "delete", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "not_found", resourceId: id, requestId: reqId
            });
            return res.status(404).json({
                ok: false, error: "not_found",
                message: "Template field not found"
            });
        }

        await recordAudit({
            tenantId, actorId, actorEmail, actorRole, actorIp,
            action: "delete", resource: "template_fields",
            eventCategory: "data", outcome: "success",
            resourceId: id, requestId: reqId
        });

        return res.json({
            ok: true,
            message: "Template field deleted successfully"
        });
    } catch (err) {
        console.error("[Agent] Error deleting template field:", err);
        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "delete", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", resourceId: id, requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to delete template field"
        });
    }
});

/**
 * POST /agent/internal/templates/:templateId/fields/reorder
 * Reorder template fields
 * Body: { fieldIds: string[] } - Array of field IDs in desired order
 */
templateFieldsRouter.post("/reorder", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    const templateId = req.params.templateId;

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorId, actorEmail, actorRole, actorIp,
                action: "reorder", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "tenant_id_missing", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const { fieldIds } = req.body;

        if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "reorder", resource: "template_fields",
                eventCategory: "data", outcome: "failure",
                reason: "validation_error", requestId: reqId
            });
            return res.status(400).json({
                ok: false, error: "validation_error",
                message: "fieldIds array is required"
            });
        }

        // Update order_index for each field
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            for (let i = 0; i < fieldIds.length; i++) {
                await client.query(
                    `UPDATE template_fields
                     SET order_index = $1, updated_at = NOW()
                     WHERE id = $2 AND tenant_id = $3 AND template_id = $4`,
                    [i, fieldIds[i], tenantId, templateId]
                );
            }

            await client.query("COMMIT");

            await recordAudit({
                tenantId, actorId, actorEmail, actorRole, actorIp,
                action: "reorder", resource: "template_fields",
                eventCategory: "data", outcome: "success",
                resourceId: templateId, requestId: reqId
            });

            // Fetch updated fields
            const result = await pool.query(
                `SELECT * FROM template_fields
                 WHERE tenant_id = $1 AND template_id = $2
                 ORDER BY order_index ASC`,
                [tenantId, templateId]
            );

            return res.json({
                ok: true,
                data: transformArray(result.rows, transformTemplateField)
            });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("[Agent] Error reordering template fields:", err);
        await recordAudit({
            tenantId: req.header("X-Tenant-Id") || "unknown",
            actorId, actorEmail, actorRole, actorIp,
            action: "reorder", resource: "template_fields",
            eventCategory: "data", outcome: "failure",
            reason: "internal_error", requestId: reqId
        });
        return res.status(500).json({
            ok: false, error: "internal_error",
            message: "Failed to reorder template fields"
        });
    }
});
