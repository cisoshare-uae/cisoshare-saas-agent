/**
 * Agent Internal API - Document Comments
 *
 * Routes for managing document comments and collaboration
 * Base path: /agent/internal/documents/:documentId/comments
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformComment, transformArray } from "../../../helpers/transform";

export const documentCommentsRouter = Router({ mergeParams: true });

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
 * GET /agent/internal/documents/:documentId/comments
 * Get all comments for a document
 *
 * Query params:
 * - include_internal: boolean (include internal comments)
 * - include_resolved: boolean (include resolved comments)
 */
documentCommentsRouter.get("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const includeInternal = req.query.include_internal === 'true';
        const includeResolved = req.query.include_resolved === 'true';

        if (!documentId || !tenantId) {
            await recordAudit({
                tenantId: tenantId || "unknown",
                actorRole,
                action: "list",
                resource: "documents",
                eventCategory: "data",
                targetId: documentId || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document id and X-Tenant-Id header required"
            });
        }

        // Build query with filters
        const conditions: string[] = [
            "document_id = $1",
            "tenant_id = $2",
            "deleted_at IS NULL"
        ];
        const params: any[] = [documentId, tenantId];

        if (!includeInternal) {
            conditions.push("is_internal = FALSE");
        }

        if (!includeResolved) {
            conditions.push("is_resolved = FALSE");
        }

        const query = `
            SELECT
                id,
                document_id,
                tenant_id,
                comment_text,
                comment_type,
                parent_comment_id,
                is_internal,
                is_resolved,
                resolved_by,
                resolved_at,
                created_by,
                author_id,
                author_name,
                author_role,
                has_attachments,
                attachments,
                created_at,
                updated_at
            FROM document_comments
            WHERE ${conditions.join(" AND ")}
            ORDER BY created_at ASC
        `;

        const result = await pool.query(query, params);

        await recordAudit({
            tenantId,
            actorRole,
            action: "list",
            resource: "documents",
            eventCategory: "data",
            targetId: documentId,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformArray(result.rows, transformComment)
        });
    } catch (err) {
        console.error("[Agent] Error getting document comments:", err);
        await recordAudit({
            tenantId: String(req.header("X-Tenant-Id") || "unknown"),
            actorRole,
            action: "list",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get document comments"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/comments
 * Add a comment to a document
 *
 * Body: {
 *   tenant_id: UUID,
 *   comment_text: string,
 *   comment_type: 'general' | 'review' | 'approval' | 'question' | 'suggestion' | 'issue' | 'change_request',
 *   parent_comment_id?: UUID,
 *   is_internal?: boolean,
 *   author_id?: UUID,
 *   author_name?: string,
 *   author_role?: string
 * }
 */
documentCommentsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const {
            tenant_id,
            comment_text,
            comment_type,
            parent_comment_id,
            is_internal,
            author_id,
            author_name,
            author_role
        } = req.body || {};

        // Validate required fields
        if (!documentId || !tenant_id || !comment_text || !comment_type) {
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                targetId: documentId || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document_id, tenant_id, comment_text, and comment_type are required"
            });
        }

        // Validate comment type
        const allowedCommentTypes = ['general', 'review', 'approval', 'change_request', 'issue', 'suggestion', 'question'];
        if (!allowedCommentTypes.includes(comment_type)) {
            await recordAudit({
                tenantId: tenant_id,
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                targetId: documentId,
                outcome: "failure",
                reason: "invalid_comment_type",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: `Invalid comment_type. Must be one of: ${allowedCommentTypes.join(', ')}`
            });
        }

        // Verify document exists and belongs to tenant
        const docCheck = await pool.query(
            "SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
            [documentId, tenant_id]
        );

        if (docCheck.rows.length === 0) {
            await recordAudit({
                tenantId: tenant_id,
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                targetId: documentId,
                outcome: "failure",
                reason: "document_not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found or tenant mismatch"
            });
        }

        // If parent_comment_id is provided, verify it exists
        if (parent_comment_id) {
            const parentCheck = await pool.query(
                "SELECT id FROM document_comments WHERE id = $1 AND document_id = $2 AND tenant_id = $3",
                [parent_comment_id, documentId, tenant_id]
            );

            if (parentCheck.rows.length === 0) {
                await recordAudit({
                    tenantId: tenant_id,
                    actorRole,
                    action: "create",
                    resource: "documents",
                    eventCategory: "data",
                    targetId: documentId,
                    outcome: "failure",
                    reason: "parent_comment_not_found",
                    requestId: reqId
                });
                return res.status(404).json({
                    ok: false,
                    error: "not_found",
                    message: "Parent comment not found"
                });
            }
        }

        const insertQuery = `
            INSERT INTO document_comments (
                document_id,
                tenant_id,
                comment_text,
                comment_type,
                parent_comment_id,
                is_internal,
                created_by,
                author_id,
                author_name,
                author_role
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING
                id,
                document_id,
                tenant_id,
                comment_text,
                comment_type,
                parent_comment_id,
                is_internal,
                is_resolved,
                created_by,
                author_id,
                author_name,
                author_role,
                has_attachments,
                attachments,
                created_at,
                updated_at
        `;

        const values = [
            documentId,
            tenant_id,
            comment_text,
            comment_type,
            parent_comment_id || null,
            is_internal || false,
            author_id || null,  // created_by for audit
            author_id || null,  // author_id for platform
            author_name || 'Unknown',
            author_role || 'member'
        ];

        const result = await pool.query(insertQuery, values);
        const newComment = result.rows[0];

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "create",
            resource: "documents",
            eventCategory: "data",
            targetId: documentId,
            targetName: `Comment on document ${documentId}`,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformComment(newComment)
        });
    } catch (err: any) {
        console.error("[Agent] Error adding document comment:", err);

        await recordAudit({
            tenantId: (req.body as any).tenant_id || "unknown",
            actorRole,
            action: "create",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to add document comment"
        });
    }
});

