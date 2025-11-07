-- Rollback Migration: 019_rollback_enhanced_document_templates_compliance.sql
-- Description: Rollback enhanced document templates and compliance features
-- Date: 2025-11-05
-- Purpose: Rollback migration 019_enhanced_document_templates_compliance.sql if needed

-- WARNING: This will drop all data in the new tables and columns
-- Make sure you have a backup before running this script

-- =====================================================
-- 1. DROP TRIGGERS (in reverse order)
-- =====================================================

DROP TRIGGER IF EXISTS auto_increment_section_version ON document_sections;
DROP TRIGGER IF EXISTS update_document_compliance_score ON document_compliance_checks;
DROP TRIGGER IF EXISTS validate_workflow_role_eligibility ON document_workflow_roles;

-- =====================================================
-- 2. DROP FUNCTIONS
-- =====================================================

DROP FUNCTION IF EXISTS increment_section_version();
DROP FUNCTION IF EXISTS update_document_mcp_score();
DROP FUNCTION IF EXISTS validate_security_officer_eligibility();

-- =====================================================
-- 3. DROP NEW TABLES (in reverse order of dependencies)
-- =====================================================

DROP TABLE IF EXISTS document_parsing_log CASCADE;
DROP TABLE IF EXISTS template_usage CASCADE;
DROP TABLE IF EXISTS document_compliance_checks CASCADE;
DROP TABLE IF EXISTS template_fields CASCADE;
DROP TABLE IF EXISTS document_workflow_roles CASCADE;
DROP TABLE IF EXISTS document_sections CASCADE;

-- =====================================================
-- 4. REMOVE COLUMNS FROM document_templates TABLE
-- =====================================================

ALTER TABLE document_templates
  DROP COLUMN IF EXISTS thumbnail_url,
  DROP COLUMN IF EXISTS rating,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS required_approvals,
  DROP COLUMN IF EXISTS estimated_time_minutes,
  DROP COLUMN IF EXISTS complexity,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS description_ar,
  DROP COLUMN IF EXISTS title_ar,
  DROP COLUMN IF EXISTS content_schema,
  DROP COLUMN IF EXISTS structured_sections,
  DROP COLUMN IF EXISTS mcp_last_sync,
  DROP COLUMN IF EXISTS mcp_version,
  DROP COLUMN IF EXISTS mcp_generated,
  DROP COLUMN IF EXISTS adhics_compliance_level,
  DROP COLUMN IF EXISTS adhics_requirements,
  DROP COLUMN IF EXISTS adhics_domains;

-- =====================================================
-- 5. REMOVE COLUMNS FROM documents TABLE
-- =====================================================

ALTER TABLE documents
  DROP COLUMN IF EXISTS parsing_error,
  DROP COLUMN IF EXISTS parsing_status,
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS mcp_requirements_checked,
  DROP COLUMN IF EXISTS last_mcp_check,
  DROP COLUMN IF EXISTS mcp_compliance_score,
  DROP COLUMN IF EXISTS mcp_version,
  DROP COLUMN IF EXISTS template_version,
  DROP COLUMN IF EXISTS template_id,
  DROP COLUMN IF EXISTS editor_state,
  DROP COLUMN IF EXISTS content_format,
  DROP COLUMN IF EXISTS structured_content;

-- =====================================================
-- 6. VERIFICATION
-- =====================================================

-- Verify tables dropped
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_sections') THEN
    RAISE EXCEPTION 'Rollback failed: document_sections table still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_workflow_roles') THEN
    RAISE EXCEPTION 'Rollback failed: document_workflow_roles table still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_fields') THEN
    RAISE EXCEPTION 'Rollback failed: template_fields table still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_compliance_checks') THEN
    RAISE EXCEPTION 'Rollback failed: document_compliance_checks table still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_usage') THEN
    RAISE EXCEPTION 'Rollback failed: template_usage table still exists';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_parsing_log') THEN
    RAISE EXCEPTION 'Rollback failed: document_parsing_log table still exists';
  END IF;
END $$;

-- Verify columns removed from documents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'structured_content'
  ) THEN
    RAISE EXCEPTION 'Rollback failed: structured_content column still exists in documents';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'mcp_compliance_score'
  ) THEN
    RAISE EXCEPTION 'Rollback failed: mcp_compliance_score column still exists in documents';
  END IF;
END $$;

-- Verify columns removed from document_templates
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_templates' AND column_name = 'adhics_domains'
  ) THEN
    RAISE EXCEPTION 'Rollback failed: adhics_domains column still exists in document_templates';
  END IF;
END $$;

-- Log successful rollback
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Rollback 019: Enhanced Document Templates & Compliance - COMPLETED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '1. ✅ Dropped 6 new tables';
  RAISE NOTICE '2. ✅ Removed columns from documents table';
  RAISE NOTICE '3. ✅ Removed columns from document_templates table';
  RAISE NOTICE '4. ✅ Dropped 3 triggers';
  RAISE NOTICE '5. ✅ Dropped 3 functions';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Database restored to pre-migration 019 state';
  RAISE NOTICE 'WARNING: All data in dropped tables has been permanently deleted';
  RAISE NOTICE '================================================================';
END $$;
