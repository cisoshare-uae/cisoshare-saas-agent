/**
 * Agent Internal API - Document Shares
 *
 * Routes for managing document sharing
 * Base path: /agent/internal/documents/:documentId/share
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformShare, transformArray } from "../../../helpers/transform";

export const documentSharesRouter = Router({ mergeParams: true });

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
 * GET /agent/internal/documents/:documentId/shares
 * Get all shares for a document
 */
documentSharesRouter.get("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!documentId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document_id and X-Tenant-Id header required"
            });
        }

        const query = `
            SELECT
                id,
                tenant_id,
                document_id,
                shared_by,
                shared_with_user_id,
                shared_with_email,
                share_type,
                password_protected,
                expires_at,
                max_access_count,
                current_access_count,
                is_active,
                revoked_at,
                revoked_by,
                revocation_reason,
                created_at,
                last_accessed_at
            FROM document_shares
            WHERE document_id = $1 AND tenant_id = $2
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query, [documentId, tenantId]);

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
            data: transformArray(result.rows, transformShare)
        });
    } catch (err) {
        console.error("[Agent] Error getting document shares:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get document shares"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/share
 * Share a document
 *
 * Body: {
 *   tenant_id: UUID,
 *   shared_by: UUID,
 *   shared_with_user_id?: UUID,
 *   shared_with_email?: string,
 *   share_type: 'view' | 'download' | 'comment' | 'edit',
 *   password_protected?: boolean,
 *   password_hash?: string,
 *   expires_at?: string,
 *   max_access_count?: number
 * }
 */
documentSharesRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const {
            tenant_id,
            shared_by,
            shared_with_user_id,
            shared_with_email,
            share_type,
            password_protected,
            password_hash,
            expires_at,
            max_access_count
        } = req.body || {};

        if (!documentId || !tenant_id || !shared_by || !share_type) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document_id, tenant_id, shared_by, and share_type are required"
            });
        }

        if (!shared_with_user_id && !shared_with_email) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "Either shared_with_user_id or shared_with_email must be provided"
            });
        }

        // Verify document exists
        const docCheck = await pool.query(
            "SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
            [documentId, tenant_id]
        );

        if (docCheck.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found"
            });
        }

        const insertQuery = `
            INSERT INTO document_shares (
                tenant_id,
                document_id,
                shared_by,
                shared_with_user_id,
                shared_with_email,
                share_type,
                password_protected,
                password_hash,
                expires_at,
                max_access_count,
                current_access_count,
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, TRUE)
            RETURNING
                id, tenant_id, document_id, shared_by, shared_with_user_id,
                shared_with_email, share_type, password_protected, expires_at,
                max_access_count, current_access_count, is_active,
                created_at, last_accessed_at
        `;

        const values = [
            tenant_id,
            documentId,
            shared_by,
            shared_with_user_id || null,
            shared_with_email || null,
            share_type,
            password_protected || false,
            password_hash || null,
            expires_at || null,
            max_access_count || null
        ];

        const result = await pool.query(insertQuery, values);

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "share",
            resource: "documents",
            eventCategory: "data",
            targetId: documentId,
            targetName: `Shared with ${shared_with_email || shared_with_user_id}`,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformShare(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error sharing document:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to share document"
        });
    }
});

/**
 * DELETE /agent/internal/documents/shares/:shareId
 * Revoke a document share
 *
 * Body: {
 *   tenant_id: UUID,
 *   revoked_by: UUID,
 *   revocation_reason?: string
 * }
 */
documentSharesRouter.delete("/:shareId", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const shareId = String(req.params.shareId || "").trim();
        const {
            tenant_id,
            revoked_by,
            revocation_reason
        } = req.body || {};

        if (!shareId || !tenant_id) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "share_id and tenant_id are required"
            });
        }

        const updateQuery = `
            UPDATE document_shares
            SET
                is_active = FALSE,
                revoked_at = NOW(),
                revoked_by = $1,
                revocation_reason = $2
            WHERE id = $3 AND tenant_id = $4 AND is_active = TRUE
            RETURNING id, document_id, shared_with_user_id, shared_with_email
        `;

        const result = await pool.query(updateQuery, [
            revoked_by || null,
            revocation_reason || null,
            shareId,
            tenant_id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Share not found or already revoked"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "delete",
            resource: "documents",
            eventCategory: "data",
            targetId: shareId,
            targetName: "Document share revoked",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            message: "Share revoked successfully"
        });
    } catch (err: any) {
        console.error("[Agent] Error revoking share:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to revoke share"
        });
    }
});

/**
 * PUT /agent/internal/documents/shares/:shareId/access
 * Record a share access (increment counter)
 */
documentSharesRouter.put("/:shareId/access", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const shareId = String(req.params.shareId || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!shareId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "share_id and X-Tenant-Id are required"
            });
        }

        const updateQuery = `
            UPDATE document_shares
            SET
                current_access_count = current_access_count + 1,
                last_accessed_at = NOW()
            WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
            RETURNING
                id, current_access_count, max_access_count,
                last_accessed_at, expires_at
        `;

        const result = await pool.query(updateQuery, [shareId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Share not found or inactive"
            });
        }

        const share = result.rows[0];

        // Check if max access count reached
        if (share.max_access_count && share.current_access_count >= share.max_access_count) {
            await pool.query(
                "UPDATE document_shares SET is_active = FALSE WHERE id = $1",
                [shareId]
            );
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "view",
            resource: "documents",
            eventCategory: "data",
            targetId: shareId,
            targetName: "Share accessed",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformShare(share)
        });
    } catch (err: any) {
        console.error("[Agent] Error recording share access:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to record share access"
        });
    }
});
