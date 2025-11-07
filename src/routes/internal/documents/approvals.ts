/**
 * Agent Internal API - Document Approvals
 *
 * Routes for managing document approval workflows
 * Base path: /agent/internal/documents/:documentId/approvals
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformApproval, transformArray } from "../../../helpers/transform";

export const documentApprovalsRouter = Router({ mergeParams: true });

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
 * GET /agent/internal/documents/:documentId/approvals
 * Get all approval workflow items for a document
 */
documentApprovalsRouter.get("/", requireInternalAuth, async (req, res) => {
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
                approval_level,
                approval_type,
                approver_id,
                approver_role,
                status,
                decision_date,
                comments,
                rejection_reason,
                delegated_to,
                delegated_at,
                delegation_reason,
                escalated_to,
                escalated_at,
                escalation_reason,
                requested_at,
                due_date,
                reminder_sent_at,
                created_at,
                updated_at
            FROM document_approvals
            WHERE document_id = $1 AND tenant_id = $2
            ORDER BY approval_level ASC, created_at ASC
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
            data: transformArray(result.rows, transformApproval)
        });
    } catch (err) {
        console.error("[Agent] Error getting document approvals:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get document approvals"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/approvals
 * Create approval workflow for a document
 *
 * Body: {
 *   tenant_id: UUID,
 *   approvers: Array<{
 *     approver_id: UUID,
 *     approval_level: number,
 *     approver_role?: string,
 *     due_date?: string
 *   }>,
 *   approval_type: 'sequential' | 'parallel'
 * }
 */
documentApprovalsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const {
            tenant_id,
            approvers,
            approval_type
        } = req.body || {};

        if (!documentId || !tenant_id || !approvers || !Array.isArray(approvers) || approvers.length === 0) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document_id, tenant_id, and approvers array are required"
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

        // Insert approval workflow items
        const insertQuery = `
            INSERT INTO document_approvals (
                tenant_id,
                document_id,
                approval_level,
                approval_type,
                approver_id,
                approver_role,
                status,
                due_date,
                requested_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING
                id, tenant_id, document_id, approval_level, approval_type,
                approver_id, approver_role, status, due_date, requested_at,
                created_at, updated_at
        `;

        const createdApprovals = [];

        for (const approver of approvers) {
            const values = [
                tenant_id,
                documentId,
                approver.approval_level || 1,
                approval_type || 'sequential',
                approver.approver_id,
                approver.approver_role || null,
                'pending',
                approver.due_date || null
            ];

            const result = await pool.query(insertQuery, values);
            createdApprovals.push(result.rows[0]);
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "create",
            resource: "documents",
            eventCategory: "data",
            targetId: documentId,
            targetName: `Approval workflow with ${approvers.length} approvers`,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformArray(createdApprovals, transformApproval)
        });
    } catch (err: any) {
        console.error("[Agent] Error creating approval workflow:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create approval workflow"
        });
    }
});

/**
 * PUT /agent/internal/documents/approvals/:approvalId/decide
 * Make an approval decision (approve or reject)
 *
 * Body: {
 *   tenant_id: UUID,
 *   decision: 'approve' | 'reject',
 *   comments?: string,
 *   rejection_reason?: string
 * }
 */
