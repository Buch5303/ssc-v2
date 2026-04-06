'use strict';
// SEALED: Day 31. Redirects ALL decision actions to governance-gate.js.
// No independent intercept logic. All calls redirect to governance gate.
// Use decision-execution-service.js for governed decision execution.
const { enforceGovernance, GATE_STATUS } = require('./governance-gate');

async function interceptDecisionAction(db, params = {}) {
    const gate = await enforceGovernance(db, {
        org_id: params.org_id, target_type: 'decision', target_id: params.decision_id,
        action_type: params.action_type || 'resolve', actor_user_id: params.actor_user_id,
        is_bulk: params.is_bulk, is_ai_originated: params.is_ai_originated,
        is_destructive: params.is_destructive, payload: params.payload || {},
    });
    if (gate.status === GATE_STATUS.CLEAR) return { status: 'CLEAR', gate_verified: true };
    if (gate.status === GATE_STATUS.PENDING) return { status: 'PENDING_APPROVAL', approval_request_id: gate.approval_request_id };
    return { status: 'ERROR', error: gate.error || gate.status };
}
module.exports = { interceptDecisionAction };
