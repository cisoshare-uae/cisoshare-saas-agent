/**
 * Agent Internal API - Document Parser Logging
 *
 * Endpoint for logging document parsing attempts to document_parsing_log table
 * Base path: /agent/internal/documents/:documentId/parser-log
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";

export const parserLogRouter = Router({ mergeParams: true });

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
 * POST /agent/internal/documents/:documentId/parser-log
 * Log a parsing attempt to document_parsing_log table
 */
parserLogRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const {
            source_file_type,
            source_file_size,
            parsing_method,
            status,
            sections_extracted,
            tables_extracted,
            images_extracted,
            confidence_score,
            ai_model,
            ai_processing_time_ms,
            errors,
            warnings,
            structured_content,
            extraction_metadata,
            parsing_duration_ms,
            parsed_by
        } = req.body || {};

        // Validate required fields
        if (!documentId || !tenantId || !source_file_type || !source_file_size || !parsing_method || !status || !parsed_by) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorRole,
                action: "create",
                resource: "document_parsing_log",
                eventCategory: "data",
                targetId: documentId || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "documentId, tenantId, source_file_type, source_file_size, parsing_method, status, and parsed_by are required"
            });
        }

        const insertQuery = `
            INSERT INTO document_parsing_log (
                id, document_id, tenant_id,
                source_file_type, source_file_size, parsing_method,
                status, sections_extracted, tables_extracted, images_extracted,
                confidence_score, ai_model, ai_processing_time_ms,
                errors, warnings, structured_content, extraction_metadata,
                parsing_duration_ms, parsed_at, parsed_by
            ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, NOW(), $18
            )
            RETURNING id
        `;

        const result = await pool.query(insertQuery, [
            documentId,
            tenantId,
            source_file_type,
            source_file_size,
            parsing_method,
            status,
            sections_extracted || 0,
            tables_extracted || 0,
            images_extracted || 0,
            confidence_score || null,
            ai_model || null,
            ai_processing_time_ms || null,
            errors || [],
            warnings || [],
            typeof structured_content === 'string' ? structured_content : JSON.stringify(structured_content || {}),
            typeof extraction_metadata === 'string' ? extraction_metadata : JSON.stringify(extraction_metadata || {}),
            parsing_duration_ms || 0,
            parsed_by
        ]);

        await recordAudit({
            tenantId,
            actorRole,
            action: "create",
            resource: "document_parsing_log",
            eventCategory: "data",
            targetId: documentId,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: { id: result.rows[0].id }
        });
    } catch (err) {
        console.error("[Agent] Error logging parsing attempt:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
            actorRole,
            action: "create",
            resource: "document_parsing_log",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to log parsing attempt"
        });
    }
});
