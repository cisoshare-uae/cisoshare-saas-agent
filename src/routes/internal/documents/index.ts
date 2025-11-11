/**
 * Internal Documents Routes - Export Index
 *
 * Exports the main documents router with all sub-routes mounted
 */

import { Router } from 'express';
import { internalDocumentsRouter as documentsRouter } from './documents';
import { documentCommentsRouter } from './comments';
import { documentVersionsRouter } from './versions';
import { documentApprovalsRouter } from './approvals';
import { documentSharesRouter } from './shares';
import { documentRelationshipsRouter } from './relationships';
import { editorRouter } from './editor';
import { sectionsRouter } from './sections';
import { complianceRouter } from './compliance';
import { parserLogRouter } from './parser-log';

// Create combined router
const router = Router();

// Mount main documents CRUD routes
router.use('/', documentsRouter);

// Mount sub-resource routes
router.use('/:documentId/comments', documentCommentsRouter);
router.use('/:documentId/versions', documentVersionsRouter);
router.use('/:documentId/approvals', documentApprovalsRouter);
router.use('/:documentId/share', documentSharesRouter);
router.use('/shares', documentSharesRouter); // For share-specific operations
router.use('/:documentId/relationships', documentRelationshipsRouter);
router.use('/relationships', documentRelationshipsRouter); // For relationship-specific operations
router.use('/versions/compare', documentVersionsRouter); // For version comparison

// Mount editor, sections, compliance, and parser-log routes
router.use('/:documentId/editor', editorRouter);
router.use('/:documentId/sections', sectionsRouter);
router.use('/:documentId/compliance', complianceRouter);
router.use('/:documentId/parser-log', parserLogRouter);

// Export the combined router
export { router as internalDocumentsRouter };
