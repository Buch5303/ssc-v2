-- Day 31: Additional DB-level hardening

-- Prevent direct INSERT with terminal status (must start PENDING)
CREATE TRIGGER IF NOT EXISTS trg_approval_must_start_pending
BEFORE INSERT ON approval_requests
WHEN NEW.request_status != 'PENDING'
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT_VIOLATION: approval must start as PENDING');
END;

-- Prevent updating org_id after creation (tenant immutability)
CREATE TRIGGER IF NOT EXISTS trg_approval_org_immutable
BEFORE UPDATE OF org_id ON approval_requests
WHEN NEW.org_id != OLD.org_id
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT_VIOLATION: org_id is immutable after creation');
END;

-- Prevent updating requested_by_user_id after creation
CREATE TRIGGER IF NOT EXISTS trg_approval_requester_immutable
BEFORE UPDATE OF requested_by_user_id ON approval_requests
WHEN NEW.requested_by_user_id != OLD.requested_by_user_id
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT_VIOLATION: requested_by_user_id is immutable');
END;

-- Prevent updating org_id on executions
CREATE TRIGGER IF NOT EXISTS trg_execution_org_immutable
BEFORE UPDATE OF org_id ON workflow_executions
WHEN NEW.org_id != OLD.org_id
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT_VIOLATION: execution org_id is immutable');
END;
