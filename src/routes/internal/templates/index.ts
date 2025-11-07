/**
 * Internal Templates Routes - Export Index
 *
 * Exports the main templates router with all sub-routes mounted
 */

import { Router } from 'express';
import { templatesRouter } from './templates';
import { templateFieldsRouter } from './fields';

// Create combined router
const router = Router();

// Mount template CRUD routes at root level
// These must be registered BEFORE the parameterized routes to avoid conflicts
router.use('/', templatesRouter);

// Mount template fields routes under /:templateId/fields
router.use('/:templateId/fields', templateFieldsRouter);

// Export the combined router
export { router as internalTemplatesRouter };
