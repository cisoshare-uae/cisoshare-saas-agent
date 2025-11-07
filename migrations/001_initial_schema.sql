-- ============================================================================
-- CISOSHARE AGENT DATABASE - INITIAL SCHEMA
-- ============================================================================
-- This migration creates the foundational tables for the BOYD agent
-- which connects to customer databases (tenant isolation via tenant_id)
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROLES TABLE (for RBAC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    permissions JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roles_tenant_name_key UNIQUE (tenant_id, name)
);

CREATE INDEX idx_roles_tenant_id ON roles(tenant_id);

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- EMPLOYEES TABLE (HR Module - Complete Schema)
-- ============================================================================

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Basic Information
    employee_number TEXT,
    employee_id VARCHAR(50),
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name VARCHAR(255),
    display_name TEXT,
    phone VARCHAR(50),
    date_of_birth DATE,
    nationality VARCHAR(100),
    national_id VARCHAR(100),

    -- Employment Details
    job_title TEXT,
    position VARCHAR(255),
    department VARCHAR(255),
    employment_type VARCHAR(50) DEFAULT 'full-time' CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'temporary', 'intern')),
    hire_date DATE,
    termination_date DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'on-leave', 'terminated', 'inactive')),
    employment_status VARCHAR(50) DEFAULT 'active',

    -- Reporting Structure
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,

    -- ADHICS Compliance (HR 2.1 - Background Verification)
    background_check_status TEXT DEFAULT 'pending' CHECK (background_check_status IN ('pending', 'in-progress', 'verified', 'failed')),
    background_check_date TIMESTAMPTZ,
    police_clearance_verified BOOLEAN DEFAULT FALSE,
    police_clearance_expiry DATE,
    reference_check_completed BOOLEAN DEFAULT FALSE,
    reference_check_date TIMESTAMPTZ,

    -- ADHICS Compliance (HR 2.2 - Employment Terms)
    contract_signed BOOLEAN DEFAULT FALSE,
    contract_signed_date TIMESTAMPTZ,
    nda_signed BOOLEAN DEFAULT FALSE,
    nda_signed_date TIMESTAMPTZ,
    job_description_acknowledged BOOLEAN DEFAULT FALSE,

    -- ADHICS Compliance (HR 3.1 - Security Training)
    security_training_completed BOOLEAN DEFAULT FALSE,
    security_training_date TIMESTAMPTZ,
    security_training_expiry TIMESTAMPTZ,

    -- Healthcare Specific (UAE)
    dha_license_number TEXT,
    dha_license_expiry DATE,
    haad_license_number TEXT,
    haad_license_expiry DATE,

    -- Access Classification (for ADHICS compliance)
    has_phi_access BOOLEAN DEFAULT FALSE,
    has_pii_access BOOLEAN DEFAULT FALSE,
    access_level TEXT CHECK (access_level IN ('none', 'basic', 'elevated', 'privileged')),

    -- Metadata
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT employees_tenant_email_key UNIQUE (tenant_id, email)
);

