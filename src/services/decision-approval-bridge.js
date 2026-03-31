// ============================================================
// Day 22: Decision-Approval Bridge
//
// Intercepts decision resolve/dismiss before terminal mutation.
// FAIL-CLOSED: if governance evaluation fails, action is blocked.
// ============================================================

'use strict';

const { isApprovalRequired } = require('./approval-policy-registry');
const { createApprovalRequest } = require('./approval-service');

const INTERCEPTED_ACTIONS = new Set(['resolve', 'dismiss']);

/**
 * Intercept a decision action (resolve or dismiss).
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.org_id           - MUST come from trusted context
 * @param {string} params.decision_id
 * @param {string} params.action_type      - 'resolve' or 'dismiss'
 * @param {string} params.actor_user_id    - MUST come from trusted context
 * @param {boolean} [params.is_bulk]
 * @param {boolean} [params.is_ai_originated]
 * @param {boolean} [params.is_destructive]
 * @param {object} [params.payload]
 * @returns {{ status: string, approval_request_id?: number, error?: string }}
 */
function interceptDecisionAction(db, params = {}) {
    try {
        if (!params.org_id) {
            return { status: 'ERROR', error: 'org_id_required_from_trusted_context' };
        }
        if (!params.decision_id) {
            return { status: 'ERROR', error: 'decision_id_required' };
        }
        if (!params.actor_user_id) {
            return { status: 'ERROR', error: 'actor_user_id_required_from_trusted_context' };
        }

        const actionType = params.action_type || 'resolve';

        // Only intercept known decision actions
        if (!INTERCEPTED_ACTIONS.has(actionType)) {
            return { status: 'PASS_THROUGH' };
        }

        const actionKey = `decision:${actionType}`;

        let policyResult;
        try {
            policyResult = isApprovalRequired({
                orgId: params.org_id,
                targetType: 'decision',
                actionType,
                isBulk: !!params.is_bulk,
                isAiOriginated: !!params.is_ai_originated,
                isDestructive: !!params.is_destructive,
            });
        } catch (evalErr) {
            return {
                status: 'ERROR',
                error: `governance_evaluation_failed: ${evalErr.message}`,
            };
        }

        if (!policyResult.required) {
            return { status: 'PASS_THROUGH' };
        }

        const result = createApprovalRequest(db, {
            org_id: params.org_id,
            target_type: 'decision',
            target_id: String(params.decision_id),
            action_key: actionKey,
            approval_mode: policyResult.mode,
            risk_level: policyResult.risk,
            requested_by_user_id: params.actor_user_id,
            request_payload: params.payload || {},
            policy_snapshot: {
                mode: policyResult.mode,
                risk: policyResult.risk,
                reason: policyResult.reason,
                source: policyResult.source,
            },
            escalation_reason: policyResult.reason,
        });

        if (!result.success) {
            return { status: 'ERROR', error: `approval_creation_failed: ${result.error}` };
        }

        return {
            status: 'PENDING_APPROVAL',
            approval_request_id: result.approval_request_id,
        };
    } catch (err) {
        return { status: 'ERROR', error: `bridge_error: ${err.message}` };
    }
}

module.exports = { interceptDecisionAction, INTERCEPTED_ACTIONS };
