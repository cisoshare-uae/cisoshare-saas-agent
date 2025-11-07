-- Migration: 019_enhanced_document_templates_compliance.sql
-- Description: Enhanced document management with MCP ADHICS integration, section-level versioning, and role-based workflows
-- Date: 2025-11-05
-- ADHICS Compliance: AC (Access Control), DP (Data Privacy), IM (Information Management), SA (Security Audit)
-- Prerequisites: Migration 012_document_management_system.sql, 018_align_document_schema_with_platform.sql
-- Related Plan: PLAN05-STEP1-DATABASE-SCHEMA

-- =====================================================
-- 1. ALTER EXISTING documents TABLE
-- =====================================================
-- Add structured content storage, MCP tracking, and template linkage

ALTER TABLE documents
  -- Structured content storage (default for all documents)
  ADD COLUMN IF NOT EXISTS structured_content JSONB,
  ADD COLUMN IF NOT EXISTS content_format VARCHAR(20) DEFAULT 'structured'
    CHECK (content_format IN ('structured', 'binary', 'hybrid')),
  ADD COLUMN IF NOT EXISTS editor_state JSONB, -- Tiptap ProseMirror editor state

  -- Template linkage
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES document_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version VARCHAR(50),

  -- MCP ADHICS tracking
  ADD COLUMN IF NOT EXISTS mcp_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS mcp_compliance_score NUMERIC(5,2), -- 0-100
  ADD COLUMN IF NOT EXISTS last_mcp_check TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mcp_requirements_checked TEXT[], -- Array of ADHICS requirement IDs

  -- Content integrity
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(128), -- SHA-256 of structured_content
  ADD COLUMN IF NOT EXISTS parsing_status VARCHAR(32)
    CHECK (parsing_status IN ('pending', 'processing', 'completed', 'failed', 'not_required')),
  ADD COLUMN IF NOT EXISTS parsing_error TEXT;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_documents_template_id
  ON documents(template_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_content_format
  ON documents(content_format) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_mcp_compliance
  ON documents(mcp_compliance_score DESC) WHERE deleted_at IS NULL AND mcp_compliance_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_structured_content
  ON documents USING GIN(structured_content) WHERE structured_content IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_parsing_status
  ON documents(parsing_status) WHERE deleted_at IS NULL AND parsing_status IS NOT NULL;

-- Column comments
COMMENT ON COLUMN documents.structured_content IS 'JSONB structured document content (default storage format for AI-powered documents)';
COMMENT ON COLUMN documents.content_format IS 'Storage strategy: structured (JSONB), binary (file), hybrid (both)';
COMMENT ON COLUMN documents.editor_state IS 'Tiptap ProseMirror editor state for rich document editing';
COMMENT ON COLUMN documents.mcp_compliance_score IS 'Compliance score from MCP ADHICS validation (0-100)';
COMMENT ON COLUMN documents.mcp_version IS 'MCP ADHICS version used for validation';
COMMENT ON COLUMN documents.mcp_requirements_checked IS 'Array of ADHICS requirement IDs validated by MCP';
COMMENT ON COLUMN documents.content_hash IS 'SHA-256 hash of structured_content for integrity verification';
COMMENT ON COLUMN documents.parsing_status IS 'Status of PDF/DOCX to structured content conversion';

-- =====================================================
-- 2. ALTER EXISTING document_templates TABLE
-- =====================================================
-- Enhance for ADHICS compliance and MCP integration

ALTER TABLE document_templates
  -- ADHICS domain tracking
  ADD COLUMN IF NOT EXISTS adhics_domains VARCHAR(10)[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS adhics_requirements TEXT[] DEFAULT '{}', -- MCP requirement IDs
  ADD COLUMN IF NOT EXISTS adhics_compliance_level VARCHAR(20)
    CHECK (adhics_compliance_level IN ('basic', 'transitional', 'advanced', 'service-provider')),

  -- MCP integration
  ADD COLUMN IF NOT EXISTS mcp_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mcp_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS mcp_last_sync TIMESTAMPTZ,

  -- Structured template content
  ADD COLUMN IF NOT EXISTS structured_sections JSONB, -- Template sections structure with ADHICS mapping
  ADD COLUMN IF NOT EXISTS content_schema JSONB, -- JSON schema for validation

  -- Multi-language support
  ADD COLUMN IF NOT EXISTS title_ar VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description_ar TEXT,
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'both'
    CHECK (language IN ('en', 'ar', 'both')),

  -- Template metadata
  ADD COLUMN IF NOT EXISTS complexity VARCHAR(20)
    CHECK (complexity IN ('basic', 'intermediate', 'advanced')),
  ADD COLUMN IF NOT EXISTS estimated_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS required_approvals TEXT[], -- Role names
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) CHECK (rating >= 0 AND rating <= 5),
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_document_templates_adhics_domains
  ON document_templates USING GIN(adhics_domains);
CREATE INDEX IF NOT EXISTS idx_document_templates_mcp_generated
  ON document_templates(mcp_generated) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_templates_tags
  ON document_templates USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_document_templates_complexity
  ON document_templates(complexity) WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_document_templates_rating
  ON document_templates(rating DESC) WHERE deleted_at IS NULL AND is_active = TRUE;

-- Column comments
COMMENT ON COLUMN document_templates.adhics_domains IS 'ADHICS domains covered by this template (HR, AC, DP, IM, etc.)';
COMMENT ON COLUMN document_templates.adhics_requirements IS 'ADHICS requirement IDs this template addresses';
COMMENT ON COLUMN document_templates.mcp_generated IS 'Template generated from MCP ADHICS knowledge base';
COMMENT ON COLUMN document_templates.structured_sections IS 'Template sections with ADHICS requirement mapping';
COMMENT ON COLUMN document_templates.content_schema IS 'JSON schema for validating documents created from this template';
COMMENT ON COLUMN document_templates.title_ar IS 'Arabic template title for bilingual support';
COMMENT ON COLUMN document_templates.description_ar IS 'Arabic template description';
COMMENT ON COLUMN document_templates.complexity IS 'Template complexity level for user guidance';
COMMENT ON COLUMN document_templates.estimated_time_minutes IS 'Estimated time to complete document from this template';
COMMENT ON COLUMN document_templates.required_approvals IS 'Array of roles required to approve documents from this template';

-- =====================================================
-- 3. NEW TABLE: document_sections
-- =====================================================
-- Section-level versioning for ADHICS audit compliance

CREATE TABLE IF NOT EXISTS document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Section identity (stable across versions)
  section_id VARCHAR(100) NOT NULL, -- e.g., "section-1-introduction"
  version_number INTEGER NOT NULL DEFAULT 1,

  -- Section content
  title VARCHAR(255) NOT NULL,
  title_ar VARCHAR(255),
  section_type VARCHAR(50) NOT NULL CHECK (section_type IN (
    'heading', 'paragraph', 'list', 'table', 'checklist',
    'signature_field', 'mustache_field', 'attachment'
  )),
  content TEXT NOT NULL,
  content_html TEXT,
  order_index INTEGER NOT NULL,
  level INTEGER DEFAULT 1, -- Heading level for nested sections

  -- Parent-child hierarchy
  parent_section_id VARCHAR(100),

  -- ADHICS compliance tracking (MCP)
  adhics_reference VARCHAR(50), -- e.g., "DP.3.2.1"
  mcp_requirement_id VARCHAR(100),
  is_required BOOLEAN DEFAULT FALSE,
  is_completed BOOLEAN DEFAULT FALSE,

  -- Compliance status (from MCP validation)
  compliance_status VARCHAR(50) CHECK (compliance_status IN (
    'compliant', 'partially_compliant', 'non_compliant', 'not_checked', 'not_applicable'
  )),
  compliance_issues TEXT[],
  compliance_suggestions TEXT[], -- From MCP guidance
  last_mcp_check TIMESTAMPTZ,

  -- Version tracking (for section-level audit trail)
  change_type VARCHAR(50) CHECK (change_type IN (
    'added', 'modified', 'removed', 'reordered', 'renamed'
  )),
  previous_content TEXT, -- Content before this version
  change_summary VARCHAR(500),
  change_reason TEXT,

  -- Audit fields
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite unique constraint: one version per section per document
  CONSTRAINT unique_section_version UNIQUE (document_id, section_id, version_number)
);

