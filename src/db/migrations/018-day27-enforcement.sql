-- Day 27: Database-Level Enforcement
-- Triggers to prevent illegal state transitions at DB level.
-- These are defense-in-depth: application logic already prevents
-- these transitions, but triggers catch any direct DB writes.

-- Prevent transitioning FROM terminal states
CREATE TRIGGER IF NOT EXISTS trg_approval_no_terminal_change
BEFORE UPDATE OF request_status ON approval_requests
WHEN OLD.request_status IN ('APPROVED', 'REJECTED', 'CANCELLED')
  AND NEW.request_status != OLD.request_status
BEGIN
    SELECT RAISE(ABORT, 'TRIGGER_VIOLATION: cannot change terminal status');
END;

-- Prevent setting approved_by to same as requested_by (self-approval)
CREATE TRIGGER IF NOT EXISTS trg_approval_no_self_approve
BEFORE UPDATE OF approved_by_user_id ON approval_requests
WHEN NEW.approved_by_user_id IS NOT NULL
  AND NEW.approved_by_user_id = OLD.requested_by_user_id
  AND NEW.request_status = 'APPROVED'
BEGIN
    SELECT RAISE(ABORT, 'TRIGGER_VIOLATION: self-approval prohibited');
END;

-- Prevent DUAL approval with same user for both approvals
CREATE TRIGGER IF NOT EXISTS trg_approval_no_same_dual
BEFORE UPDATE OF second_approved_by_user_id ON approval_requests
WHEN NEW.second_approved_by_user_id IS NOT NULL
  AND NEW.second_approved_by_user_id = OLD.approved_by_user_id
BEGIN
    SELECT RAISE(ABORT, 'TRIGGER_VIOLATION: DUAL approval requires different approvers');
END;
