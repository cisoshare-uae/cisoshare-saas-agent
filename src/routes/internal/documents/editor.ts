/**
 * Agent Internal API - Document Editor Management
 *
 * Standardized REST endpoints for document editor operations (save, autosave, get state)
 * These routes follow the Agent API contract defined in adhics-platform
 *
 * Base path: /agent/internal/documents/:documentId/editor
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformDocument, transformArray } from "../../../helpers/transform";
import crypto from "crypto";

export const editorRouter = Router({ mergeParams: true });

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
 * Generate SHA-256 hash of content
 */
function generateContentHash(content: any): string {
    const contentString = typeof content === 'string' ? content : JSON.stringify(content);
    return crypto.createHash('sha256').update(contentString).digest('hex');
}

/**
 * GET /agent/internal/documents/:documentId/editor
 * Get editor state for document
 */
editorRouter.get("/", requireInternalAuth, async (req, res) => {
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
                action: "read",
                resource: "editor_state",
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

        // Get document with editor fields
        const query = `
            SELECT
                id,
                title,
                editor_state,
                structured_content,
                content_format,
                template_id,
                version,
                updated_at
            FROM documents
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        `;
        const result = await pool.query(query, [tenantId, documentId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId,
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "read",
                resource: "editor_state",
                resourceId: documentId,
                eventCategory: "data",
                outcome: "failure",
                reason: "document_not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        const doc = result.rows[0];

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "read",
            resource: "editor_state",
            resourceId: documentId,
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: {
                id: doc.id,
                title: doc.title,
                editorState: doc.editor_state,
                structuredContent: doc.structured_content,
                contentFormat: doc.content_format,
                templateId: doc.template_id,
                version: doc.version,
                updatedAt: doc.updated_at
            }
        });
    } catch (error: any) {
        console.error(`[editor.getState] Error fetching editor state:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "read",
            resource: "editor_state",
            resourceId: req.params.documentId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get editor state"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/editor/save
 * Save document content (full save with validation and optimistic locking)
 */
editorRouter.post("/save", requireInternalAuth, async (req, res) => {
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
            editor_state,
            structured_content,
            content_format = "structured",
            change_summary,
            current_version,
            updated_by
        } = req.body;

        // Validate required fields
        if (!editor_state && !structured_content) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "Either editor_state or structured_content is required"
            });
        }

        // Check if document exists and get current version
        const existingDoc = await pool.query(
            `SELECT version FROM documents
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, documentId]
        );

        if (existingDoc.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        // Optimistic locking check
        if (current_version !== undefined && existingDoc.rows[0].version !== current_version) {
            await recordAudit({
                tenantId,
                actorId,
                actorEmail,
                actorRole,
                actorIp,
                action: "update",
                resource: "editor_state",
                resourceId: documentId,
                eventCategory: "data",
                outcome: "failure",
                reason: "version_conflict",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "version_conflict",
                message: "Document was modified by another user"
            });
        }

        // Generate content hash
        const contentHash = generateContentHash(structured_content || editor_state);

        // Update document
        const updateQuery = `
            UPDATE documents
            SET
                editor_state = $3,
                structured_content = $4,
                content_format = $5,
                content_hash = $6,
                change_summary = $7,
                updated_by = $8,
                updated_at = NOW(),
                version = version + 1
            WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
            RETURNING version, updated_at
        `;

        const result = await pool.query(updateQuery, [
            tenantId,
            documentId,
            editor_state ? JSON.stringify(editor_state) : null,
            structured_content ? JSON.stringify(structured_content) : null,
            content_format,
            contentHash,
            change_summary,
            updated_by || actorId
        ]);

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update",
            resource: "editor_state",
            resourceId: documentId,
            eventCategory: "data",
            outcome: "success",
            metadata: { change_summary },
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: {
                success: true,
                savedAt: result.rows[0].updated_at,
                version: result.rows[0].version,
                contentHash
            }
        });
    } catch (error: any) {
        console.error(`[editor.save] Error saving editor content:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "update",
            resource: "editor_state",
            resourceId: req.params.documentId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to save editor content"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/editor/autosave
 * Auto-save document content (non-blocking, no validation)
 */
editorRouter.post("/autosave", requireInternalAuth, async (req, res) => {
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
            editor_state,
            structured_content,
            updated_by
        } = req.body;

        // Return immediately - process in background
        res.json({
            ok: true,
            data: {
                success: true,
                message: "Auto-save in progress"
            }
        });

        // Background processing (after response sent)
        setImmediate(async () => {
            try {
                // Check if document exists
                const existingDoc = await pool.query(
                    `SELECT id FROM documents
                     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
                    [tenantId, documentId]
                );

                if (existingDoc.rows.length === 0) {
                    console.error(`[editor.autosave] Document not found: ${documentId}`);
                    return;
                }

                // Update only editor_state and structured_content (no version increment)
                await pool.query(
                    `UPDATE documents
                     SET
                         editor_state = COALESCE($3, editor_state),
                         structured_content = COALESCE($4, structured_content),
                         updated_by = $5,
                         updated_at = NOW()
                     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
                    [
                        tenantId,
                        documentId,
                        editor_state ? JSON.stringify(editor_state) : null,
                        structured_content ? JSON.stringify(structured_content) : null,
                        updated_by || actorId
                    ]
                );

                await recordAudit({
                    tenantId,
                    actorId,
                    actorEmail,
                    actorRole,
                    actorIp,
                    action: "autosave",
                    resource: "editor_state",
                    resourceId: documentId,
                    eventCategory: "data",
                    outcome: "success",
                    requestId: reqId
                });
            } catch (error: any) {
                console.error(`[editor.autosave] Background error:`, error);
                // Don't re-throw - autosave failures are non-critical
            }
        });
    } catch (error: any) {
        console.error(`[editor.autosave] Error in autosave:`, error);
        // Return success even on error (non-blocking)
        return res.json({
            ok: true,
            data: {
                success: true,
                message: "Auto-save queued"
            }
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/editor/populate-fields
 * Populate template fields in document
 */
editorRouter.post("/populate-fields", requireInternalAuth, async (req, res) => {
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

        const { field_values, updated_by } = req.body;

        if (!field_values || typeof field_values !== 'object') {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "field_values is required and must be an object"
            });
        }

        // Get document with template info
        const docQuery = await pool.query(
            `SELECT id, template_id, structured_content, editor_state
             FROM documents
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, documentId]
        );

        if (docQuery.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        const doc = docQuery.rows[0];

        if (!doc.template_id) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: "Document is not created from a template"
            });
        }

        // Get template fields
        const fieldsQuery = await pool.query(
            `SELECT field_name, field_label, field_type, is_required
             FROM template_fields
             WHERE tenant_id = $1 AND template_id = $2
             ORDER BY order_index ASC`,
            [tenantId, doc.template_id]
        );

        // Validate required fields
        const missingFields: string[] = [];
        for (const field of fieldsQuery.rows) {
            if (field.is_required && !field_values[field.field_name]) {
                missingFields.push(field.field_label);
            }
        }

        if (missingFields.length > 0) {
            return res.status(400).json({
                ok: false,
                error: "validation_error",
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        // Replace Mustache variables in structured_content
        let populatedContent = doc.structured_content || {};
        let contentString = JSON.stringify(populatedContent);

        for (const [fieldName, fieldValue] of Object.entries(field_values)) {
            const regex = new RegExp(`{{${fieldName}}}`, 'g');
            contentString = contentString.replace(regex, String(fieldValue));
        }

        populatedContent = JSON.parse(contentString);

        // Update editor_state if exists
        let populatedEditorState = doc.editor_state;
        if (populatedEditorState) {
            let editorString = JSON.stringify(populatedEditorState);
            for (const [fieldName, fieldValue] of Object.entries(field_values)) {
                const regex = new RegExp(`{{${fieldName}}}`, 'g');
                editorString = editorString.replace(regex, String(fieldValue));
            }
            populatedEditorState = JSON.parse(editorString);
        }

        // Update document with populated content
        await pool.query(
            `UPDATE documents
             SET
                 structured_content = $3,
                 editor_state = $4,
                 updated_by = $5,
                 updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [
                tenantId,
                documentId,
                JSON.stringify(populatedContent),
                populatedEditorState ? JSON.stringify(populatedEditorState) : null,
                updated_by || actorId
            ]
        );

        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "populate_fields",
            resource: "editor_state",
            resourceId: documentId,
            eventCategory: "data",
            outcome: "success",
            metadata: { fields_populated: Object.keys(field_values).length },
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: {
                success: true,
                populatedContent,
                editorState: populatedEditorState
            }
        });
    } catch (error: any) {
        console.error(`[editor.populateFields] Error populating fields:`, error);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorId,
            actorEmail,
            actorRole,
            actorIp,
            action: "populate_fields",
            resource: "editor_state",
            resourceId: req.params.documentId,
            eventCategory: "data",
            outcome: "failure",
            reason: error.message,
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to populate template fields"
        });
    }
});
