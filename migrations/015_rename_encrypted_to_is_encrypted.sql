-- Migration: 015_rename_encrypted_to_is_encrypted.sql
-- Description: No-op migration (is_encrypted already exists from migration 012)
-- Date: 2025-01-04
-- Note: This migration was created when we thought there was an 'encrypted' column
--       but migration 012 already has 'is_encrypted', so nothing to do here.

BEGIN;

-- No-op: is_encrypted already exists from migration 012
-- Just verify it exists (this will succeed if column exists, no-op if not)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'is_encrypted'
  ) THEN
    RAISE EXCEPTION 'Column is_encrypted does not exist in documents table';
  END IF;
END $$;

COMMIT;
