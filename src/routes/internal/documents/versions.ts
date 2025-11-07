/**
 * Agent Internal API - Document Versions
 *
 * Routes for managing document version history and comparison
 * Base path: /agent/internal/documents/:documentId/versions
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";

export const documentVersionsRouter = Router({ mergeParams: true });

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
 * GET /agent/internal/documents/:documentId/versions
 * Get version history for a document
 *
 * Returns all versions of the document ordered by version number descending
 */
documentVersionsRouter.get("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

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
                message: "document_id and X-Tenant-Id header required"
            });
        }

        // Get the parent document or the document itself
        const docQuery = `
            SELECT
                COALESCE(parent_document_id, id) as root_id,
                document_number,
                title
            FROM documents
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        `;

        const docResult = await pool.query(docQuery, [documentId, tenantId]);

        if (docResult.rows.length === 0) {
            await recordAudit({
                tenantId,
                actorRole,
                action: "list",
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
                message: "Document not found"
            });
        }

        const { root_id, document_number, title } = docResult.rows[0];

        // Get all versions (documents with the same root or that are the root)
        const versionsQuery = `
            SELECT
                id,
                version,
                change_summary,
                version_metadata,
                status,
                is_latest_version,
                file_size,
                created_by,
                created_at,
                updated_at
            FROM documents
            WHERE
                (id = $1 OR parent_document_id = $1)
                AND tenant_id = $2
                AND deleted_at IS NULL
            ORDER BY version DESC
        `;

        const versionsResult = await pool.query(versionsQuery, [root_id, tenantId]);

        // Build response matching platform's DocumentVersionHistory type
        const versionHistory = {
            documentId: root_id,
            documentNumber: document_number,
            title: title,
            versions: versionsResult.rows.map((row) => ({
                id: row.id,
                version: row.version,
                versionString: row.version_metadata?.versionString || null,
                changeSummary: row.change_summary || '',
                changeDescription: row.version_metadata?.changeDescription || null,
                changeType: row.version_metadata?.changeType || 'revision',
                status: row.status,
                isLatestVersion: row.is_latest_version,
                createdBy: row.created_by,
                createdByName: null, // Would need to join with employees table
                createdAt: row.created_at,
                fileSize: parseInt(row.file_size) || 0,
                approvalStatus: row.version_metadata?.approvalStatus || null
            })),
            totalVersions: versionsResult.rows.length,
            currentVersion: versionsResult.rows.find(v => v.is_latest_version)?.version || 1
        };

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
            data: versionHistory
        });
    } catch (err) {
        console.error("[Agent] Error getting version history:", err);
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
            message: "Failed to get version history"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/versions
 * Create a new version of a document
 *
 * Body: {
 *   tenant_id: UUID,
 *   file_name: string,
 *   file_size: number,
 *   file_type: string,
 *   file_path: string,
 *   file_hash?: string,
 *   mime_type?: string,
 *   change_summary: string,
 *   change_description?: string,
 *   change_type: 'major' | 'minor' | 'patch' | 'revision' | 'amendment' | 'correction',
 *   version_metadata?: object,
 *   created_by: UUID
 * }
 */
documentVersionsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const parentDocumentId = String(req.params.documentId || req.params.id || "").trim();
        const {
            tenant_id,
            file_name,
            file_size,
            file_type,
            file_path,
            file_hash,
            mime_type,
            change_summary,
            change_description,
            change_type,
            version_metadata,
            created_by
        } = req.body || {};

        if (!parentDocumentId || !tenant_id || !file_name || !file_size || !file_type || !file_path || !change_summary || !created_by) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "Missing required fields: parent_document_id, tenant_id, file_name, file_size, file_type, file_path, change_summary, created_by"
            });
        }

        // Get parent document details
        const parentQuery = `
            SELECT
                document_number,
                title,
                description,
                entity_type,
                entity_id,
                category,
                tags,
                version,
                is_encrypted,
                encryption_key_id,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                renewal_period_days,
                grace_period_days,
                auto_archive_on_expiry,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                legal_hold,
                legal_hold_reason,
                custom_metadata
            FROM documents
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        `;

        const parentResult = await pool.query(parentQuery, [parentDocumentId, tenant_id]);

        if (parentResult.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Parent document not found"
            });
        }

        const parent = parentResult.rows[0];
        const newVersion = parent.version + 1;

        // Build version metadata
        const fullVersionMetadata = {
            ...version_metadata,
            versionNumber: newVersion,
            changeType: change_type || 'revision',
            changeSummary: change_summary,
            changeDescription: change_description || null,
            parentVersionId: parentDocumentId,
            parentVersionNumber: parent.version,
            isLatestVersion: true,
            isDraft: false,
            isPublished: false,
            createdBy: created_by,
            createdAt: new Date().toISOString()
        };

        // Insert new version
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
                is_encrypted,
                encryption_key_id,
                version,
                version_metadata,
                parent_document_id,
                is_latest_version,
                change_summary,
                status,
                issue_date,
                expiry_date,
                renewal_required,
                renewal_period_days,
                grace_period_days,
                auto_archive_on_expiry,
                contains_pii,
                contains_phi,
                sensitivity_level,
                retention_period_years,
                legal_hold,
                legal_hold_reason,
                custom_metadata,
                created_by
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36
            )
            RETURNING
                id, version, version_metadata, is_latest_version,
                created_at, updated_at
        `;

        const values = [
            tenant_id,
            parent.document_number,
            parent.title,
            parent.description,
            parent.entity_type,
            parent.entity_id,
            parent.category,
            parent.tags,
            file_name,
            file_size,
            file_type,
            file_path,
            file_hash,
            mime_type,
            parent.is_encrypted,
            parent.encryption_key_id,
            newVersion,
            JSON.stringify(fullVersionMetadata),
            parentDocumentId,
            true, // is_latest_version (trigger will handle marking others as false)
            change_summary,
            'draft', // New versions start as draft
            parent.issue_date,
            parent.expiry_date,
            parent.renewal_required,
            parent.renewal_period_days,
            parent.grace_period_days,
            parent.auto_archive_on_expiry,
            parent.contains_pii,
            parent.contains_phi,
            parent.sensitivity_level,
            parent.retention_period_years,
            parent.legal_hold,
            parent.legal_hold_reason,
            parent.custom_metadata,
            created_by
        ];

        const result = await pool.query(insertQuery, values);
        const newDoc = result.rows[0];

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "version_create",
            resource: "documents",
            eventCategory: "data",
            targetId: newDoc.id,
            targetName: `Version ${newVersion} of ${parent.title}`,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: newDoc
        });
    } catch (err: any) {
        console.error("[Agent] Error creating document version:", err);
        await recordAudit({
            tenantId: (req.body as any).tenant_id || "unknown",
            actorRole,
            action: "version_create",
            resource: "documents",
            eventCategory: "data",
            outcome: "failure",
            reason: "internal_error",
            requestId: reqId
        });
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create document version"
        });
    }
});

/**
 * GET /agent/internal/documents/versions/compare
 * Compare two document versions
 *
 * Query params:
 * - source: UUID (source version ID)
 * - target: UUID (target version ID)
 * - include_file_diff: boolean (whether to include file diff stats)
 */
documentVersionsRouter.get("/compare", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const sourceId = String(req.query.source || "").trim();
        const targetId = String(req.query.target || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!sourceId || !targetId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "source, target, and X-Tenant-Id are required"
            });
        }

        // Get both versions
        const versionsQuery = `
            SELECT
                id,
                version,
                title,
                description,
                category,
                tags,
                file_name,
                file_size,
                file_type,
                status,
                issue_date,
                expiry_date,
                contains_pii,
                contains_phi,
                sensitivity_level,
                version_metadata,
                change_summary,
                created_at
            FROM documents
            WHERE id IN ($1, $2) AND tenant_id = $3 AND deleted_at IS NULL
        `;

        const result = await pool.query(versionsQuery, [sourceId, targetId, tenantId]);

        if (result.rows.length !== 2) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "One or both versions not found"
            });
        }

        const source = result.rows.find(r => r.id === sourceId);
        const target = result.rows.find(r => r.id === targetId);

        if (!source || !target) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Could not find specified versions"
            });
        }

        // Build differences array
        const differences: any[] = [];

        // Compare common fields
        const fieldsToCompare = [
            { field: 'title', label: 'Title' },
            { field: 'description', label: 'Description' },
            { field: 'category', label: 'Category' },
            { field: 'status', label: 'Status' },
            { field: 'sensitivity_level', label: 'Sensitivity Level' },
            { field: 'issue_date', label: 'Issue Date' },
            { field: 'expiry_date', label: 'Expiry Date' },
        ];

        fieldsToCompare.forEach(({ field, label }) => {
            const oldValue = source[field];
            const newValue = target[field];

            if (oldValue !== newValue) {
                let changeType: 'added' | 'removed' | 'modified' = 'modified';

                if (oldValue === null && newValue !== null) changeType = 'added';
                if (oldValue !== null && newValue === null) changeType = 'removed';

                differences.push({
                    field,
                    fieldLabel: label,
                    oldValue,
                    newValue,
                    changeType
                });
            }
        });

        // Compare file changes
        if (source.file_name !== target.file_name || source.file_size !== target.file_size) {
            differences.push({
                field: 'file',
                fieldLabel: 'File',
                oldValue: `${source.file_name} (${source.file_size} bytes)`,
                newValue: `${target.file_name} (${target.file_size} bytes)`,
                changeType: 'modified'
            });
        }

        const comparison = {
            sourceVersionId: sourceId,
            sourceVersionNumber: source.version,
            targetVersionId: targetId,
            targetVersionNumber: target.version,
            differences,
            totalChanges: differences.length,
            fieldsChanged: differences.map(d => d.field),
            changePercentage: Math.round((differences.length / fieldsToCompare.length) * 100),
            fileChanged: source.file_name !== target.file_name || source.file_size !== target.file_size,
            fileDiff: source.file_size !== target.file_size ? {
                additions: 0,
                deletions: 0,
                modifications: Math.abs(target.file_size - source.file_size)
            } : null
        };

        await recordAudit({
            tenantId,
            actorRole,
            action: "list",
            resource: "documents",
            eventCategory: "data",
            targetId: `${sourceId}-${targetId}`,
            targetName: "Version comparison",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: comparison
        });
    } catch (err) {
        console.error("[Agent] Error comparing versions:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to compare versions"
        });
    }
});
