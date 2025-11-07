-- Migration 003: Add national_id column to employees table
-- Purpose: Add support for Emirates ID / Passport number storage
-- This migration adds the national_id column that was missing from the initial schema

-- Add national_id column to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS national_id VARCHAR(100);

-- Add comment for documentation
COMMENT ON COLUMN employees.national_id IS 'Emirates ID or Passport number for employee identification';

-- Create index for faster searches (optional, but useful for compliance queries)
CREATE INDEX IF NOT EXISTS idx_employees_national_id ON employees(national_id) WHERE national_id IS NOT NULL;