/**
 * PUT /agent/internal/documents/:documentId/comments/:commentId
 * Update a comment
 */
documentCommentsRouter.put("/:commentId", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const commentId = String(req.params.commentId || "").trim();
        const { tenant_id, comment_text } = req.body || {};

        if (!commentId || !tenant_id || !comment_text) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "comment_id, tenant_id, and comment_text are required"
            });
        }

        const updateQuery = `
            UPDATE document_comments
            SET comment_text = $1, updated_at = NOW()
            WHERE id = $2 AND document_id = $3 AND tenant_id = $4 AND deleted_at IS NULL
            RETURNING
                id, document_id, tenant_id, comment_text, comment_type,
                parent_comment_id, is_internal, is_resolved, created_by,
                author_id, author_name, author_role, created_at, updated_at
        `;

        const result = await pool.query(updateQuery, [comment_text, commentId, documentId, tenant_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Comment not found"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            targetId: commentId,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformComment(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error updating comment:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update comment"
        });
    }
});

/**
 * PUT /agent/internal/documents/:documentId/comments/:commentId/resolve
 * Mark a comment as resolved
 */
documentCommentsRouter.put("/:commentId/resolve", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const commentId = String(req.params.commentId || "").trim();
        const { tenant_id, resolved_by } = req.body || {};

        if (!commentId || !tenant_id) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "comment_id and tenant_id are required"
            });
        }

        const updateQuery = `
            UPDATE document_comments
            SET is_resolved = TRUE, resolved_by = $1, resolved_at = NOW(), updated_at = NOW()
            WHERE id = $2 AND document_id = $3 AND tenant_id = $4 AND deleted_at IS NULL
            RETURNING
                id, document_id, tenant_id, comment_text, comment_type,
                parent_comment_id, is_internal, is_resolved, resolved_by, resolved_at,
                created_by, author_id, author_name, author_role, created_at, updated_at
        `;

        const result = await pool.query(updateQuery, [resolved_by || null, commentId, documentId, tenant_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Comment not found"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            targetId: commentId,
            targetName: "Resolved comment",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformComment(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error resolving comment:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to resolve comment"
        });
    }
});

/**
 * DELETE /agent/internal/documents/:documentId/comments/:commentId
 * Delete a comment (soft delete)
 */
documentCommentsRouter.delete("/:commentId", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const commentId = String(req.params.commentId || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!commentId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "comment_id and X-Tenant-Id are required"
            });
        }

        const deleteQuery = `
            UPDATE document_comments
            SET deleted_at = NOW()
            WHERE id = $1 AND document_id = $2 AND tenant_id = $3 AND deleted_at IS NULL
            RETURNING id
        `;

        const result = await pool.query(deleteQuery, [commentId, documentId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Comment not found"
            });
        }

        await recordAudit({
            tenantId: tenantId,
            actorRole,
            action: "delete",
            resource: "documents",
            eventCategory: "data",
            targetId: commentId,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            message: "Comment deleted successfully"
        });
    } catch (err: any) {
        console.error("[Agent] Error deleting comment:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delete comment"
        });
    }
});