-- Indexes for employees
CREATE INDEX idx_employees_tenant_id ON employees(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_status ON employees(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_email ON employees(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_employee_number ON employees(tenant_id, employee_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_hire_date ON employees(hire_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_department ON employees(department) WHERE deleted_at IS NULL;
CREATE INDEX idx_employees_manager ON employees(manager_id) WHERE deleted_at IS NULL;

-- Trigger for updated_at
CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- AGENT_USERS TABLE (Platform Users)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- User Information
    email TEXT NOT NULL,
    display_name TEXT,

    -- Authentication
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),

    -- Link to Employee Record (if applicable)
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,

    -- Session Management
    last_login_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,

    -- Metadata
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT agent_users_tenant_email_key UNIQUE (tenant_id, email)
);

-- Indexes for agent_users
CREATE INDEX idx_agent_users_tenant_id ON agent_users(tenant_id);
CREATE INDEX idx_agent_users_email ON agent_users(email);
CREATE INDEX idx_agent_users_status ON agent_users(status);
CREATE INDEX idx_agent_users_employee_id ON agent_users(employee_id);

-- Trigger for updated_at
CREATE TRIGGER trg_agent_users_updated_at
    BEFORE UPDATE ON agent_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- AUDIT_EVENTS TABLE (Comprehensive Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Event Details
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL CHECK (event_category IN ('auth', 'data', 'system', 'compliance', 'security')),

    -- Actor Information
    actor_id UUID,
    actor_email TEXT,
    actor_role TEXT,
    actor_ip TEXT,

    -- Target Information
    target_type TEXT,
    target_id UUID,
    target_name TEXT,

    -- Event Data
    action TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'partial')),
    changes JSONB,
    metadata JSONB,

    -- Security
    event_hash TEXT,

    -- Timestamp
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit_events
CREATE INDEX idx_audit_events_tenant_id ON audit_events(tenant_id);
CREATE INDEX idx_audit_events_occurred_at ON audit_events(occurred_at);
CREATE INDEX idx_audit_events_actor_id ON audit_events(actor_id);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_event_category ON audit_events(event_category);
CREATE INDEX idx_audit_events_target_type_id ON audit_events(target_type, target_id);

-- ============================================================================
-- VENDORS TABLE (Module 01 - Vendor Management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Basic Information
    vendor_name TEXT NOT NULL,
    vendor_type TEXT CHECK (vendor_type IN ('it-services', 'cloud-provider', 'consulting', 'healthcare', 'other')),
    legal_name TEXT,
    trade_license_number TEXT,

    -- Contact Information
    primary_contact_name TEXT,
    primary_contact_email TEXT,
    primary_contact_phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'UAE',

    -- ADHICS Compliance (TP 2.1 - Vendor Security Assessment)
    risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    assessment_status TEXT DEFAULT 'pending' CHECK (assessment_status IN ('pending', 'in-progress', 'approved', 'rejected')),
    assessment_date TIMESTAMPTZ,
    next_assessment_date TIMESTAMPTZ,

    -- Contract & Agreement
    contract_signed BOOLEAN DEFAULT FALSE,
    contract_start_date DATE,
    contract_end_date DATE,
    sda_signed BOOLEAN DEFAULT FALSE,
    sda_signed_date TIMESTAMPTZ,

    -- Data Access
    has_phi_access BOOLEAN DEFAULT FALSE,
    has_pii_access BOOLEAN DEFAULT FALSE,
    access_description TEXT,

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),

    -- Metadata
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    -- Constraints
    CONSTRAINT vendors_tenant_name_key UNIQUE (tenant_id, vendor_name)
);

-- Indexes for vendors
CREATE INDEX idx_vendors_tenant_id ON vendors(tenant_id);
CREATE INDEX idx_vendors_status ON vendors(status);
CREATE INDEX idx_vendors_risk_level ON vendors(risk_level);
CREATE INDEX idx_vendors_assessment_status ON vendors(assessment_status);

-- Trigger for updated_at
CREATE TRIGGER trg_vendors_updated_at
    BEFORE UPDATE ON vendors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- POLICIES TABLE (Module 01 - Policy Management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Policy Information
    policy_number TEXT,
    policy_name TEXT NOT NULL,
    policy_type TEXT CHECK (policy_type IN ('hr-security', 'third-party-security', 'data-protection', 'access-control', 'other')),
    version_number TEXT NOT NULL DEFAULT '1.0',

    -- Content
    description TEXT,
    policy_content TEXT,

    -- ADHICS Mapping
    adhics_control_ids TEXT[], -- e.g., ['HR 1.1', 'HR 2.1']

    -- Status & Lifecycle
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'published', 'archived')),
    approved_by UUID,
    approved_date TIMESTAMPTZ,
    effective_date DATE,
    review_date DATE,
    next_review_date DATE,

    -- Acknowledgment Tracking
    requires_acknowledgment BOOLEAN DEFAULT TRUE,
    acknowledgment_count INTEGER DEFAULT 0,

    -- Metadata
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    -- Constraints
    CONSTRAINT policies_tenant_policy_number_key UNIQUE (tenant_id, policy_number)
);

