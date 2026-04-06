-- Day 29: PostgreSQL Production Migration
-- Run this against a PostgreSQL database for production deployment.
-- Preserves all governance logic from SQLite migrations.

-- Enable Row Level Security
ALTER TABLE IF EXISTS approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS governance_audit_log ENABLE ROW LEVEL SECURITY;

-- Create tables if not exists (PostgreSQL syntax)

CREATE TABLE IF NOT EXISTS approval_policies (
    id                SERIAL PRIMARY KEY,
    org_id            TEXT    NOT NULL,
    action_key        TEXT    NOT NULL,
    approval_mode     TEXT    NOT NULL DEFAULT 'NONE'
                      CHECK (approval_mode IN ('NONE', 'SINGLE', 'DUAL')),
    risk_level        TEXT    NOT NULL DEFAULT 'LOW'
                      CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    is_bulk           BOOLEAN NOT NULL DEFAULT FALSE,
    is_destructive    BOOLEAN NOT NULL DEFAULT FALSE,
    is_ai_originated  BOOLEAN NOT NULL DEFAULT FALSE,
    conditions_json   JSONB   DEFAULT '{}',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
    id                          SERIAL PRIMARY KEY,
    org_id                      TEXT    NOT NULL,
    target_type                 TEXT    NOT NULL,
    target_id                   TEXT,
    action_key                  TEXT    NOT NULL,
    request_payload_json        JSONB   DEFAULT '{}',
    request_status              TEXT    NOT NULL DEFAULT 'PENDING'
                                CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    approval_mode               TEXT    NOT NULL DEFAULT 'SINGLE'
                                CHECK (approval_mode IN ('SINGLE', 'DUAL')),
    risk_level                  TEXT    NOT NULL DEFAULT 'LOW'
                                CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    requested_by_user_id        TEXT    NOT NULL,
    approved_by_user_id         TEXT,
    second_approved_by_user_id  TEXT,
    rejected_by_user_id         TEXT,
    cancelled_by_user_id        TEXT,
    policy_snapshot_json        JSONB   DEFAULT '{}',
    decision_metadata_json      JSONB   DEFAULT '{}',
    escalation_reason           TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at                 TIMESTAMPTZ,
    -- Constraints
    CONSTRAINT chk_self_approval CHECK (approved_by_user_id IS NULL OR approved_by_user_id != requested_by_user_id),
    CONSTRAINT chk_dual_distinct CHECK (second_approved_by_user_id IS NULL OR second_approved_by_user_id != approved_by_user_id)
);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id                       SERIAL PRIMARY KEY,
    org_id                   TEXT    NOT NULL,
    workflow_id              TEXT    NOT NULL,
    actor_user_id            TEXT    NOT NULL,
    execution_status         TEXT    NOT NULL
                             CHECK (execution_status IN (
                                 'EXECUTED', 'BLOCKED_PENDING_APPROVAL',
                                 'BLOCKED_ERROR', 'REPLAYED', 'REPLAY_BLOCKED'
                             )),
    approval_request_id      INTEGER,
    request_payload_json     JSONB   DEFAULT '{}',
    result_payload_json      JSONB   DEFAULT '{}',
    governance_snapshot_json  JSONB   DEFAULT '{}',
    is_replay                BOOLEAN NOT NULL DEFAULT FALSE,
    replay_idempotency_key   TEXT    UNIQUE,
    replayed_by_user_id      TEXT,
    replayed_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance_audit_log (
    id              SERIAL PRIMARY KEY,
    event_type      TEXT    NOT NULL,
    org_id          TEXT    NOT NULL,
    actor_user_id   TEXT    NOT NULL,
    target_type     TEXT,
    target_id       TEXT,
    action_key      TEXT,
    approval_id     INTEGER,
    execution_id    INTEGER,
    decision_path   TEXT,
    policy_applied  JSONB   DEFAULT '{}',
    outcome         TEXT    NOT NULL,
    detail_json     JSONB   DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limit_entries (
    id          SERIAL PRIMARY KEY,
    key         TEXT    NOT NULL,
    org_id      TEXT    NOT NULL,
    window_start TEXT   NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(key, org_id, window_start)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ar_org_status ON approval_requests(org_id, request_status);
CREATE INDEX IF NOT EXISTS idx_ar_org_action ON approval_requests(org_id, action_key);
CREATE INDEX IF NOT EXISTS idx_ar_target ON approval_requests(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_we_org_status ON workflow_executions(org_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_we_approval ON workflow_executions(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_gal_org ON governance_audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_gal_created ON governance_audit_log(created_at);

-- Row Level Security Policies
CREATE POLICY IF NOT EXISTS tenant_approval_requests ON approval_requests
    USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY IF NOT EXISTS tenant_workflow_executions ON workflow_executions
    USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY IF NOT EXISTS tenant_audit_log ON governance_audit_log
    USING (org_id = current_setting('app.current_org_id', true));

-- Trigger: prevent terminal state changes (PostgreSQL version)
CREATE OR REPLACE FUNCTION prevent_terminal_change() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.request_status IN ('APPROVED', 'REJECTED', 'CANCELLED')
       AND NEW.request_status != OLD.request_status THEN
        RAISE EXCEPTION 'TRIGGER_VIOLATION: cannot change terminal status from % to %', OLD.request_status, NEW.request_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_terminal ON approval_requests;
CREATE TRIGGER trg_approval_terminal
    BEFORE UPDATE ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION prevent_terminal_change();

-- Trigger: audit log immutability
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_VIOLATION: audit log is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON governance_audit_log;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON governance_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON governance_audit_log;
CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON governance_audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
