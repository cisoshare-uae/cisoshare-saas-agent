/**
 * Agent Internal API - Document Management
 *
 * Standardized REST endpoints for ADHICS Document Management Module
 * These routes follow the Agent API contract defined in boyd-saas-core
 *
 * Base path: /agent/internal/documents
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformDocument, transformArray } from "../../../helpers/transform";

export const internalDocumentsRouter = Router();

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
 * GET /agent/internal/documents/list
 * List documents for a tenant with pagination, search, and filtering
 */
internalDocumentsRouter.get("/list", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        // Extract tenant ID from header (set by agentFetch)
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        // Extract query parameters
        const page = Math.max(1, parseInt(String(req.query.page || "1")));
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || "20"))));
        const search = String(req.query.search || "").trim();
        const entityType = String(req.query.entity_type || "").trim();
        const entityId = String(req.query.entity_id || "").trim();
        const category = String(req.query.category || "").trim();
        const status = String(req.query.status || "").trim();
        const isLatestVersion = req.query.is_latest_version === "true";
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
                resource: "documents",
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

        // Add search filter (searches title, description, document_number, file_name)
        if (search) {
            conditions.push(`(
                title ILIKE $${paramIndex} OR
                description ILIKE $${paramIndex} OR
                document_number ILIKE $${paramIndex} OR
                file_name ILIKE $${paramIndex}
            )`);
            params.push(`%${search}%`);
            paramIndex++;
        }

        // Add entity type filter
        if (entityType && ['employee', 'vendor', 'policy', 'general', 'contract', 'certificate'].includes(entityType)) {
            conditions.push(`entity_type = $${paramIndex}`);
            params.push(entityType);
            paramIndex++;
        }

        // Add entity ID filter
        if (entityId) {
            conditions.push(`entity_id = $${paramIndex}`);
            params.push(entityId);
            paramIndex++;
        }

        // Add category filter
        if (category) {
            conditions.push(`category = $${paramIndex}`);
            params.push(category);
            paramIndex++;
        }

        // Add status filter
        if (status && ['draft', 'pending_review', 'under_review', 'pending_approval', 'approved', 'published', 'archived', 'expired', 'rejected', 'disposed'].includes(status)) {
            conditions.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        // Add latest version filter
        if (isLatestVersion) {
            conditions.push(`is_latest_version = TRUE`);
        }

        // Validate sort column
        const allowedSortColumns = ['created_at', 'updated_at', 'title', 'expiry_date', 'status'];
        const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
        const sortDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';

        // Calculate offset
        const offset = (page - 1) * pageSize;

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM documents
            WHERE ${conditions.join(" AND ")}
        `;
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data
        const dataQuery = `
            SELECT
                id,
                tenant_id,
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                file_path,
                file_hash,
                mime_type,
                is_encrypted,
                version,
                parent_document_id,
                is_latest_version,
                change_summary,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                custom_metadata,
                created_by,
                created_at,
                updated_by,
                updated_at
            FROM documents
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
            resource: "documents",
            eventCategory: "data",
            outcome: "success",
            requestId: reqId
        });

        // Return paginated response with transformed documents
        return res.json({
            ok: true,
            data: {
                documents: transformArray(dataResult.rows, transformDocument),
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    } catch (err) {
        console.error("[Agent] Error listing documents:", err);
        const tenantId = String(req.header("X-Tenant-Id") || "unknown");
        await recordAudit({
            tenantId,
            actorId,
            actorEmail,
            actorRole,
            actorIp,
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
            message: "Failed to list documents"
        });
    }
});

/**
 * GET /agent/internal/documents/:id
 * Get a single document by ID
 */