-- Indexes for policies
CREATE INDEX idx_policies_tenant_id ON policies(tenant_id);
CREATE INDEX idx_policies_status ON policies(status);
CREATE INDEX idx_policies_policy_type ON policies(policy_type);
CREATE INDEX idx_policies_effective_date ON policies(effective_date);

-- Trigger for updated_at
CREATE TRIGGER trg_policies_updated_at
    BEFORE UPDATE ON policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- POLICY_ACKNOWLEDGMENTS TABLE (Track employee policy acknowledgments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS policy_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- References
    policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    -- Policy Details (from migration 002)
    policy_name VARCHAR(255) NOT NULL,
    policy_version VARCHAR(50) NOT NULL,
    policy_type VARCHAR(100),

    -- Acknowledgment Details
    acknowledged_at TIMESTAMPTZ,
    acknowledgment_method VARCHAR(50),
    acknowledgment_ip VARCHAR(45),
    acknowledged_version TEXT,
    ip_address TEXT,
    user_agent TEXT,

    -- Document
    policy_url TEXT,
    policy_hash VARCHAR(64),

    -- Status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'expired', 'superseded')),

    -- Expiry
    requires_renewal BOOLEAN DEFAULT false,
    renewal_date DATE,

    -- Compliance
    adhics_required BOOLEAN DEFAULT false,

    -- Notes
    notes TEXT,

    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT policy_ack_unique UNIQUE (policy_id, employee_id, acknowledged_version),
    CHECK (acknowledgment_method IN ('digital-signature', 'email-confirmation', 'in-person', 'other'))
);

-- Indexes for policy_acknowledgments
CREATE INDEX idx_policy_ack_tenant_id ON policy_acknowledgments(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_policy_ack_policy_id ON policy_acknowledgments(policy_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_policy_ack_employee ON policy_acknowledgments(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_policy_ack_status ON policy_acknowledgments(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_policy_ack_renewal ON policy_acknowledgments(renewal_date) WHERE deleted_at IS NULL AND requires_renewal = true;

-- Trigger for updated_at
CREATE TRIGGER update_policy_acknowledgments_updated_at
BEFORE UPDATE ON policy_acknowledgments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DOCUMENTS TABLE (Secure document storage for HR/Vendor docs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Document Information
    document_name TEXT NOT NULL,
    document_type TEXT CHECK (document_type IN (
        'trade-license', 'passport', 'visa', 'emirates-id',
        'contract', 'nda', 'policy', 'certificate',
        'training-cert', 'dha-license', 'vendor-agreement', 'other'
    )),
    mime_type TEXT,
    file_size BIGINT,

    -- Storage
    storage_path TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT TRUE,
    encryption_key_id TEXT,

    -- References (polymorphic - can be employee, vendor, policy, etc.)
    entity_type TEXT NOT NULL CHECK (entity_type IN ('employee', 'vendor', 'policy', 'other')),
    entity_id UUID NOT NULL,

    -- Expiry Tracking
    issue_date DATE,
    expiry_date DATE,
    expiry_notified BOOLEAN DEFAULT FALSE,

    -- Access Control
    access_level TEXT DEFAULT 'restricted' CHECK (access_level IN ('public', 'internal', 'restricted', 'confidential')),

    -- Metadata
    uploaded_by UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for documents
CREATE INDEX idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX idx_documents_document_type ON documents(document_type);
CREATE INDEX idx_documents_expiry_date ON documents(expiry_date);

-- Trigger for updated_at
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END OF INITIAL SCHEMA
-- ============================================================================
