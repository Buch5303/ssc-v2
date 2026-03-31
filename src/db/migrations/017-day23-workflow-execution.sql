-- Day 23: Workflow Execution Engine
-- Audit table with exact-once replay via UNIQUE constraint.

CREATE TABLE IF NOT EXISTS workflow_executions (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id                   TEXT    NOT NULL,
    workflow_id              TEXT    NOT NULL,
    actor_user_id            TEXT    NOT NULL,
    execution_status         TEXT    NOT NULL
                             CHECK (execution_status IN (
                                 'EXECUTED', 'BLOCKED_PENDING_APPROVAL',
                                 'BLOCKED_ERROR', 'REPLAYED', 'REPLAY_BLOCKED'
                             )),
    approval_request_id      INTEGER,
    request_payload_json     TEXT    DEFAULT '{}',
    result_payload_json      TEXT    DEFAULT '{}',
    governance_snapshot_json TEXT    DEFAULT '{}',
    is_replay                INTEGER NOT NULL DEFAULT 0 CHECK (is_replay IN (0, 1)),
    replay_idempotency_key   TEXT    UNIQUE,
    replayed_by_user_id      TEXT,
    replayed_at              TEXT,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wf_exec_org        ON workflow_executions(org_id);
CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow    ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_exec_status      ON workflow_executions(execution_status);
CREATE INDEX IF NOT EXISTS idx_wf_exec_actor       ON workflow_executions(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_wf_exec_approval    ON workflow_executions(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_wf_exec_org_status  ON workflow_executions(org_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_wf_exec_created     ON workflow_executions(created_at);
