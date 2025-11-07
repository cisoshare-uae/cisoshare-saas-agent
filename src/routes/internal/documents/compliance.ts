/**
 * Agent Internal API - MCP Compliance Storage
 *
 * Routes for storing MCP ADHICS compliance check results
 * The actual MCP analysis is done in Platform layer via ADHICSComplianceService
 * This layer stores the results in the database for auditing and history
 *
 * Base path: /agent/internal/documents/:documentId/compliance
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";

export const complianceRouter = Router({ mergeParams: true });

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
 * Transform compliance check from snake_case to camelCase
 */
function transformComplianceCheck(check: any) {
    if (!check) return null;

    return {
        id: check.id,
        documentId: check.document_id,
        tenantId: check.tenant_id,
        checkType: check.check_type,
        overallCompliance: parseFloat(check.overall_compliance),
        adhicsDomain: check.adhics_domain,
        documentType: check.document_type,
        sectionChecks: check.section_checks,
        missingSections: check.missing_sections,
        incompleteSections: check.incomplete_sections,
        nonCompliantContent: check.non_compliant_content,
        recommendations: check.recommendations,
        mcpVersion: check.mcp_version,
        mcpRequirementsChecked: check.mcp_requirements_checked,
        mcpChecklistId: check.mcp_checklist_id,
        mcpCallDurationMs: check.mcp_call_duration_ms,
        aiModel: check.ai_model,
        aiPromptTokens: check.ai_prompt_tokens,
        aiCompletionTokens: check.ai_completion_tokens,
        aiProcessingTimeMs: check.ai_processing_time_ms,
        extractedMetadata: check.extracted_metadata,
        checkedAt: check.checked_at,
        checkedBy: check.checked_by
    };
}

/**
 * POST /agent/internal/documents/:documentId/compliance/checks
 * Store MCP compliance check result
 */
complianceRouter.post("/checks", requireInternalAuth, async (req, res) => {
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
            check_type,
            overall_compliance,
            adhics_domain,
            document_type,
            section_checks,
            missing_sections,
            incomplete_sections,
            non_compliant_content,
            recommendations,
            mcp_version,
            mcp_requirements_checked,
            mcp_checklist_id,
            mcp_call_duration_ms,
            ai_model,
            ai_prompt_tokens,
            ai_completion_tokens,
            ai_processing_time_ms,
            extracted_metadata,
            checked_by
        } = req.body;

        // Validate required fields
        if (!check_type || overall_compliance === undefined || !section_checks || !recommendations) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "check_type, overall_compliance, section_checks, and recommendations are required"
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

        // Insert compliance check
        const insertQuery = `
            INSERT INTO document_compliance_checks (
                document_id,
                tenant_id,
                check_type,
                overall_compliance,
                adhics_domain,
                document_type,
                section_checks,
                missing_sections,
                incomplete_sections,
                non_compliant_content,
                recommendations,
                mcp_version,
                mcp_requirements_checked,
                mcp_checklist_id,
                mcp_call_duration_ms,
                ai_model,
                ai_prompt_tokens,
                ai_completion_tokens,
                ai_processing_time_ms,
                extracted_metadata,
                checked_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
            )
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            documentId,
            tenantId,
            check_type,
            overall_compliance,
            adhics_domain,
            document_type,
            JSON.stringify(section_checks),
            missing_sections,
            incomplete_sections,
            non_compliant_content ? JSON.stringify(non_compliant_content) : null,
            JSON.stringify(recommendations),
            mcp_version,
            mcp_requirements_checked,
            mcp_checklist_id,
            mcp_call_duration_ms,
            ai_model,
            ai_prompt_tokens,
            ai_completion_tokens,
            ai_processing_time_ms,
            extracted_metadata ? JSON.stringify(extracted_metadata) : null,
            checked_by || actorId
        ]);

        // Update document compliance score (trigger does this, but we can also do it explicitly)
        await pool.query(
            `UPDATE documents
             SET
                 mcp_compliance_score = $3,
                 last_mcp_check = NOW(),
                 mcp_version = $4,
                 mcp_requirements_checked = $5,
                 updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [
                tenantId,
                documentId,
                overall_compliance,
                mcp_version,
                mcp_requirements_checked
            ]
        );

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "compliance_checks",
            resourceId: result.rows[0].id,
            eventCategory: "compliance",
            outcome: "success",
            metadata: { check_type, overall_compliance, adhics_domain },
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformComplianceCheck(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[compliance.store] Error storing compliance check:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "create",
            resource: "compliance_checks",
            resourceId: req.params.documentId,
            eventCategory: "compliance",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to store compliance check"
        });
    }
});

