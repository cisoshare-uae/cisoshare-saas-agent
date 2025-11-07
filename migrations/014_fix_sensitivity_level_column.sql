-- Migration: 014_fix_sensitivity_level_column.sql
-- Description: Drop sensitivity_level_new (not needed, sensitivity_level already exists from 012)
-- Date: 2025-01-04

BEGIN;

-- Drop sensitivity_level_new if it exists (added by migration 013, but sensitivity_level already exists from 012)
ALTER TABLE documents
  DROP COLUMN IF EXISTS sensitivity_level_new;

-- Ensure sensitivity_level has the correct constraint
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_sensitivity_level_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_sensitivity_level_check CHECK (sensitivity_level IN (
    'public', 'internal', 'confidential', 'restricted', 'highly_restricted'
  ));

COMMIT;
