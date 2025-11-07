-- Migration: 018_align_document_schema_with_platform.sql
-- Description: Align all document-related database schemas with Platform TypeScript types
-- Date: 2025-11-05
-- Priority: CRITICAL - Fixes blocking errors and schema mismatches

-- =====================================================
-- 1. FIX DOCUMENT_COMMENTS TABLE - Add missing columns
-- =====================================================
-- Critical fix: Table is missing author_name and author_role columns that were defined in migration 012
-- Also need to add author_id for platform compatibility

-- Add missing author_name column
ALTER TABLE document_comments
ADD COLUMN IF NOT EXISTS author_name VARCHAR(255);

-- Add missing author_role column
ALTER TABLE document_comments
ADD COLUMN IF NOT EXISTS author_role VARCHAR(64);

-- Add author_id column (mirrors created_by for platform compatibility)
ALTER TABLE document_comments
ADD COLUMN IF NOT EXISTS author_id UUID;

-- Migrate existing data from created_by to author_id
UPDATE document_comments
SET author_id = created_by
WHERE author_id IS NULL;

-- Make author_id NOT NULL after migration
ALTER TABLE document_comments
ALTER COLUMN author_id SET NOT NULL;

-- Create index for author_id
CREATE INDEX IF NOT EXISTS idx_document_comments_author_id
ON document_comments(author_id);

-- Add missing tenant_id index
CREATE INDEX IF NOT EXISTS idx_document_comments_tenant
ON document_comments(tenant_id) WHERE deleted_at IS NULL;

-- Add missing has_attachments column if it doesn't exist
ALTER TABLE document_comments
ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN DEFAULT FALSE;

-- Add missing attachments column if it doesn't exist
ALTER TABLE document_comments
ADD COLUMN IF NOT EXISTS attachments JSONB;

-- Add comments explaining columns
COMMENT ON COLUMN document_comments.created_by IS 'Audit trail - UUID of employee who created comment (ADHICS compliance - DO NOT REMOVE)';
COMMENT ON COLUMN document_comments.author_id IS 'Application field - mirrors created_by, used by platform TypeScript types';
COMMENT ON COLUMN document_comments.author_name IS 'Display name of comment author';
COMMENT ON COLUMN document_comments.author_role IS 'Role of comment author (owner/admin/member)';

-- =====================================================
-- 2. ADD VERSION_METADATA TO DOCUMENTS TABLE
-- =====================================================
-- Enhancement: Support rich version control metadata

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS version_metadata JSONB;

-- Add index for version metadata queries
CREATE INDEX IF NOT EXISTS idx_documents_version_metadata
ON documents USING GIN(version_metadata)
WHERE version_metadata IS NOT NULL;

COMMENT ON COLUMN documents.version_metadata IS 'Rich version control metadata: {versionString, versionName, changeType, changeSummary, changeDescription, changedFields, parentVersionId, isLatestVersion, isDraft, isPublished, requiresApproval, approvalStatus, approvedBy, approvedAt, diffAvailable, significantChange}';

-- =====================================================
-- 3. ENHANCE DOCUMENT_CATEGORIES TABLE
-- =====================================================
-- Enhancement: Per-category version control strategies

ALTER TABLE document_categories
ADD COLUMN IF NOT EXISTS version_control_strategy VARCHAR(32)
CHECK (version_control_strategy IN (
  'major_minor_patch',  -- Semantic versioning (1.0.0, 1.1.0, 2.0.0)
  'incremental',        -- Simple incremental (1, 2, 3, ...)
  'date_based',         -- Date-based (2025-01-04, 2025-02-15)
  'named'               -- Named versions (v1-initial, v2-revised)
));

ALTER TABLE document_categories
ADD COLUMN IF NOT EXISTS enable_version_comparison BOOLEAN DEFAULT TRUE;

-- Set defaults for existing categories
UPDATE document_categories
SET
  version_control_strategy = 'incremental',
  enable_version_comparison = TRUE
WHERE version_control_strategy IS NULL;

COMMENT ON COLUMN document_categories.version_control_strategy IS 'Default versioning strategy for documents in this category';
COMMENT ON COLUMN document_categories.enable_version_comparison IS 'Whether version comparison UI is enabled for this category';

-- =====================================================
-- 4. ADD MISSING COMMENT_TYPE VALUES
-- =====================================================
-- Fix: Platform has 'change_request' but DB constraint doesn't include it

-- Drop old constraint
ALTER TABLE document_comments
DROP CONSTRAINT IF EXISTS document_comments_comment_type_check;

-- Add new constraint with all comment types from platform
ALTER TABLE document_comments
ADD CONSTRAINT document_comments_comment_type_check
CHECK (comment_type IN (
  'general',
  'review',
  'approval',
  'question',
  'suggestion',
  'issue',
  'change_request'  -- Added to match platform types
));

-- =====================================================
-- 5. VERIFICATION QUERIES
-- =====================================================

-- Verify document_comments has both author_id AND created_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_comments' AND column_name = 'author_id'
  ) THEN
    RAISE EXCEPTION 'Migration failed: author_id column not created in document_comments';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_comments' AND column_name = 'created_by'
  ) THEN
    RAISE EXCEPTION 'Migration failed: created_by column missing in document_comments';
  END IF;
END $$;

-- Verify documents has version_metadata
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'version_metadata'
  ) THEN
    RAISE EXCEPTION 'Migration failed: version_metadata column not created in documents';
  END IF;
END $$;

-- Verify document_categories has version control columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_categories' AND column_name = 'version_control_strategy'
  ) THEN
    RAISE EXCEPTION 'Migration failed: version_control_strategy column not created in document_categories';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_categories' AND column_name = 'enable_version_comparison'
  ) THEN
    RAISE EXCEPTION 'Migration failed: enable_version_comparison column not created in document_categories';
  END IF;
END $$;

-- =====================================================
-- 6. DATA INTEGRITY CHECKS
-- =====================================================

-- Ensure all author_id values are populated from created_by
DO $$
DECLARE
  null_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM document_comments WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO null_count FROM document_comments WHERE author_id IS NULL AND deleted_at IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration data integrity error: % of % document_comments rows have NULL author_id', null_count, total_count;
  END IF;

  RAISE NOTICE 'Data integrity check passed: All % document_comments have author_id populated from created_by', total_count;
END $$;

-- =====================================================
-- MIGRATION SUMMARY
-- =====================================================

-- Log successful migration
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Migration 018: Document Schema Alignment - COMPLETED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '1. ✅ Added author_id column to document_comments (copied from created_by)';
  RAISE NOTICE '2. ✅ KEPT created_by column for ADHICS audit compliance';
  RAISE NOTICE '3. ✅ Added version_metadata JSONB column to documents';
  RAISE NOTICE '4. ✅ Added version_control_strategy to document_categories';
  RAISE NOTICE '5. ✅ Added enable_version_comparison to document_categories';
  RAISE NOTICE '6. ✅ Updated comment_type constraint to include change_request';
  RAISE NOTICE '7. ✅ All data integrity checks passed';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Platform compatibility: FIXED';
  RAISE NOTICE 'Blocking errors: RESOLVED';
  RAISE NOTICE 'Audit trail: PRESERVED';
  RAISE NOTICE '================================================================';
END $$;