documentApprovalsRouter.put("/:approvalId/decide", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const approvalId = String(req.params.approvalId || "").trim();
        const {
            tenant_id,
            decision,
            comments,
            rejection_reason
        } = req.body || {};

        if (!approvalId || !tenant_id || !decision) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "approval_id, tenant_id, and decision are required"
            });
        }

        if (decision !== 'approve' && decision !== 'reject') {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "decision must be 'approve' or 'reject'"
            });
        }

        // Get current approval
        const approvalCheck = await pool.query(
            "SELECT id, status, document_id FROM document_approvals WHERE id = $1 AND tenant_id = $2",
            [approvalId, tenant_id]
        );

        if (approvalCheck.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Approval not found"
            });
        }

        const approval = approvalCheck.rows[0];

        if (approval.status !== 'pending') {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: `Approval already ${approval.status}`
            });
        }

        const newStatus = decision === 'approve' ? 'approved' : 'rejected';

        const updateQuery = `
            UPDATE document_approvals
            SET
                status = $1,
                decision_date = NOW(),
                comments = $2,
                rejection_reason = $3,
                updated_at = NOW()
            WHERE id = $4 AND tenant_id = $5
            RETURNING
                id, tenant_id, document_id, approval_level, approval_type,
                approver_id, approver_role, status, decision_date,
                comments, rejection_reason, created_at, updated_at
        `;

        const result = await pool.query(updateQuery, [
            newStatus,
            comments || null,
            decision === 'reject' ? rejection_reason : null,
            approvalId,
            tenant_id
        ]);

        // If approved, check if all approvals are done and update document status
        if (decision === 'approve') {
            const pendingCheck = await pool.query(
                `SELECT COUNT(*) as pending_count
                 FROM document_approvals
                 WHERE document_id = $1 AND status = 'pending'`,
                [approval.document_id]
            );

            if (parseInt(pendingCheck.rows[0].pending_count) === 0) {
                // All approvals done, mark document as approved
                await pool.query(
                    "UPDATE documents SET status = 'approved', updated_at = NOW() WHERE id = $1",
                    [approval.document_id]
                );
            }
        }

        // If rejected, mark document as rejected
        if (decision === 'reject') {
            await pool.query(
                "UPDATE documents SET status = 'rejected', updated_at = NOW() WHERE id = $1",
                [approval.document_id]
            );
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            targetId: approvalId,
            targetName: `Approval ${newStatus}`,
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformApproval(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error processing approval decision:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to process approval decision"
        });
    }
});

/**
 * PUT /agent/internal/documents/approvals/:approvalId/delegate
 * Delegate an approval to another user
 *
 * Body: {
 *   tenant_id: UUID,
 *   delegated_to: UUID,
 *   delegation_reason?: string
 * }
 */
documentApprovalsRouter.put("/:approvalId/delegate", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const approvalId = String(req.params.approvalId || "").trim();
        const {
            tenant_id,
            delegated_to,
            delegation_reason
        } = req.body || {};

        if (!approvalId || !tenant_id || !delegated_to) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "approval_id, tenant_id, and delegated_to are required"
            });
        }

        const updateQuery = `
            UPDATE document_approvals
            SET
                delegated_to = $1,
                delegated_at = NOW(),
                delegation_reason = $2,
                updated_at = NOW()
            WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
            RETURNING
                id, tenant_id, document_id, approver_id, delegated_to,
                delegated_at, delegation_reason, status, created_at, updated_at
        `;

        const result = await pool.query(updateQuery, [
            delegated_to,
            delegation_reason || null,
            approvalId,
            tenant_id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Approval not found or already processed"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            targetId: approvalId,
            targetName: "Approval delegated",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformApproval(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error delegating approval:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delegate approval"
        });
    }
});

/**
 * PUT /agent/internal/documents/approvals/:approvalId/escalate
 * Escalate an approval to a higher authority
 *
 * Body: {
 *   tenant_id: UUID,
 *   escalated_to: UUID,
 *   escalation_reason?: string
 * }
 */
documentApprovalsRouter.put("/:approvalId/escalate", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const approvalId = String(req.params.approvalId || "").trim();
        const {
            tenant_id,
            escalated_to,
            escalation_reason
        } = req.body || {};

        if (!approvalId || !tenant_id || !escalated_to) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "approval_id, tenant_id, and escalated_to are required"
            });
        }

        const updateQuery = `
            UPDATE document_approvals
            SET
                status = 'escalated',
                escalated_to = $1,
                escalated_at = NOW(),
                escalation_reason = $2,
                updated_at = NOW()
            WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
            RETURNING
                id, tenant_id, document_id, approver_id, escalated_to,
                escalated_at, escalation_reason, status, created_at, updated_at
        `;

        const result = await pool.query(updateQuery, [
            escalated_to,
            escalation_reason || null,
            approvalId,
            tenant_id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Approval not found or already processed"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            targetId: approvalId,
            targetName: "Approval escalated",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: transformApproval(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error escalating approval:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to escalate approval"
        });
    }
});
