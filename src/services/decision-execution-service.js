'use strict';

const { enforceGovernance, assertGovernanceEnforced, _resetGovernanceFlag, GATE_STATUS } = require('./governance-gate');

/**
 * Day 27: Decision Execution Service
 *
 * ALL decision actions (resolve, dismiss, update, delete, reassign,
 * comment, archive) go through the governance gate. No bypass.
 */

const ALL_DECISION_ACTIONS = new Set([
    'resolve', 'dismiss', 'update', 'delete',
    'reassign', 'comment', 'archive',
]);

async function executeDecisionAction(db, params = {}) {
    try {
        if (!params.org_id) return { success: false, error: 'org_id_required' };
        if (!params.decision_id) return { success: false, error: 'decision_id_required' };
        if (!params.actor_user_id) return { success: false, error: 'actor_user_id_required' };
        if (!params.action_type) return { success: false, error: 'action_type_required' };

        if (!ALL_DECISION_ACTIONS.has(params.action_type)) {
            return { success: false, error: 'unknown_decision_action: ' + params.action_type };
        }

        _resetGovernanceFlag();
        const gate = await enforceGovernance(db, {
            org_id: params.org_id,
            target_type: 'decision',
            target_id: params.decision_id,
            action_type: params.action_type,
            actor_user_id: params.actor_user_id,
            is_bulk: params.is_bulk,
            is_ai_originated: params.is_ai_originated,
            is_destructive: params.is_destructive,
            payload: params.payload || {},
        });
        assertGovernanceEnforced();

        if (gate.status === GATE_STATUS.CLEAR) {
            return {
                success: true,
                action_status: 'EXECUTED',
                action_type: params.action_type,
                decision_id: params.decision_id,
            };
        }

        if (gate.status === GATE_STATUS.PENDING) {
            return {
                success: true,
                action_status: 'BLOCKED_PENDING_APPROVAL',
                approval_request_id: gate.approval_request_id,
                action_type: params.action_type,
                decision_id: params.decision_id,
            };
        }

        return {
            success: false,
            action_status: 'BLOCKED_ERROR',
            error: gate.error || gate.status,
        };
    } catch (e) {
        return { success: false, error: 'decision_execution_error: ' + e.message };
    }
}

module.exports = { executeDecisionAction, ALL_DECISION_ACTIONS };
