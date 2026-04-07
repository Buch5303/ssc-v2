-- Day 31: Additional DB-level hardening (PostgreSQL syntax)
-- SQLite triggers replaced with PG-compatible CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER pattern

-- Prevent direct INSERT with terminal status (must start PENDING)
CREATE OR REPLACE FUNCTION fn_approval_must_start_pending() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.request_status != 'PENDING' THEN
        RAISE EXCEPTION 'CONSTRAINT_VIOLATION: approval must start as PENDING';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_must_start_pending ON approval_requests;
CREATE TRIGGER trg_approval_must_start_pending
    BEFORE INSERT ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION fn_approval_must_start_pending();

-- Prevent updating org_id after creation (tenant immutability)
CREATE OR REPLACE FUNCTION fn_approval_org_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.org_id != OLD.org_id THEN
        RAISE EXCEPTION 'CONSTRAINT_VIOLATION: org_id is immutable after creation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_org_immutable ON approval_requests;
CREATE TRIGGER trg_approval_org_immutable
    BEFORE UPDATE OF org_id ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION fn_approval_org_immutable();

-- Prevent updating requested_by_user_id after creation
CREATE OR REPLACE FUNCTION fn_approval_requester_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.requested_by_user_id != OLD.requested_by_user_id THEN
        RAISE EXCEPTION 'CONSTRAINT_VIOLATION: requested_by_user_id is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_requester_immutable ON approval_requests;
CREATE TRIGGER trg_approval_requester_immutable
    BEFORE UPDATE OF requested_by_user_id ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION fn_approval_requester_immutable();

-- Prevent updating org_id on executions
CREATE OR REPLACE FUNCTION fn_execution_org_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.org_id != OLD.org_id THEN
        RAISE EXCEPTION 'CONSTRAINT_VIOLATION: execution org_id is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_org_immutable ON workflow_executions;
CREATE TRIGGER trg_execution_org_immutable
    BEFORE UPDATE OF org_id ON workflow_executions
    FOR EACH ROW EXECUTE FUNCTION fn_execution_org_immutable();