-- Indexes for document_sections
CREATE INDEX idx_document_sections_document ON document_sections(document_id, order_index);
CREATE INDEX idx_document_sections_section_id ON document_sections(section_id, version_number DESC);
CREATE INDEX idx_document_sections_adhics ON document_sections(adhics_reference) WHERE adhics_reference IS NOT NULL;
CREATE INDEX idx_document_sections_compliance ON document_sections(compliance_status);
CREATE INDEX idx_document_sections_parent ON document_sections(parent_section_id) WHERE parent_section_id IS NOT NULL;
CREATE INDEX idx_document_sections_tenant ON document_sections(tenant_id);

-- Table comment
COMMENT ON TABLE document_sections IS 'Section-level document storage with versioning for ADHICS audit trails (PLAN05 Phase 1)';
COMMENT ON COLUMN document_sections.section_id IS 'Stable identifier across versions for tracking changes';
COMMENT ON COLUMN document_sections.adhics_reference IS 'Linked ADHICS requirement from MCP knowledge base';
COMMENT ON COLUMN document_sections.compliance_status IS 'MCP validation status for this section';
COMMENT ON COLUMN document_sections.change_type IS 'Type of change in this version (for audit trail)';

-- =====================================================
-- 4. NEW TABLE: document_workflow_roles
-- =====================================================
-- Role-based document workflow with eligibility validation

