-- Migration: Add access_denied_audit table
-- Purpose: Append-only audit trail for access denial events
-- EQS v1.0 compliant with composite index for performance

-- Create access_denied_audit table if it doesn't exist
CREATE TABLE IF NOT EXISTS access_denied_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  ip TEXT,
  reason TEXT,
  denied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create composite index for EQS-compliant query performance
CREATE INDEX IF NOT EXISTS access_denied_audit_user_denied_at_idx 
  ON access_denied_audit (user_id, denied_at);

-- Enforce append-only at database permission layer
-- Note: Replace 'flowseer_app' with your actual application database role
REVOKE DELETE, UPDATE ON access_denied_audit FROM flowseer_app;
GRANT INSERT, SELECT ON access_denied_audit TO flowseer_app;

-- Optional: Add comment for documentation
COMMENT ON TABLE access_denied_audit IS 'Append-only audit trail for access denial events. DELETE/UPDATE operations are revoked at DB level for data integrity.';