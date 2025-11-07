-- Migration 016: Drop old document columns from simple schema
-- These columns were kept in migration 013 but are no longer needed
-- The new schema uses: title, file_name, file_type, file_path instead

-- Drop old columns that are no longer used
ALTER TABLE documents
  DROP COLUMN IF EXISTS document_name CASCADE,
  DROP COLUMN IF EXISTS document_type CASCADE,
  DROP COLUMN IF EXISTS storage_path CASCADE,
  DROP COLUMN IF EXISTS uploaded_by CASCADE;

-- Note: All data was already migrated in migration 013
-- Migration 013 copied:
-- - document_name -> title and file_name
-- - document_type -> category and file_type
-- - storage_path -> file_path
-- - uploaded_by -> created_by