/**
 * GET /agent/internal/documents/:documentId/compliance/latest
 * Get latest compliance check for document
 */
complianceRouter.get("/latest", requireInternalAuth, async (req, res) => {
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

        const query = `
            SELECT * FROM document_compliance_checks
            WHERE tenant_id = $1 AND document_id = $2
            ORDER BY checked_at DESC
            LIMIT 1
        `;
        const result = await pool.query(query, [tenantId, documentId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "No compliance checks found for this document"
            });
        }

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "read",
            resource: "compliance_checks",
            resourceId: result.rows[0].id,
            eventCategory: "compliance",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformComplianceCheck(result.rows[0])
        });
    } catch (error: any) {
        console.error(`[compliance.getLatest] Error fetching latest compliance check:`, error);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get latest compliance check"
        });
    }
});

/**
 * GET /agent/internal/documents/:documentId/compliance/history
 * Get compliance check history for document
 */
complianceRouter.get("/history", requireInternalAuth, async (req, res) => {
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

        // Extract query parameters
        const limit = req.query.limit ? parseInt(String(req.query.limit)) : 10;

        const query = `
            SELECT * FROM document_compliance_checks
            WHERE tenant_id = $1 AND document_id = $2
            ORDER BY checked_at DESC
            LIMIT $3
        `;
        const result = await pool.query(query, [tenantId, documentId, limit]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "list",
            resource: "compliance_checks",
            resourceId: documentId,
            eventCategory: "compliance",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: result.rows.map(transformComplianceCheck)
        });
    } catch (error: any) {
        console.error(`[compliance.getHistory] Error fetching compliance history:`, error);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get compliance history"
        });
    }
});

/**
 * PUT /agent/internal/documents/:documentId/compliance/score
 * Update document MCP compliance score
 */
complianceRouter.put("/score", requireInternalAuth, async (req, res) => {
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
            mcp_compliance_score,
            mcp_version,
            mcp_requirements_checked
        } = req.body;

        // Validate required fields
        if (mcp_compliance_score === undefined) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "mcp_compliance_score is required"
            });
        }

        // Update document
        const updateQuery = `
            UPDATE documents
            SET
                mcp_compliance_score = $3,
                last_mcp_check = NOW(),
                mcp_version = COALESCE($4, mcp_version),
                mcp_requirements_checked = COALESCE($5, mcp_requirements_checked),
                updated_at = NOW()
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
            RETURNING mcp_compliance_score, last_mcp_check, mcp_version, mcp_requirements_checked
        `;

        const result = await pool.query(updateQuery, [
            tenantId,
            documentId,
            mcp_compliance_score,
            mcp_version,
            mcp_requirements_checked
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update_compliance_score",
            resource: "documents",
            resourceId: documentId,
            eventCategory: "compliance",
            outcome: "success",
            metadata: { mcp_compliance_score },
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: {
                mcpComplianceScore: parseFloat(result.rows[0].mcp_compliance_score),
                lastMcpCheck: result.rows[0].last_mcp_check,
                mcpVersion: result.rows[0].mcp_version,
                mcpRequirementsChecked: result.rows[0].mcp_requirements_checked
            }
        });
    } catch (error: any) {
        console.error(`[compliance.updateScore] Error updating compliance score:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update_compliance_score",
            resource: "documents",
            resourceId: req.params.documentId,
            eventCategory: "compliance",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update compliance score"
        });
    }
});
