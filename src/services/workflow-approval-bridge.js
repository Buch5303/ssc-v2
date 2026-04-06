'use strict';
// SEALED: Day 31. This module is a thin redirect to governance-gate.js.
// No independent policy evaluation. All calls redirect to governance gate.
// Exists only for backward compatibility with Day 22 test imports.
const { enforceGovernance, GATE_STATUS } = require('./governance-gate');

async function interceptWorkflowExecution(db, params = {}) {
    const gate = await enforceGovernance(db, {
        org_id: params.org_id, target_type: 'workflow', target_id: params.workflow_id,
        action_type: params.action_type || 'execute', actor_user_id: params.actor_user_id,
        is_bulk: params.is_bulk, is_ai_originated: params.is_ai_originated,
        is_destructive: params.is_destructive, payload: params.payload || {},
    });
    // Map gate statuses to legacy bridge format (CLEAR means gate approved it)
    if (gate.status === GATE_STATUS.CLEAR) return { status: 'CLEAR', gate_verified: true };
    if (gate.status === GATE_STATUS.PENDING) return { status: 'PENDING_APPROVAL', approval_request_id: gate.approval_request_id };
    return { status: 'ERROR', error: gate.error || gate.status };
}
module.exports = { interceptWorkflowExecution };
