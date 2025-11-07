/**
 * Agent Internal API - Document Sections Management
 *
 * Standardized REST endpoints for document section-level operations
 * Supports section-level versioning for ADHICS audit compliance
 *
 * Base path: /agent/internal/documents/:documentId/sections
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";

export const sectionsRouter = Router({ mergeParams: true });

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
 * Transform section from snake_case to camelCase
 */
function transformSection(section: any) {
    if (!section) return null;

    return {
        id: section.id,
        documentId: section.document_id,
        tenantId: section.tenant_id,
        sectionId: section.section_id,
        versionNumber: section.version_number,
        title: section.title,
        titleAr: section.title_ar,
        sectionType: section.section_type,
        content: section.content,
        contentHtml: section.content_html,
        orderIndex: section.order_index,
        level: section.level,
        parentSectionId: section.parent_section_id,
        adhicsReference: section.adhics_reference,
        mcpRequirementId: section.mcp_requirement_id,
        isRequired: section.is_required,
        isCompleted: section.is_completed,
        complianceStatus: section.compliance_status,
        complianceIssues: section.compliance_issues,
        complianceSuggestions: section.compliance_suggestions,
        lastMcpCheck: section.last_mcp_check,
        changeType: section.change_type,
        previousContent: section.previous_content,
        changeSummary: section.change_summary,
        changeReason: section.change_reason,
        createdBy: section.created_by,
        createdAt: section.created_at,
        updatedBy: section.updated_by,
        updatedAt: section.updated_at
    };
}

/**
 * GET /agent/internal/documents/:documentId/sections
 * Get all sections for a document
 */
sectionsRouter.get("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const documentId = req.params.documentId;

        if (!tenantId) {
            await recordAudit({
                tenantId: "unknown",
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "list",
                resource: "document_sections",
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

        // Extract query parameters
        const version = req.query.version ? parseInt(String(req.query.version)) : undefined;
        const sectionId = req.query.section_id ? String(req.query.section_id) : undefined;

        // Build query
        const conditions: string[] = ["tenant_id = $1", "document_id = $2"];
        const params: any[] = [tenantId, documentId];
        let paramIndex = 3;

        if (version !== undefined) {
            conditions.push(`version_number = $${paramIndex}`);
            params.push(version);
            paramIndex++;
        }

        if (sectionId) {
            conditions.push(`section_id = $${paramIndex}`);
            params.push(sectionId);
            paramIndex++;
        }

        // Get latest version of each section if no version specified
        let query: string;
        if (version === undefined && !sectionId) {
            query = `
                WITH latest_sections AS (
                    SELECT DISTINCT ON (section_id) *
                    FROM document_sections
                    WHERE ${conditions.join(" AND ")}
                    ORDER BY section_id, version_number DESC
                )
                SELECT * FROM latest_sections
                ORDER BY order_index ASC
            `;
        } else {
            query = `
                SELECT * FROM document_sections
                WHERE ${conditions.join(" AND ")}
                ORDER BY order_index ASC, version_number DESC
            `;
        }

        const result = await pool.query(query, params);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "document_sections",
            resourceId: documentId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: result.rows.map(transformSection)
        });
    } catch (error: any) {
        console.error(`[sections.list] Error listing sections:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "document_sections",
            resourceId: req.params.documentId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to list document sections"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/sections
 * Create or update a document section
 */
sectionsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const documentId = req.params.documentId;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const {
            section_id,
            title,
            title_ar,
            section_type,
            content,
            content_html,
            order_index,
            level = 1,
            parent_section_id,
            adhics_reference,
            mcp_requirement_id,
            is_required = false,
            change_summary,
            created_by
        } = req.body;

        // Validate required fields
        if (!section_id || !title || !section_type || !content || order_index === undefined) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "section_id, title, section_type, content, and order_index are required"
            });
        }

        // Check if document exists
        const docCheck = await pool.query(
            `SELECT id FROM documents
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, documentId]
        );

        if (docCheck.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        // Get previous version if exists
        const previousVersion = await pool.query(
            `SELECT content, version_number
             FROM document_sections
             WHERE tenant_id = $1 AND document_id = $2 AND section_id = $3
             ORDER BY version_number DESC
             LIMIT 1`,
            [tenantId, documentId, section_id]
        );

        const previousContent = previousVersion.rows.length > 0 ? previousVersion.rows[0].content : null;
        const changeType = previousVersion.rows.length === 0 ? 'added' : 'modified';

        // Insert new version
        const insertQuery = `
            INSERT INTO document_sections (
                document_id,
                tenant_id,
                section_id,
                title,
                title_ar,
                section_type,
                content,
                content_html,
                order_index,
                level,
                parent_section_id,
                adhics_reference,
                mcp_requirement_id,
                is_required,
                change_type,
                previous_content,
                change_summary,
                created_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18
            )
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            documentId,
            tenantId,
            section_id,
            title,
            title_ar,
            section_type,
            content,
            content_html,
            order_index,
            level,
            parent_section_id,
            adhics_reference,
            mcp_requirement_id,
            is_required,
            changeType,
            previousContent,
            change_summary,
            created_by || actorId
        ]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "document_sections",
            resourceId: result.rows[0].id,
            eventCategory: "data",
            outcome: "success",
            metadata: { section_id, change_type: changeType },
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformSection(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[sections.create] Error creating section:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "document_sections",
            resourceId: req.params.documentId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create document section"
        });
    }
});

/**
 * PUT /agent/internal/documents/:documentId/sections/:sectionId/compliance
 * Update section compliance status (from MCP check)
 */
sectionsRouter.put("/:sectionId/compliance", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const documentId = req.params.documentId;
        const sectionId = req.params.sectionId;

        if (!tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "X-Tenant-Id header required"
            });
        }

        const {
            compliance_status,
            compliance_issues,
            compliance_suggestions,
            is_completed,
            updated_by
        } = req.body;

        // Validate compliance_status
        const validStatuses = ['compliant', 'partially_compliant', 'non_compliant', 'not_checked', 'not_applicable'];
        if (compliance_status && !validStatuses.includes(compliance_status)) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: `Invalid compliance_status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        // Update the latest version of the section
        const updateQuery = `
            UPDATE document_sections
            SET
                compliance_status = COALESCE($4, compliance_status),
                compliance_issues = COALESCE($5, compliance_issues),
                compliance_suggestions = COALESCE($6, compliance_suggestions),
                is_completed = COALESCE($7, is_completed),
                last_mcp_check = NOW(),
                updated_by = $8,
                updated_at = NOW()
            WHERE tenant_id = $1
            AND document_id = $2
            AND section_id = $3
            AND version_number = (
                SELECT MAX(version_number)
                FROM document_sections
                WHERE tenant_id = $1 AND document_id = $2 AND section_id = $3
            )
            RETURNING *
        `;

        const result = await pool.query(updateQuery, [
            tenantId,
            documentId,
            sectionId,
            compliance_status,
            compliance_issues,
            compliance_suggestions,
            is_completed,
            updated_by || actorId
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Section not found"
            });
        }

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update_compliance",
            resource: "document_sections",
            resourceId: result.rows[0].id,
            eventCategory: "data",
            outcome: "success",
            metadata: { compliance_status },
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformSection(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[sections.updateCompliance] Error updating compliance:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update_compliance",
            resource: "document_sections",
            resourceId: req.params.sectionId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update section compliance"
        });
    }
});
