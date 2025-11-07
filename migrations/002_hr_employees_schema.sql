-- Migration 002: HR Employees and Compliance Schema
-- Purpose: Create tables for employee management and ADHICS HR compliance tracking
-- This schema runs on the Agent database (customer's BYOD database)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==================== Helper Functions ====================

-- Function to automatically update updated_at timestamp and increment version
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================== ADHICS Compliance Tables ====================
-- Note: Employees table is defined in 001_initial_schema.sql

-- 1. Employee Verifications (ADHICS HR 2.1)
CREATE TABLE IF NOT EXISTS employee_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    -- Verification Details
    verification_type VARCHAR(100) NOT NULL, -- 'background-check', 'education', 'employment-history', 'criminal-record'
    verification_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in-progress', 'completed', 'failed', 'expired'

    -- Verification Provider
    provider_name VARCHAR(255),
    provider_reference VARCHAR(255),

    -- Dates
    verification_date DATE,
    expiry_date DATE,

    -- Documents
    document_url TEXT,
    document_name VARCHAR(255),

    -- Notes
    notes TEXT,
    verified_by VARCHAR(255),

    -- Compliance
    adhics_compliant BOOLEAN DEFAULT false,
    compliance_notes TEXT,

    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CHECK (verification_status IN ('pending', 'in-progress', 'completed', 'failed', 'expired')),
    CHECK (verification_type IN ('background-check', 'education', 'employment-history', 'criminal-record', 'reference-check'))
);

