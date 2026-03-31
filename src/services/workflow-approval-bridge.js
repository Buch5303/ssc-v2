// ============================================================
// Day 22: Workflow-Approval Bridge
//
// Intercepts workflow execution. FAIL-CLOSED: if governance
// evaluation cannot complete, execution is blocked.
//
// Returns:
//   PASS_THROUGH      → safe to execute directly
//   PENDING_APPROVAL  → approval request created, block execution
//   ERROR             → governance failed, must not execute
// ============================================================

'use strict';

const { isApprovalRequired } = require('./approval-policy-registry');
const { createApprovalRequest } = require('./approval-service');

/**
 * Intercept a workflow execution request.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.org_id            - MUST come from trusted context
 * @param {string} params.workflow_id
 * @param {string} [params.action_type]     - default 'execute'
 * @param {string} params.actor_user_id     - MUST come from trusted context
 * @param {boolean} [params.is_bulk]
 * @param {boolean} [params.is_ai_originated]
 * @param {boolean} [params.is_destructive]
 * @param {object} [params.payload]         - original execution payload (preserved for replay)
 * @returns {{ status: string, approval_request_id?: number, error?: string }}
 */
function interceptWorkflowExecution(db, params = {}) {
    try {
        // Validate required trusted-context fields
        if (!params.org_id) {
            return { status: 'ERROR', error: 'org_id_required_from_trusted_context' };
        }
        if (!params.workflow_id) {
            return { status: 'ERROR', error: 'workflow_id_required' };
        }
        if (!params.actor_user_id) {
            return { status: 'ERROR', error: 'actor_user_id_required_from_trusted_context' };
        }

        const actionType = params.action_type || 'execute';
        const actionKey = `workflow:${actionType}`;

        // Evaluate governance policy
        let policyResult;
        try {
            policyResult = isApprovalRequired({
                orgId: params.org_id,
                targetType: 'workflow',
                actionType,
                isBulk: !!params.is_bulk,
                isAiOriginated: !!params.is_ai_originated,
                isDestructive: !!params.is_destructive,
            });
        } catch (evalErr) {
            // FAIL-CLOSED: governance evaluation failed
            return {
                status: 'ERROR',
                error: `governance_evaluation_failed: ${evalErr.message}`,
            };
        }

        // No approval required — pass through
        if (!policyResult.required) {
            return { status: 'PASS_THROUGH' };
        }

        // Approval required — create request with full metadata
        const result = createApprovalRequest(db, {
            org_id: params.org_id,
            target_type: 'workflow',
            target_id: String(params.workflow_id),
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
            // FAIL-CLOSED: cannot create approval request
            return { status: 'ERROR', error: `approval_creation_failed: ${result.error}` };
        }

        return {
            status: 'PENDING_APPROVAL',
            approval_request_id: result.approval_request_id,
        };
    } catch (err) {
        // FAIL-CLOSED: any uncaught error blocks execution
        return { status: 'ERROR', error: `bridge_error: ${err.message}` };
    }
}

module.exports = { interceptWorkflowExecution };