CREATE TABLE IF NOT EXISTS document_workflow_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Workflow role definition
  role_type VARCHAR(50) NOT NULL CHECK (role_type IN (
    'creator', 'reviewer', 'approver', 'signatory', 'security_officer', 'legal_counsel', 'department_head'
  )),
  user_id UUID NOT NULL, -- References employees.id

  -- Workflow sequencing
  sequence_order INTEGER NOT NULL DEFAULT 1, -- Order in workflow
  is_parallel BOOLEAN DEFAULT FALSE, -- Can execute in parallel with other same-sequence roles

  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'skipped', 'rejected', 'delegated', 'escalated'
  )),

  -- Eligibility validation (especially for security_officer)
  eligibility_validated BOOLEAN DEFAULT FALSE,
  eligibility_criteria JSONB, -- Validation rules met
  eligibility_validated_at TIMESTAMPTZ,
  eligibility_errors TEXT[],

  -- Action tracking
  action_date TIMESTAMPTZ,
  action_comments TEXT,
  rejection_reason TEXT,

  -- Delegation
  delegated_to UUID, -- References employees.id
  delegated_at TIMESTAMPTZ,
  delegation_reason TEXT,

  -- SLA tracking
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,

  -- Signature data (for signatories)
  signature_data JSONB, -- Digital signature details
  signature_timestamp TIMESTAMPTZ,
  signature_ip VARCHAR(45),

  -- Audit
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for document_workflow_roles
CREATE INDEX idx_document_workflow_document ON document_workflow_roles(document_id, sequence_order);
CREATE INDEX idx_document_workflow_user ON document_workflow_roles(user_id, status);
CREATE INDEX idx_document_workflow_role_type ON document_workflow_roles(role_type, status);
CREATE INDEX idx_document_workflow_due_date ON document_workflow_roles(due_date) WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_document_workflow_tenant ON document_workflow_roles(tenant_id);

-- Table comment
COMMENT ON TABLE document_workflow_roles IS 'Role-based document workflows with eligibility validation (PLAN05 Phase 1)';
COMMENT ON COLUMN document_workflow_roles.eligibility_criteria IS 'Validation results for role eligibility (e.g., security officer ADHICS training)';
COMMENT ON COLUMN document_workflow_roles.sequence_order IS 'Workflow execution order (1 = first, 2 = second, etc.)';
COMMENT ON COLUMN document_workflow_roles.is_parallel IS 'If TRUE, this role can execute in parallel with others at same sequence_order';

-- =====================================================
-- 5. NEW TABLE: template_fields
-- =====================================================
-- Mustache template variable definitions for auto-population

CREATE TABLE IF NOT EXISTS template_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Field definition
  field_name VARCHAR(100) NOT NULL, -- e.g., "employee_name" (becomes {{employee_name}})
  field_label VARCHAR(255) NOT NULL, -- Display name
  field_label_ar VARCHAR(255),
  field_type VARCHAR(50) NOT NULL CHECK (field_type IN (
    'text', 'number', 'date', 'email', 'phone', 'url',
    'select', 'multi_select', 'boolean', 'currency', 'address'
  )),

  -- Data source (auto-population)
  data_source VARCHAR(100), -- e.g., "employee", "tenant", "manual"
  data_source_entity VARCHAR(50), -- Entity table name (e.g., "employees")
  data_source_field VARCHAR(100), -- Field name in source entity (e.g., "full_name")
  data_source_query TEXT, -- SQL query for complex lookups (optional)

  -- Validation rules
  is_required BOOLEAN DEFAULT FALSE,
  validation_rules JSONB, -- JSON schema validation rules
  default_value TEXT,
  placeholder TEXT,
  help_text TEXT,

  -- Options for select fields
  options JSONB, -- Array of {value, label, labelAr}

  -- Display settings
  order_index INTEGER NOT NULL,
  group_name VARCHAR(100), -- Group related fields
  is_conditional BOOLEAN DEFAULT FALSE,
  conditional_logic JSONB, -- Show/hide based on other fields

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_template_field UNIQUE (template_id, field_name)
);

