-- EQS v1.0 IMMUTABLE AUDIT LOG: No UPDATE or DELETE permitted per SOC 2 / ISO 27001 requirements

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs (actor_id);

-- Enforce immutability at database permission layer
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;