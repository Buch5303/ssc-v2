-- ============================================================
-- Day 22: Approval Governance
-- Migration: 016-day22-approval-governance.sql
--
-- Creates approval_policies and approval_requests tables.
-- Designed for auditability, query performance, and
-- deterministic governance enforcement.
--
-- Convention: no foreign keys (per repo pattern).
-- Coherence enforced via CHECK constraints and application logic.
-- ============================================================

-- ------------------------------------------------------------
-- approval_policies
-- Org-scoped deterministic policy definitions.
-- Each row maps an org + action_key to an approval mode/risk.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_policies (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id            TEXT    NOT NULL,
    action_key        TEXT    NOT NULL,                            -- e.g. 'workflow:execute', 'decision:resolve'
    approval_mode     TEXT    NOT NULL DEFAULT 'NONE'
                      CHECK (approval_mode IN ('NONE', 'SINGLE', 'DUAL')),
    risk_level        TEXT    NOT NULL DEFAULT 'LOW'
                      CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    is_bulk           INTEGER NOT NULL DEFAULT 0
                      CHECK (is_bulk IN (0, 1)),
    is_destructive    INTEGER NOT NULL DEFAULT 0
                      CHECK (is_destructive IN (0, 1)),
    is_ai_originated  INTEGER NOT NULL DEFAULT 0
                      CHECK (is_ai_originated IN (0, 1)),
    conditions_json   TEXT    DEFAULT '{}',
    is_active         INTEGER NOT NULL DEFAULT 1
                      CHECK (is_active IN (0, 1)),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_policies_org_id
    ON approval_policies(org_id);

CREATE INDEX IF NOT EXISTS idx_approval_policies_action_key
    ON approval_policies(action_key);

CREATE INDEX IF NOT EXISTS idx_approval_policies_org_action
    ON approval_policies(org_id, action_key);

CREATE INDEX IF NOT EXISTS idx_approval_policies_active
    ON approval_policies(is_active);

-- Unique constraint: one active policy per org + action_key
-- (enforced at application layer for flexibility, index aids lookup)
CREATE INDEX IF NOT EXISTS idx_approval_policies_org_action_active
    ON approval_policies(org_id, action_key, is_active);

-- ------------------------------------------------------------
-- approval_requests
-- Tracks individual approval requests through their lifecycle.
-- Every field needed for full audit trail is a first-class column.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id                      TEXT    NOT NULL,
    target_type                 TEXT    NOT NULL,                  -- 'workflow', 'decision', 'quarantine'
    target_id                   TEXT,                              -- ID of entity requiring approval
    action_key                  TEXT    NOT NULL,                  -- e.g. 'workflow:execute', 'quarantine:force_approve'
    request_payload_json        TEXT    DEFAULT '{}',
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
    policy_snapshot_json        TEXT    DEFAULT '{}',              -- snapshot of policy at request time
    decision_metadata_json      TEXT    DEFAULT '{}',              -- reason, notes, escalation info
    escalation_reason           TEXT,                              -- why approval was required
    created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at                 TEXT                               -- when terminal state was reached
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_org_id
    ON approval_requests(org_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
    ON approval_requests(request_status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_action_key
    ON approval_requests(action_key);

CREATE INDEX IF NOT EXISTS idx_approval_requests_target_type
    ON approval_requests(target_type);

CREATE INDEX IF NOT EXISTS idx_approval_requests_target_id
    ON approval_requests(target_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at
    ON approval_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_approval_requests_org_status
    ON approval_requests(org_id, request_status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_org_action
    ON approval_requests(org_id, action_key);

CREATE INDEX IF NOT EXISTS idx_approval_requests_risk_level
    ON approval_requests(risk_level);

CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by
    ON approval_requests(requested_by_user_id);
