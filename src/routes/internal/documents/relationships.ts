/**
 * Agent Internal API - Document Relationships
 *
 * Routes for managing relationships between documents
 * Base path: /agent/internal/documents/:documentId/relationships
 */

import { Router } from "express";
import { pool } from "../../../lib/db";
import { requireInternalAuth } from "../../../middleware/internalAuth";
import { recordAudit } from "../../../helpers/audit";
import { transformRelationship, transformArray } from "../../../helpers/transform";

export const documentRelationshipsRouter = Router({ mergeParams: true });

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
 * GET /agent/internal/documents/:documentId/relationships
 * Get all relationships for a document (both as source and target)
 */
documentRelationshipsRouter.get("/", requireInternalAuth, async (req, res) => {
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

        // Get relationships where this document is the source
        const sourceQuery = `
            SELECT
                r.id,
                r.tenant_id,
                r.source_document_id,
                r.target_document_id,
                r.relationship_type,
                r.description,
                r.created_by,
                r.created_at,
                d.title as target_title,
                d.document_number as target_document_number,
                d.status as target_status
            FROM document_relationships r
            LEFT JOIN documents d ON r.target_document_id = d.id
            WHERE r.source_document_id = $1 AND r.tenant_id = $2
            ORDER BY r.created_at DESC
        `;

        // Get relationships where this document is the target
        const targetQuery = `
            SELECT
                r.id,
                r.tenant_id,
                r.source_document_id,
                r.target_document_id,
                r.relationship_type,
                r.description,
                r.created_by,
                r.created_at,
                d.title as source_title,
                d.document_number as source_document_number,
                d.status as source_status
            FROM document_relationships r
            LEFT JOIN documents d ON r.source_document_id = d.id
            WHERE r.target_document_id = $1 AND r.tenant_id = $2
            ORDER BY r.created_at DESC
        `;

        const [sourceResult, targetResult] = await Promise.all([
            pool.query(sourceQuery, [documentId, tenantId]),
            pool.query(targetQuery, [documentId, tenantId])
        ]);

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
            data: {
                outgoing: transformArray(sourceResult.rows, transformRelationship),  // Where this document is the source
                incoming: transformArray(targetResult.rows, transformRelationship)   // Where this document is the target
            }
        });
    } catch (err) {
        console.error("[Agent] Error getting document relationships:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get document relationships"
        });
    }
});

/**
 * POST /agent/internal/documents/:documentId/relationships
 * Create a relationship between documents
 *
 * Body: {
 *   tenant_id: UUID,
 *   target_document_id: UUID,
 *   relationship_type: 'references' | 'supersedes' | 'amends' | 'supplements' | 'related' | 'parent' | 'child' | 'depends_on',
 *   description?: string,
 *   created_by: UUID
 * }
 */
documentRelationshipsRouter.post("/", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const sourceDocumentId = String(req.params.documentId || req.params.id || "").trim();
        const {
            tenant_id,
            target_document_id,
            relationship_type,
            description,
            created_by
        } = req.body || {};

        if (!sourceDocumentId || !tenant_id || !target_document_id || !relationship_type || !created_by) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "source_document_id, tenant_id, target_document_id, relationship_type, and created_by are required"
            });
        }

        // Verify both documents exist
        const docsCheck = await pool.query(
            `SELECT id FROM documents
             WHERE id IN ($1, $2) AND tenant_id = $3 AND deleted_at IS NULL`,
            [sourceDocumentId, target_document_id, tenant_id]
        );

        if (docsCheck.rows.length !== 2) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "One or both documents not found"
            });
        }

        // Check if relationship already exists
        const existingCheck = await pool.query(
            `SELECT id FROM document_relationships
             WHERE source_document_id = $1 AND target_document_id = $2
               AND relationship_type = $3 AND tenant_id = $4`,
            [sourceDocumentId, target_document_id, relationship_type, tenant_id]
        );

        if (existingCheck.rows.length > 0) {
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Relationship already exists"
            });
        }

        const insertQuery = `
            INSERT INTO document_relationships (
                tenant_id,
                source_document_id,
                target_document_id,
                relationship_type,
                description,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
                id, tenant_id, source_document_id, target_document_id,
                relationship_type, description, created_by, created_at
        `;

        const values = [
            tenant_id,
            sourceDocumentId,
            target_document_id,
            relationship_type,
            description || null,
            created_by
        ];

        const result = await pool.query(insertQuery, values);

        await recordAudit({
            tenantId: tenant_id,
            actorRole,
            action: "create",
            resource: "documents",
            eventCategory: "data",
            targetId: sourceDocumentId,
            targetName: `Relationship: ${relationship_type}`,
            outcome: "success",
            requestId: reqId
        });

        return res.status(201).json({
            ok: true,
            data: transformRelationship(result.rows[0])
        });
    } catch (err: any) {
        console.error("[Agent] Error creating document relationship:", err);

        // Handle unique constraint violation
        if (err.code === '23505') {
            return res.status(409).json({
                ok: false,
                error: "conflict",
                message: "Relationship already exists"
            });
        }

        // Handle self-reference check constraint
        if (err.code === '23514' && err.constraint === 'no_self_reference') {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "Cannot create relationship with itself"
            });
        }

        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to create document relationship"
        });
    }
});

