'use strict';

/**
 * Day 26: Governance Invariant Verification
 *
 * Post-write checks that prove state machine correctness.
 * Called after every approval state transition to verify:
 * - Status is one of the valid terminal/pending states
 * - DUAL approval has two distinct approvers when APPROVED
 * - No self-approval occurred
 * - Requester did not approve their own request
 */

const VALID_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

async function verifyApprovalInvariant(db, id) {
    const row = await db.prepare(
        'SELECT id, request_status, approval_mode, requested_by_user_id, approved_by_user_id, second_approved_by_user_id, rejected_by_user_id, cancelled_by_user_id FROM approval_requests WHERE id = ?'
    ).get(id);

    if (!row) {
        return { valid: false, violation: 'ROW_MISSING', detail: 'row disappeared after write for id=' + id };
    }

    if (!VALID_STATUSES.has(row.request_status)) {
        return { valid: false, violation: 'INVALID_STATUS', detail: 'status ' + row.request_status + ' not in valid set' };
    }

    // If APPROVED with DUAL mode, must have two distinct approvers
    if (row.request_status === 'APPROVED' && row.approval_mode === 'DUAL') {
        if (!row.approved_by_user_id || !row.second_approved_by_user_id) {
            return { valid: false, violation: 'DUAL_MISSING_APPROVER', detail: 'DUAL APPROVED but missing approver' };
        }
        if (row.approved_by_user_id === row.second_approved_by_user_id) {
            return { valid: false, violation: 'DUAL_SAME_APPROVER', detail: 'same user approved twice' };
        }
    }

    // Self-approval check: requester must not be approver
    if (row.request_status === 'APPROVED' && row.approved_by_user_id === row.requested_by_user_id) {
        return { valid: false, violation: 'SELF_APPROVAL', detail: 'requester approved own request' };
    }

    return { valid: true };
}

async function verifyExecutionInvariant(db, id) {
    const row = await db.prepare(
        'SELECT id, execution_status, org_id, actor_user_id, is_replay, replay_idempotency_key FROM workflow_executions WHERE id = ?'
    ).get(id);

    if (!row) {
        return { valid: false, violation: 'ROW_MISSING', detail: 'execution row disappeared for id=' + id };
    }

    if (!row.org_id || !row.actor_user_id) {
        return { valid: false, violation: 'MISSING_IDENTITY', detail: 'org_id or actor_user_id null' };
    }

    if (row.is_replay === 1 && !row.replay_idempotency_key) {
        return { valid: false, violation: 'REPLAY_NO_KEY', detail: 'replay without idempotency key' };
    }

    return { valid: true };
}

module.exports = { verifyApprovalInvariant, verifyExecutionInvariant };
