-- Day 28: Immutable Audit Log + Rate Limiting

CREATE TABLE IF NOT EXISTS governance_audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL,
    org_id          TEXT    NOT NULL,
    actor_user_id   TEXT    NOT NULL,
    target_type     TEXT,
    target_id       TEXT,
    action_key      TEXT,
    approval_id     INTEGER,
    execution_id    INTEGER,
    decision_path   TEXT,
    policy_applied  TEXT    DEFAULT '{}',
    outcome         TEXT    NOT NULL,
    detail_json     TEXT    DEFAULT '{}',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_org ON governance_audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON governance_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON governance_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON governance_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_approval ON governance_audit_log(approval_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON governance_audit_log(target_type, target_id);

-- Prevent DELETE on audit log (append-only)
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON governance_audit_log
BEGIN
    SELECT RAISE(ABORT, 'AUDIT_VIOLATION: audit log is append-only');
END;

-- Prevent UPDATE on audit log (immutable)
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON governance_audit_log
BEGIN
    SELECT RAISE(ABORT, 'AUDIT_VIOLATION: audit log is immutable');
END;

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limit_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT    NOT NULL,
    org_id      TEXT    NOT NULL,
    window_start TEXT   NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(key, org_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_key ON rate_limit_entries(key, org_id);
CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limit_entries(window_start);