-- Indexes for template_fields
CREATE INDEX idx_template_fields_template ON template_fields(template_id, order_index);
CREATE INDEX idx_template_fields_data_source ON template_fields(data_source) WHERE data_source IS NOT NULL;
CREATE INDEX idx_template_fields_tenant ON template_fields(tenant_id);

-- Table comment
COMMENT ON TABLE template_fields IS 'Mustache template variable definitions with auto-population sources (PLAN05 Phase 1)';
COMMENT ON COLUMN template_fields.field_name IS 'Variable name used in template as {{field_name}}';
COMMENT ON COLUMN template_fields.data_source_field IS 'Auto-populate from entity field (e.g., employee.full_name)';
COMMENT ON COLUMN template_fields.validation_rules IS 'JSON schema for field value validation';
COMMENT ON COLUMN template_fields.conditional_logic IS 'JSON rules for conditional field visibility';

-- =====================================================
-- 6. NEW TABLE: document_compliance_checks
-- =====================================================
-- MCP ADHICS compliance check history

CREATE TABLE IF NOT EXISTS document_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Check metadata
  check_type VARCHAR(50) NOT NULL CHECK (check_type IN (
    'full_document', 'section', 'template_validation', 'upload_analysis', 'real_time'
  )),
  overall_compliance NUMERIC(5,2) NOT NULL, -- 0-100
  adhics_domain VARCHAR(10),
  document_type VARCHAR(50),

  -- Analysis results
  section_checks JSONB NOT NULL, -- Array of section compliance results
  missing_sections TEXT[],
  incomplete_sections TEXT[],
  non_compliant_content JSONB,
  recommendations JSONB NOT NULL, -- MCP-powered suggestions

  -- MCP tracking
  mcp_version VARCHAR(50) NOT NULL,
  mcp_requirements_checked TEXT[], -- Which MCP requirements were validated
  mcp_checklist_id VARCHAR(100),
  mcp_call_duration_ms INTEGER,

  -- AI processing (OpenAI GPT-4)
  ai_model VARCHAR(50) NOT NULL, -- e.g., "gpt-4-turbo-preview"
  ai_prompt_tokens INTEGER,
  ai_completion_tokens INTEGER,
  ai_processing_time_ms INTEGER,

  -- Extracted metadata
  extracted_metadata JSONB,

  -- Audit
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_by UUID
);

-- Indexes for document_compliance_checks
CREATE INDEX idx_document_compliance_checks_document ON document_compliance_checks(document_id, checked_at DESC);
CREATE INDEX idx_document_compliance_checks_score ON document_compliance_checks(overall_compliance);
CREATE INDEX idx_document_compliance_checks_domain ON document_compliance_checks(adhics_domain);
CREATE INDEX idx_document_compliance_checks_tenant ON document_compliance_checks(tenant_id);
CREATE INDEX idx_document_compliance_checks_recent ON document_compliance_checks(checked_at DESC);

-- Table comment
COMMENT ON TABLE document_compliance_checks IS 'MCP ADHICS compliance validation history with AI-powered analysis (PLAN05 Phase 1)';
COMMENT ON COLUMN document_compliance_checks.mcp_requirements_checked IS 'ADHICS requirements validated by MCP knowledge base';
COMMENT ON COLUMN document_compliance_checks.ai_model IS 'OpenAI model used for compliance analysis (e.g., gpt-4-turbo-preview)';
COMMENT ON COLUMN document_compliance_checks.recommendations IS 'AI-powered recommendations from MCP ADHICS guidance';

-- =====================================================
-- 7. NEW TABLE: template_usage
-- =====================================================
-- Template usage analytics

CREATE TABLE IF NOT EXISTS template_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Usage context
  used_by UUID NOT NULL,
  usage_context VARCHAR(50), -- e.g., "document_creation", "bulk_generation"

  -- Field completion metrics
  fields_total INTEGER,
  fields_completed INTEGER,
  fields_auto_populated INTEGER,
  completion_time_seconds INTEGER,

  -- User feedback
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  user_feedback TEXT,

  -- Audit
  used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for template_usage