/**
 * DELETE /agent/internal/documents/relationships/:relationshipId
 * Delete a document relationship
 */
documentRelationshipsRouter.delete("/:relationshipId", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const relationshipId = String(req.params.relationshipId || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();

        if (!relationshipId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "relationship_id and X-Tenant-Id are required"
            });
        }

        const deleteQuery = `
            DELETE FROM document_relationships
            WHERE id = $1 AND tenant_id = $2
            RETURNING id, source_document_id, target_document_id, relationship_type
        `;

        const result = await pool.query(deleteQuery, [relationshipId, tenantId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "not_found",
                message: "Relationship not found"
            });
        }

        await recordAudit({
            tenantId,
            actorRole,
            action: "delete",
            resource: "documents",
            eventCategory: "data",
            targetId: relationshipId,
            targetName: "Document relationship deleted",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            message: "Relationship deleted successfully"
        });
    } catch (err: any) {
        console.error("[Agent] Error deleting relationship:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to delete relationship"
        });
    }
});

/**
 * GET /agent/internal/documents/:documentId/relationships/graph
 * Get relationship graph for a document (for visualization)
 */
documentRelationshipsRouter.get("/graph", requireInternalAuth, async (req, res) => {
    const reqId = (req as any).reqId as string;
    const { actorRole } = getActorContext(req);

    try {
        const documentId = String(req.params.documentId || req.params.id || "").trim();
        const tenantId = String(req.header("X-Tenant-Id") || "").trim();
        const depth = parseInt(String(req.query.depth || "2"));

        if (!documentId || !tenantId) {
            return res.status(400).json({
                ok: false,
                error: "bad_request",
                message: "document_id and X-Tenant-Id header required"
            });
        }

        // Recursive CTE to get relationship graph
        const graphQuery = `
            WITH RECURSIVE relationship_graph AS (
                -- Base case: direct relationships
                SELECT
                    r.id,
                    r.source_document_id,
                    r.target_document_id,
                    r.relationship_type,
                    d1.title as source_title,
                    d1.document_number as source_number,
                    d2.title as target_title,
                    d2.document_number as target_number,
                    1 as depth
                FROM document_relationships r
                LEFT JOIN documents d1 ON r.source_document_id = d1.id
                LEFT JOIN documents d2 ON r.target_document_id = d2.id
                WHERE (r.source_document_id = $1 OR r.target_document_id = $1)
                  AND r.tenant_id = $2

                UNION

                -- Recursive case: relationships of related documents
                SELECT
                    r.id,
                    r.source_document_id,
                    r.target_document_id,
                    r.relationship_type,
                    d1.title as source_title,
                    d1.document_number as source_number,
                    d2.title as target_title,
                    d2.document_number as target_number,
                    rg.depth + 1
                FROM document_relationships r
                LEFT JOIN documents d1 ON r.source_document_id = d1.id
                LEFT JOIN documents d2 ON r.target_document_id = d2.id
                INNER JOIN relationship_graph rg
                    ON (r.source_document_id = rg.target_document_id OR r.target_document_id = rg.source_document_id)
                WHERE r.tenant_id = $2 AND rg.depth < $3
            )
            SELECT DISTINCT * FROM relationship_graph
            ORDER BY depth, relationship_type
        `;

        const result = await pool.query(graphQuery, [documentId, tenantId, depth]);

        // Build nodes and edges for graph visualization
        const nodesMap = new Map();
        const edges = [];

        result.rows.forEach(row => {
            // Add source node
            if (!nodesMap.has(row.source_document_id)) {
                nodesMap.set(row.source_document_id, {
                    id: row.source_document_id,
                    title: row.source_title,
                    documentNumber: row.source_number
                });
            }

            // Add target node
            if (!nodesMap.has(row.target_document_id)) {
                nodesMap.set(row.target_document_id, {
                    id: row.target_document_id,
                    title: row.target_title,
                    documentNumber: row.target_number
                });
            }

            // Add edge
            edges.push({
                id: row.id,
                source: row.source_document_id,
                target: row.target_document_id,
                type: row.relationship_type,
                depth: row.depth
            });
        });

        await recordAudit({
            tenantId,
            actorRole,
            action: "list",
            resource: "documents",
            eventCategory: "data",
            targetId: documentId,
            targetName: "Relationship graph",
            outcome: "success",
            requestId: reqId
        });

        return res.json({
            ok: true,
            data: {
                nodes: Array.from(nodesMap.values()),
                edges: edges
            }
        });
    } catch (err) {
        console.error("[Agent] Error getting relationship graph:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: "Failed to get relationship graph"
        });
    }
});