CREATE INDEX idx_verifications_employee ON employee_verifications(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_verifications_status ON employee_verifications(tenant_id, verification_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_verifications_expiry ON employee_verifications(expiry_date) WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE TRIGGER update_employee_verifications_updated_at
BEFORE UPDATE ON employee_verifications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. Employment Contracts (ADHICS HR 2.2)
CREATE TABLE IF NOT EXISTS employment_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    -- Contract Details
    contract_type VARCHAR(50) NOT NULL, -- 'permanent', 'fixed-term', 'probation', 'temporary'
    contract_status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'expired', 'terminated', 'renewed'

    -- Dates
    start_date DATE NOT NULL,
    end_date DATE,
    signed_date DATE,

    -- Contract Terms
    position VARCHAR(255),
    department VARCHAR(255),
    salary_amount DECIMAL(15, 2),
    salary_currency VARCHAR(10) DEFAULT 'AED',

    -- Documents
    document_url TEXT,
    document_name VARCHAR(255),
    document_hash VARCHAR(64),

    -- Compliance
    adhics_compliant BOOLEAN DEFAULT false,
    compliance_notes TEXT,
    nda_signed BOOLEAN DEFAULT false,
    confidentiality_agreed BOOLEAN DEFAULT false,

    -- Notes
    notes TEXT,

    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CHECK (contract_type IN ('permanent', 'fixed-term', 'probation', 'temporary')),
    CHECK (contract_status IN ('draft', 'active', 'expired', 'terminated', 'renewed'))
);

CREATE INDEX idx_contracts_employee ON employment_contracts(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_status ON employment_contracts(tenant_id, contract_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_dates ON employment_contracts(start_date, end_date) WHERE deleted_at IS NULL;

CREATE TRIGGER update_employment_contracts_updated_at
BEFORE UPDATE ON employment_contracts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 4. Training Records (ADHICS HR 3.1)
CREATE TABLE IF NOT EXISTS training_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    -- Training Details
    training_name VARCHAR(255) NOT NULL,
    training_type VARCHAR(100) NOT NULL, -- 'security-awareness', 'data-protection', 'incident-response', 'compliance', 'technical'
    training_provider VARCHAR(255),

    -- Status
    training_status VARCHAR(50) DEFAULT 'scheduled', -- 'scheduled', 'in-progress', 'completed', 'failed', 'expired'

    -- Dates
    scheduled_date DATE,
    completion_date DATE,
    expiry_date DATE,

    -- Certification
    certificate_url TEXT,
    certificate_number VARCHAR(255),

    -- Assessment
    assessment_score DECIMAL(5, 2),
    passing_score DECIMAL(5, 2) DEFAULT 80.00,
    assessment_passed BOOLEAN,

    -- Compliance
    adhics_required BOOLEAN DEFAULT false,
    adhics_compliant BOOLEAN DEFAULT false,
    compliance_notes TEXT,

    -- Notes
    notes TEXT,

    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CHECK (training_status IN ('scheduled', 'in-progress', 'completed', 'failed', 'expired')),
    CHECK (training_type IN ('security-awareness', 'data-protection', 'incident-response', 'compliance', 'technical', 'other'))
);

CREATE INDEX idx_training_employee ON training_records(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_training_status ON training_records(tenant_id, training_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_training_expiry ON training_records(expiry_date) WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;
CREATE INDEX idx_training_adhics ON training_records(tenant_id, adhics_required, adhics_compliant) WHERE deleted_at IS NULL;

CREATE TRIGGER update_training_records_updated_at
BEFORE UPDATE ON training_records
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 5. Exit Checklists (ADHICS HR 4.1)
-- Note: Policy Acknowledgments table is defined in 001_initial_schema.sql
CREATE TABLE IF NOT EXISTS exit_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

    -- Exit Details
    exit_type VARCHAR(50), -- 'resignation', 'termination', 'retirement', 'end-of-contract'
    exit_date DATE NOT NULL,
    last_working_day DATE,
    notice_period_days INTEGER,

    -- Checklist Items (JSON for flexibility)
    checklist_items JSONB DEFAULT '[]'::jsonb,

    -- Access Revocation
    access_revoked BOOLEAN DEFAULT false,
    access_revoked_at TIMESTAMPTZ,
    access_revoked_by VARCHAR(255),

    -- Asset Return
    assets_returned BOOLEAN DEFAULT false,
    assets_returned_at TIMESTAMPTZ,
    asset_notes TEXT,

    -- Documentation
    exit_interview_completed BOOLEAN DEFAULT false,
    exit_interview_date DATE,
    exit_interview_notes TEXT,

    -- Clearance
    clearance_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in-progress', 'completed', 'issues'
    clearance_completed_at TIMESTAMPTZ,
    clearance_approved_by VARCHAR(255),

    -- Compliance
    adhics_compliant BOOLEAN DEFAULT false,
    compliance_notes TEXT,

    -- Notes
    notes TEXT,

    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CHECK (exit_type IN ('resignation', 'termination', 'retirement', 'end-of-contract', 'other')),
    CHECK (clearance_status IN ('pending', 'in-progress', 'completed', 'issues'))
);

CREATE INDEX idx_exit_employee ON exit_checklists(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_exit_status ON exit_checklists(tenant_id, clearance_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_exit_date ON exit_checklists(exit_date) WHERE deleted_at IS NULL;

CREATE TRIGGER update_exit_checklists_updated_at
BEFORE UPDATE ON exit_checklists
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ==================== Compliance Views ====================

-- Employee Compliance Summary View
CREATE OR REPLACE VIEW employee_compliance_summary AS
SELECT
    e.id,
    e.tenant_id,
    e.employee_id,
    e.full_name,
    e.email,
    e.department,
    e.position,
    e.employment_status,
    e.hire_date,

    -- Verification compliance
    COUNT(DISTINCT ev.id) FILTER (WHERE ev.verification_status = 'completed') as completed_verifications,
    COUNT(DISTINCT ev.id) FILTER (WHERE ev.verification_status = 'expired') as expired_verifications,

    -- Contract compliance
    EXISTS(
        SELECT 1 FROM employment_contracts ec
        WHERE ec.employee_id = e.id
        AND ec.contract_status = 'active'
        AND ec.deleted_at IS NULL
    ) as has_active_contract,

    -- Training compliance
    COUNT(DISTINCT tr.id) FILTER (WHERE tr.adhics_required = true AND tr.adhics_compliant = true) as compliant_trainings,
    COUNT(DISTINCT tr.id) FILTER (WHERE tr.adhics_required = true AND tr.training_status = 'expired') as expired_trainings,

    -- Policy acknowledgment compliance
    COUNT(DISTINCT pa.id) FILTER (WHERE pa.adhics_required = true AND pa.status = 'acknowledged') as acknowledged_policies,
    COUNT(DISTINCT pa.id) FILTER (WHERE pa.adhics_required = true AND pa.status = 'expired') as expired_policies,

    -- Overall compliance status
    CASE
        WHEN e.employment_status != 'active' THEN 'inactive'
        WHEN COUNT(DISTINCT ev.id) FILTER (WHERE ev.verification_status = 'expired') > 0 THEN 'non-compliant'
        WHEN COUNT(DISTINCT tr.id) FILTER (WHERE tr.adhics_required = true AND tr.training_status = 'expired') > 0 THEN 'non-compliant'
        WHEN NOT EXISTS(SELECT 1 FROM employment_contracts ec WHERE ec.employee_id = e.id AND ec.contract_status = 'active' AND ec.deleted_at IS NULL) THEN 'non-compliant'
        ELSE 'compliant'
    END as compliance_status,

    e.created_at,
    e.updated_at

FROM employees e
LEFT JOIN employee_verifications ev ON ev.employee_id = e.id AND ev.deleted_at IS NULL
LEFT JOIN training_records tr ON tr.employee_id = e.id AND tr.deleted_at IS NULL
LEFT JOIN policy_acknowledgments pa ON pa.employee_id = e.id AND pa.deleted_at IS NULL
WHERE e.deleted_at IS NULL
GROUP BY e.id, e.tenant_id, e.employee_id, e.full_name, e.email, e.department, e.position, e.employment_status, e.hire_date, e.created_at, e.updated_at;

-- Comment for documentation
COMMENT ON TABLE employees IS 'Employee master data for ADHICS HR compliance';
COMMENT ON TABLE employee_verifications IS 'Background verification records (ADHICS HR 2.1)';
COMMENT ON TABLE employment_contracts IS 'Employment contract records (ADHICS HR 2.2)';
COMMENT ON TABLE training_records IS 'Security awareness training records (ADHICS HR 3.1)';
COMMENT ON TABLE policy_acknowledgments IS 'Security policy acknowledgments (ADHICS HR 3.2)';
COMMENT ON TABLE exit_checklists IS 'Employee exit management records (ADHICS HR 4.1)';
COMMENT ON VIEW employee_compliance_summary IS 'Aggregated employee compliance status for reporting';