CREATE INDEX idx_template_usage_template ON template_usage(template_id, used_at DESC);
CREATE INDEX idx_template_usage_user ON template_usage(used_by, used_at DESC);
CREATE INDEX idx_template_usage_tenant ON template_usage(tenant_id);
CREATE INDEX idx_template_usage_rating ON template_usage(user_rating) WHERE user_rating IS NOT NULL;

-- Table comment
COMMENT ON TABLE template_usage IS 'Template usage analytics for improvement and recommendations (PLAN05 Phase 1)';

-- =====================================================
-- 8. NEW TABLE: document_parsing_log
-- =====================================================
-- Document parsing audit log (PDF/DOCX to structured)

CREATE TABLE IF NOT EXISTS document_parsing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Parsing details
  source_file_type VARCHAR(32) NOT NULL,
  source_file_size BIGINT NOT NULL,
  parsing_method VARCHAR(50) NOT NULL CHECK (parsing_method IN (
    'pdf_text_extraction', 'pdf_ocr', 'docx_mammoth', 'docx_raw', 'ai_enhanced'
  )),

  -- Results
  status VARCHAR(32) NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  sections_extracted INTEGER,
  tables_extracted INTEGER,
  images_extracted INTEGER,
  confidence_score NUMERIC(3,2), -- 0-1

  -- AI processing (if used)
  ai_model VARCHAR(50),
  ai_processing_time_ms INTEGER,

  -- Errors/warnings
  errors TEXT[],
  warnings TEXT[],

  -- Output
  structured_content JSONB, -- Extracted structured content
  extraction_metadata JSONB,

  -- Performance
  parsing_duration_ms INTEGER,

  -- Audit
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  parsed_by UUID NOT NULL
);

-- Indexes for document_parsing_log
CREATE INDEX idx_document_parsing_log_document ON document_parsing_log(document_id, parsed_at DESC);
CREATE INDEX idx_document_parsing_log_status ON document_parsing_log(status);
CREATE INDEX idx_document_parsing_log_tenant ON document_parsing_log(tenant_id);
CREATE INDEX idx_document_parsing_log_recent ON document_parsing_log(parsed_at DESC);

-- Table comment
COMMENT ON TABLE document_parsing_log IS 'Audit log for PDF/DOCX to structured content conversion (PLAN05 Phase 1)';

-- =====================================================
-- 9. FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function: Validate Security Officer Eligibility (ADHICS Compliance)
CREATE OR REPLACE FUNCTION validate_security_officer_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  v_employee RECORD;
  v_training_complete BOOLEAN;
  v_eligible BOOLEAN := TRUE;
  v_errors TEXT[] := '{}';
