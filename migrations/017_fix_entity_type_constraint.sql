-- Migration 017: Fix entity_type constraint
-- The constraint seems to be corrupted or has wrong values
-- Drop and recreate it with correct values

BEGIN;

-- Drop all existing entity_type constraints
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_entity_type_check CASCADE;

-- Add the correct entity_type constraint
ALTER TABLE documents
  ADD CONSTRAINT documents_entity_type_check CHECK (entity_type IN (
    'employee', 'vendor', 'policy', 'general', 'contract', 'certificate'
  ));

COMMIT;