internalDocumentsRouter.get("/:id", requireInternalAuth, async (req, res) => {
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
                resource: "documents",
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
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                file_path,
                file_hash,
                mime_type,
                is_encrypted,
                encryption_key_id,
                version,
                parent_document_id,
                is_latest_version,
                change_summary,
                superseded_by,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                renewal_period_days,
                grace_period_days,
                last_renewal_notification_date,
                auto_archive_on_expiry,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                legal_hold,
                legal_hold_reason,
                disposal_date,
                ai_extracted_data,
                ai_extraction_status,
                ai_extraction_confidence,
                custom_metadata,
                created_by,
                created_at,
                updated_by,
                updated_at
            FROM documents
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        `;
        const result = await pool.query(query, [id, tenantId]);

        if (result.rows.length === 0) {
            await recordAudit({
                tenantId,
                actorRole,
                action: "get",
                resource: "documents",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found or tenant mismatch"
            });
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "get",
            resource: "documents",
            eventCategory: "data",
            targetId: id,
            outcome: "success",
            requestId: reqId
        });

        // Transform snake_case to camelCase for platform compatibility
        return res.json({
            ok: true,
            data: transformDocument(result.rows[0])
        });
    } catch (err) {
        console.error("[Agent] Error getting document:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
            actorRole,
            action: "get",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get document"
        });
    }
});

/**
 * POST /agent/internal/documents
 * Create a new document
 */
internalDocumentsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const {
            tenant_id,
            title,
            description,
            entity_type,
            entity_id,
            category,
            tags,
            file_name,
            file_size,
            file_type,
            file_path,
            file_hash,
            mime_type,
            issue_date,
            expiry_date,
            renewal_required,
            renewal_period_days,
            grace_period_days,
            contains_pii,
            contains_phi,
            sensitivity_level,
            retention_period_years,
            custom_metadata,
            auto_archive_on_expiry,
            created_by
        } = req.body || {};

        // Validate required fields
        if (!tenant_id || !title || !entity_type || !category || !file_name || !file_size || !file_type || !file_path || !created_by) {
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "tenant_id, title, entity_type, category, file details, and created_by are required"
            });
        }

        // Validate entity_type against allowed values
        const allowedEntityTypes = ['employee', 'vendor', 'policy', 'general', 'contract', 'certificate'];
        if (!allowedEntityTypes.includes(entity_type)) {
            console.error(`[Agent] Invalid entity_type received: "${entity_type}" (type: ${typeof entity_type})`);
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                outcome: "failure",
                reason: "invalid_entity_type",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: `Invalid entity_type. Must be one of: ${allowedEntityTypes.join(', ')}. Received: "${entity_type}"`
            });
        }

        // Debug log the values being inserted
        console.log(`[Agent] Creating document with entity_type="${entity_type}", category="${category}", tenant_id="${tenant_id}"`);


        // Generate document number (format: DOC-YYYYMMDD-XXXXX)
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomSuffix = Math.floor(10000 + Math.random() * 90000);
        const document_number = `DOC-${dateStr}-${randomSuffix}`;

        const insertQuery = `
            INSERT INTO documents (
                tenant_id,
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                file_path,
                file_hash,
                mime_type,
                issue_date,
                expiry_date,
                renewal_required,
                renewal_period_days,
                grace_period_days,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                custom_metadata,
                auto_archive_on_expiry,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
            RETURNING
                id,
                tenant_id,
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                file_path,
                file_hash,
                mime_type,
                version,
                is_latest_version,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                custom_metadata,
                created_by,
                created_at,
                updated_at
        `;

        const values = [
            tenant_id,
            document_number,
            title,
            description || null,
            entity_type,
            entity_id || null,
            category,
            tags || null,
            file_name,
            file_size,
            file_type,
            file_path,
            file_hash || null,
            mime_type || null,
            issue_date || null,
            expiry_date || null,
            renewal_required || false,
            renewal_period_days || null,
            grace_period_days || 0,
            contains_pii || false,
            contains_phi || false,
            sensitivity_level || 'internal',
            retention_period_years || null,
            custom_metadata || null,
            auto_archive_on_expiry || false,
            created_by
        ];

        const result = await pool.query(insertQuery, values);
        const newDocument = result.rows[0];

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "create",
            resource: "documents",
            eventCategory: "data",
            targetId: newDocument.id,
            targetName: title,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: newDocument
        });
    } catch (err: any) {
        console.error("[Agent] Error creating document:", err);

        // Handle unique constraint violation
        if (err.code === '23505') {
            await recordAudit({
                tenantId: (req.body as any).tenant_id || "unknown",
                actorRole,
                action: "create",
                resource: "documents",
                eventCategory: "data",
                outcome: "failure",
                reason: "duplicate_document_number",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Document number already exists"
            });
        }

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
            message: "Failed to create document"
        });
    }
});

/**
 * PUT /agent/internal/documents/:id
 * Update an existing document (with optimistic locking)
 */
internalDocumentsRouter.put("/:id", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const id = String(req.params.id || "").trim();
        const { tenant_id, version, updated_by, ...updateFields } = req.body || {};

        if (!id || !tenant_id || typeof version !== "number" || !updated_by) {
            await recordAudit({
                tenantId: tenant_id || "unknown",
                actorRole,
                action: "update",
                resource: "documents",
                eventCategory: "data",
                targetId: id || null,
                outcome: "failure",
                reason: "validation_error",
                requestId: reqId
            });
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "id, tenant_id, version, and updated_by are required"
            });
        }

        // Build dynamic SET clause
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Allowed update fields
        const allowedFields = [
            'title', 'description', 'category', 'tags', 'status',
            'issue_date', 'expiry_date', 'renewal_required', 'renewal_period_days', 'grace_period_days',
            'contains_pii', 'contains_phi', 'sensitivity_level', 'retention_period_years',
            'legal_hold', 'legal_hold_reason', 'custom_metadata', 'auto_archive_on_expiry'
        ];

        for (const field of allowedFields) {
            if (updateFields[field] !== undefined) {
                fields.push(`${field} = $${paramIndex}`);
                values.push(updateFields[field]);
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

        // Add version increment, updated_by, and updated_at
        fields.push(`version = version + 1`);
        fields.push(`updated_by = $${paramIndex}`);
        values.push(updated_by);
        paramIndex++;
        fields.push(`updated_at = NOW()`);

        const updateQuery = `
            UPDATE documents
            SET ${fields.join(", ")}
            WHERE id = $${paramIndex}
              AND tenant_id = $${paramIndex + 1}
              AND version = $${paramIndex + 2}
              AND deleted_at IS NULL
            RETURNING
                id,
                tenant_id,
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                version,
                is_latest_version,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                custom_metadata,
                created_by,
                created_at,
                updated_by,
                updated_at
        `;
        values.push(id, tenant_id, version);

        const result = await pool.query(updateQuery, values);

        if (result.rowCount === 0) {
            await recordAudit({
                tenantId: tenant_id,
                actorRole,
                action: "update",
                resource: "documents",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "version_conflict_or_not_found",
                requestId: reqId
            });
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Version conflict or document not found"
            });
        }

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "update",
            resource: "documents",
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
        console.error("[Agent] Error updating document:", err);
        await recordAudit({
            tenantId: (req.body as any).tenant_id || "unknown",
            actorRole,
            action: "update",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to update document"
        });
    }
});

/**
 * DELETE /agent/internal/documents/:id
 * Soft delete a document
 */
internalDocumentsRouter.delete("/:id", requireInternalAuth, async (req, res) => {
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
                resource: "documents",
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
            UPDATE documents
            SET deleted_at = NOW(),
                status = 'disposed'
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            RETURNING id
        `;

        const result = await pool.query(deleteQuery, [id, tenantId]);

        if (result.rowCount === 0) {
            await recordAudit({
                tenantId,
                actorRole,
                action: "delete",
                resource: "documents",
                eventCategory: "data",
                targetId: id,
                outcome: "failure",
                reason: "not_found",
                requestId: reqId
            });
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Document not found or already deleted"
            });
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "delete",
            resource: "documents",
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
        console.error("[Agent] Error deleting document:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
            actorRole,
            action: "delete",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delete document"
        });
    }
});

/**
 * GET /agent/internal/documents/:id/comments
 * Get all comments for a document
 */
internalDocumentsRouter.get("/:id/comments", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const documentId = String(req.params.id || "").trim();
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
                author_name,
                author_role,
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
            data: result.rows
        });
    } catch (err) {
        console.error("[Agent] Error getting document comments:", err);
        await recordAudit({
            tenantId: (req as any).tenantId || "unknown",
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
 * POST /agent/internal/documents/:id/comments
 * Add a comment to a document
 */
internalDocumentsRouter.post("/:id/comments", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);

    try {
        const documentId = String(req.params.id || "").trim();
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
                author_name,
                author_role
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
                author_name,
                author_role,
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
            author_id || null,
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
            data: newComment
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