BEGIN
  -- Only validate for security_officer role
  IF NEW.role_type = 'security_officer' THEN

    -- Get employee details
    SELECT * INTO v_employee
    FROM employees
    WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id;

    -- Check if employee exists
    IF NOT FOUND THEN
      v_eligible := FALSE;
      v_errors := array_append(v_errors, 'Employee not found');
    ELSE
      -- Check employment status
      IF v_employee.employment_status != 'active' THEN
        v_eligible := FALSE;
        v_errors := array_append(v_errors, 'Employee is not active');
      END IF;

      -- Check training completion (ADHICS security training)
      -- Training type options from 002_hr_employees_schema.sql:
      -- 'security-awareness', 'data-protection', 'incident-response', 'compliance', 'technical'
      SELECT EXISTS(
        SELECT 1 FROM training_records
        WHERE employee_id = NEW.user_id
        AND training_type IN ('security-awareness', 'compliance')
        AND training_status = 'completed'
        AND completion_date IS NOT NULL
        AND adhics_compliant = TRUE
        AND deleted_at IS NULL
      ) INTO v_training_complete;

      IF NOT v_training_complete THEN
        v_eligible := FALSE;
        v_errors := array_append(v_errors, 'Required ADHICS security training not completed');
      END IF;
    END IF;

    -- Update eligibility fields
    NEW.eligibility_validated := TRUE;
    NEW.eligibility_validated_at := NOW();
    NEW.eligibility_errors := v_errors;

    IF NOT v_eligible THEN
      NEW.eligibility_criteria := jsonb_build_object(
        'eligible', FALSE,
        'employee_active', COALESCE(v_employee.employment_status = 'active', FALSE),
        'training_complete', v_training_complete,
        'validated_at', NOW()
      );

      -- Raise error to prevent assignment
      RAISE EXCEPTION 'User % is not eligible for security_officer role: %',
        NEW.user_id, array_to_string(v_errors, '; ');
    ELSE
      NEW.eligibility_criteria := jsonb_build_object(
        'eligible', TRUE,
        'employee_active', TRUE,
        'training_complete', TRUE,
        'validated_at', NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_security_officer_eligibility IS 'Validates security officer eligibility per ADHICS requirements (PLAN05 Phase 1)';

-- Trigger: Validate workflow role eligibility
DROP TRIGGER IF EXISTS validate_workflow_role_eligibility ON document_workflow_roles;
CREATE TRIGGER validate_workflow_role_eligibility
  BEFORE INSERT OR UPDATE ON document_workflow_roles
  FOR EACH ROW
  EXECUTE FUNCTION validate_security_officer_eligibility();

-- Function: Update document MCP compliance score
CREATE OR REPLACE FUNCTION update_document_mcp_score()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE documents
  SET
    mcp_compliance_score = NEW.overall_compliance,
    last_mcp_check = NEW.checked_at,
    mcp_version = NEW.mcp_version,
    mcp_requirements_checked = NEW.mcp_requirements_checked,
    updated_at = NOW()
  WHERE id = NEW.document_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_document_mcp_score IS 'Updates document compliance score from MCP checks (PLAN05 Phase 1)';

-- Trigger: Update document compliance score
DROP TRIGGER IF EXISTS update_document_compliance_score ON document_compliance_checks;
CREATE TRIGGER update_document_compliance_score
  AFTER INSERT ON document_compliance_checks
  FOR EACH ROW
  EXECUTE FUNCTION update_document_mcp_score();

-- Function: Auto-increment section version
CREATE OR REPLACE FUNCTION increment_section_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Get next version number for this section
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO NEW.version_number
  FROM document_sections
  WHERE document_id = NEW.document_id
  AND section_id = NEW.section_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_section_version IS 'Auto-increments section version number (PLAN05 Phase 1)';

-- Trigger: Auto-increment section version
DROP TRIGGER IF EXISTS auto_increment_section_version ON document_sections;
CREATE TRIGGER auto_increment_section_version
  BEFORE INSERT ON document_sections
  FOR EACH ROW
  WHEN (NEW.version_number IS NULL)
  EXECUTE FUNCTION increment_section_version();

-- =====================================================
-- 10. VERIFICATION AND SUMMARY
-- =====================================================

-- Verify all new tables created
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_sections') THEN
    RAISE EXCEPTION 'Migration failed: document_sections table not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_workflow_roles') THEN
    RAISE EXCEPTION 'Migration failed: document_workflow_roles table not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_fields') THEN
    RAISE EXCEPTION 'Migration failed: template_fields table not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_compliance_checks') THEN
    RAISE EXCEPTION 'Migration failed: document_compliance_checks table not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_usage') THEN
    RAISE EXCEPTION 'Migration failed: template_usage table not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_parsing_log') THEN
    RAISE EXCEPTION 'Migration failed: document_parsing_log table not created';
  END IF;
END $$;

-- Verify columns added to existing tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'structured_content'
  ) THEN
    RAISE EXCEPTION 'Migration failed: structured_content column not added to documents';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_templates' AND column_name = 'adhics_domains'
  ) THEN
    RAISE EXCEPTION 'Migration failed: adhics_domains column not added to document_templates';
  END IF;
END $$;

-- Log successful migration
DO $$
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Migration 019: Enhanced Document Templates & Compliance - COMPLETED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '1. ✅ Enhanced documents table (12 new columns)';
  RAISE NOTICE '2. ✅ Enhanced document_templates table (17 new columns)';
  RAISE NOTICE '3. ✅ Created document_sections table (section-level versioning)';
  RAISE NOTICE '4. ✅ Created document_workflow_roles table (role-based workflows)';
  RAISE NOTICE '5. ✅ Created template_fields table (Mustache variables)';
  RAISE NOTICE '6. ✅ Created document_compliance_checks table (MCP validation)';
  RAISE NOTICE '7. ✅ Created template_usage table (analytics)';
  RAISE NOTICE '8. ✅ Created document_parsing_log table (parsing audit)';
  RAISE NOTICE '9. ✅ Created 3 functions (eligibility, compliance, versioning)';
  RAISE NOTICE '10. ✅ Created 3 triggers (role validation, compliance update, version increment)';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'PLAN05 Phase 1: Database Schema Enhancement - READY FOR TESTING';
  RAISE NOTICE 'Next Step: PLAN05 Phase 2 - MCP ADHICS Integration';
  RAISE NOTICE '================================================================';
END $$;
