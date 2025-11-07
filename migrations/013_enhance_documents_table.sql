-- Migration: 013_enhance_documents_table.sql
-- Description: Enhance existing documents table to support comprehensive document management
-- Date: 2025-01-04
-- ADHICS Compliance: AC (Access Control), DP (Data Privacy), IM (Information Management), SA (Security Audit)

-- This migration enhances the existing simple documents table to support:
-- - Document numbering and categorization
-- - Version control and status management
-- - Compliance tracking (PII/PHI)
-- - Soft deletes
-- - Retention and legal hold

BEGIN;

-- =====================================================
-- 1. ADD NEW COLUMNS TO EXISTING DOCUMENTS TABLE
-- =====================================================

-- Document Identity & Classification
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS document_number VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(64),
  ADD COLUMN IF NOT EXISTS tags TEXT[];

-- File Information (enhance existing)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_hash VARCHAR(128);

-- Version Control
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS parent_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_latest_version BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS change_summary TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES documents(id) ON DELETE SET NULL;

-- Status & Lifecycle
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_review', 'under_review', 'pending_approval',
    'approved', 'published', 'archived', 'expired', 'rejected', 'disposed'
  ));

-- Renewal Management
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS renewal_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS renewal_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_renewal_notification_date DATE,
  ADD COLUMN IF NOT EXISTS auto_archive_on_expiry BOOLEAN DEFAULT FALSE;

-- Compliance & Classification
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS contains_pii BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contains_phi BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sensitivity_level_new VARCHAR(32) DEFAULT 'internal' CHECK (sensitivity_level_new IN (
    'public', 'internal', 'confidential', 'restricted', 'highly_restricted'
  )),
  ADD COLUMN IF NOT EXISTS retention_period_years INTEGER,
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposal_date DATE;

-- AI Extraction
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB,
  ADD COLUMN IF NOT EXISTS ai_extraction_status VARCHAR(32) CHECK (ai_extraction_status IN (
    'pending', 'processing', 'completed', 'failed', 'not_applicable'
  )),
  ADD COLUMN IF NOT EXISTS ai_extraction_confidence DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS ai_extraction_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model_version VARCHAR(32);

-- Metadata
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS custom_metadata JSONB;

-- Audit Fields
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ; -- Soft delete

-- =====================================================
-- 2. MIGRATE EXISTING DATA TO NEW COLUMNS
-- =====================================================

-- Copy data from old columns to new ones
UPDATE documents SET
  title = COALESCE(title, document_name),
  category = COALESCE(category, document_type),
  file_name = COALESCE(file_name, document_name),
  file_path = COALESCE(file_path, storage_path),
  file_type = COALESCE(file_type, document_type),
  created_by = COALESCE(created_by, uploaded_by),
  status = 'published' -- Assume existing docs are published
WHERE title IS NULL OR category IS NULL OR file_name IS NULL;

-- Generate document numbers for existing documents
UPDATE documents
SET document_number = 'DOC-MIGRATED-' || id::text
WHERE document_number IS NULL;

-- =====================================================
-- 3. CREATE INDEXES FOR NEW COLUMNS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_documents_document_number ON documents(document_number) WHERE document_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_latest_version ON documents(is_latest_version) WHERE is_latest_version = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN(tags) WHERE tags IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_ai_extracted_data ON documents USING GIN(ai_extracted_data) WHERE ai_extracted_data IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title) WHERE deleted_at IS NULL;

-- =====================================================
-- 4. ADD CHECK CONSTRAINTS
-- =====================================================

-- Ensure expiry dates are valid
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS valid_expiry_dates;

ALTER TABLE documents
  ADD CONSTRAINT valid_expiry_dates CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date > issue_date);

-- =====================================================
-- 5. CREATE DOCUMENT APPROVALS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS document_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Approval Workflow
  approval_level INTEGER NOT NULL DEFAULT 1,
  approval_type VARCHAR(32) NOT NULL DEFAULT 'sequential' CHECK (approval_type IN ('sequential', 'parallel')),

  -- Approver Information
  approver_id UUID NOT NULL,
  approver_role VARCHAR(64),

  -- Approval Status
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'skipped', 'escalated'
  )),

  -- Decision Details
  decision_date TIMESTAMPTZ,
  comments TEXT,
  rejection_reason TEXT,

  -- Delegation
  delegated_to UUID,
  delegated_at TIMESTAMPTZ,
  delegation_reason TEXT,

  -- Escalation
  escalated_to UUID,
  escalated_at TIMESTAMPTZ,
  escalation_reason TEXT,

  -- SLA Tracking
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_approvals_document ON document_approvals(document_id);
CREATE INDEX IF NOT EXISTS idx_document_approvals_approver ON document_approvals(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_document_approvals_tenant ON document_approvals(tenant_id);

-- =====================================================
-- 6. CREATE DOCUMENT COMMENTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS document_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Comment Details
  comment_text TEXT NOT NULL,
  comment_type VARCHAR(32) DEFAULT 'general' CHECK (comment_type IN (
    'general', 'review', 'question', 'suggestion', 'issue'
  )),

  -- Threading
  parent_comment_id UUID REFERENCES document_comments(id) ON DELETE CASCADE,

  -- Visibility
  is_internal BOOLEAN DEFAULT FALSE,

  -- Resolution
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,

  -- Author
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_comments_document ON document_comments(document_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_comments_parent ON document_comments(parent_comment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_comments_tenant ON document_comments(tenant_id) WHERE deleted_at IS NULL;

-- =====================================================
-- 7. CREATE DOCUMENT SHARES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Share Type
  share_type VARCHAR(32) NOT NULL DEFAULT 'link' CHECK (share_type IN (
    'link', 'email', 'internal_user'
  )),

  -- Recipient
  shared_with_user_id UUID,
  shared_with_email VARCHAR(255),

  -- Access Control
  access_level VARCHAR(32) DEFAULT 'view' CHECK (access_level IN (
    'view', 'download', 'comment', 'edit'
  )),

  -- Expiry & Limits
  expires_at TIMESTAMPTZ,
  max_access_count INTEGER,
  current_access_count INTEGER DEFAULT 0,

  -- Security
  password_protected BOOLEAN DEFAULT FALSE,
  password_hash VARCHAR(255),

  -- Tracking
  last_accessed_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revoke_reason TEXT,

  -- Audit
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_shares_document ON document_shares(document_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_document_shares_user ON document_shares(shared_with_user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_document_shares_tenant ON document_shares(tenant_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_document_shares_expires ON document_shares(expires_at) WHERE is_active = TRUE AND expires_at IS NOT NULL;

COMMIT;

-- =====================================================
-- NOTES
-- =====================================================
-- This migration enhances the existing documents table with:
-- 1. New columns for comprehensive document management
-- 2. Data migration from old columns to new ones
-- 3. New indexes for performance
-- 4. Related tables for approvals, comments, and sharing
--
-- Old columns (document_name, document_type, storage_path, etc.) are kept
-- for backward compatibility but new code should use the new columns.
