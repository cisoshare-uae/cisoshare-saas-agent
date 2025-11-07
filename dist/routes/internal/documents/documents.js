"use strict";
/**
 * Agent Internal API - Document Management
 *
 * Standardized REST endpoints for ADHICS Document Management Module
 * These routes follow the Agent API contract defined in boyd-saas-core
 *
 * Base path: /agent/internal/documents
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalDocumentsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../../../lib/db");
const internalAuth_1 = require("../../../middleware/internalAuth");
const audit_1 = require("../../../helpers/audit");
exports.internalDocumentsRouter = (0, express_1.Router)();
/**
 * Extract actor context from request headers for ADHICS-compliant audit logging
 */
function getActorContext(req) {
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
exports.internalDocumentsRouter.get("/list", internalAuth_1.requireInternalAuth, async (req, res) => {
    const reqId = req.reqId;
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
            await (0, audit_1.recordAudit)({
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
        const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
        const params = [tenantId];
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
        const countResult = await db_1.pool.query(countQuery, params);
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
        const dataResult = await db_1.pool.query(dataQuery, params);
        await (0, audit_1.recordAudit)({
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
        // Return paginated response
        return res.json({
            ok: true,
            data: {
                documents: dataResult.rows,
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    }
    catch (err) {
        console.error("[Agent] Error listing documents:", err);
        const tenantId = String(req.header("X-Tenant-Id") || "unknown");
        await (0, audit_1.recordAudit)({
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
exports.internalDocumentsRouter.get("/:id", internalAuth_1.requireInternalAuth, async (req, res) => {
    const reqId = req.reqId;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    try {
        const id = String(req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        if (!id || !tenantId) {
            await (0, audit_1.recordAudit)({
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
        const result = await db_1.pool.query(query, [id, tenantId]);
        if (result.rows.length === 0) {
            await (0, audit_1.recordAudit)({
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
        await (0, audit_1.recordAudit)({
            tenantId,
            actorRole,
            action: "get",
            resource: "documents",
            eventCategory: "data",
            targetId: id,
            outcome: "success",
            requestId: reqId
        });
        return res.json({
            ok: true,
            data: result.rows[0]
        });
    }
    catch (err) {
        console.error("[Agent] Error getting document:", err);
        await (0, audit_1.recordAudit)({
            tenantId: req.tenantId || "unknown",
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
exports.internalDocumentsRouter.post("/", internalAuth_1.requireInternalAuth, async (req, res) => {
    const reqId = req.reqId;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    try {
        const { tenant_id, title, description, entity_type, entity_id, category, tags, file_name, file_size, file_type, file_path, file_hash, mime_type, issue_date, expiry_date, renewal_required, renewal_period_days, grace_period_days, contains_pii, contains_phi, sensitivity_level, retention_period_years, custom_metadata, auto_archive_on_expiry, created_by } = req.body || {};
        // Validate required fields
        if (!tenant_id || !title || !entity_type || !category || !file_name || !file_size || !file_type || !file_path || !created_by) {
            await (0, audit_1.recordAudit)({
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
        const result = await db_1.pool.query(insertQuery, values);
        const newDocument = result.rows[0];
        await (0, audit_1.recordAudit)({
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
    }
    catch (err) {
        console.error("[Agent] Error creating document:", err);
        // Handle unique constraint violation
        if (err.code === '23505') {
            await (0, audit_1.recordAudit)({
                tenantId: req.body.tenant_id || "unknown",
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
        await (0, audit_1.recordAudit)({
            tenantId: req.body.tenant_id || "unknown",
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
exports.internalDocumentsRouter.put("/:id", internalAuth_1.requireInternalAuth, async (req, res) => {
    const reqId = req.reqId;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    try {
        const id = String(req.params.id || "").trim();
        const { tenant_id, version, updated_by, ...updateFields } = req.body || {};
        if (!id || !tenant_id || typeof version !== "number" || !updated_by) {
            await (0, audit_1.recordAudit)({
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
        const fields = [];
        const values = [];
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
        const result = await db_1.pool.query(updateQuery, values);
        if (result.rowCount === 0) {
            await (0, audit_1.recordAudit)({
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
        await (0, audit_1.recordAudit)({
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
    }
    catch (err) {
        console.error("[Agent] Error updating document:", err);
        await (0, audit_1.recordAudit)({
            tenantId: req.body.tenant_id || "unknown",
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
exports.internalDocumentsRouter.delete("/:id", internalAuth_1.requireInternalAuth, async (req, res) => {
    const reqId = req.reqId;
    const { actorId, actorEmail, actorRole, actorIp } = getActorContext(req);
    try {
        const id = String(req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        if (!id || !tenantId) {
            await (0, audit_1.recordAudit)({
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
        const result = await db_1.pool.query(deleteQuery, [id, tenantId]);
        if (result.rowCount === 0) {
            await (0, audit_1.recordAudit)({
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
        await (0, audit_1.recordAudit)({
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
    }
    catch (err) {
        console.error("[Agent] Error deleting document:", err);
        await (0, audit_1.recordAudit)({
            tenantId: req.tenantId || "unknown",
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
