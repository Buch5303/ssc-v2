'use strict';

const { isApprovalRequired, getApprovalPolicy, SAFE_ACTIONS } = require('./approval-policy-registry');
const { createApprovalRequest, getApprovalRequest } = require('./approval-service');
const logger = require('../common/logger');

const GATE_STATUS = Object.freeze({
    CLEAR: 'CLEAR',
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    DENIED: 'DENIED',
    ERROR: 'ERROR',
});

const WHITELISTED_NONE_ACTIONS = new Set([
    'workflow:execute',
    'decision:resolve',
    'decision:dismiss',
]);

let _governanceCalled = false;
let _auditRecorder = null;

function _resetGovernanceFlag() { _governanceCalled = false; }
function _wasGovernanceCalled() { return _governanceCalled; }
function setAuditRecorder(fn) { _auditRecorder = typeof fn === 'function' ? fn : null; }

function _recordAudit(event) {
    if (_auditRecorder) {
        try { _auditRecorder(event); } catch { /* audit failure must not block execution */ }
    }
}

async function enforceGovernance(db, params = {}) {
    _governanceCalled = true;
    const correlationId = params.correlation_id || null;

    try {
        if (!params.org_id) { _logAndAudit('ERROR', 'org_id_required', params, correlationId); return { status: GATE_STATUS.ERROR, error: 'org_id_required' }; }
        if (!params.actor_user_id) { _logAndAudit('ERROR', 'actor_user_id_required', params, correlationId); return { status: GATE_STATUS.ERROR, error: 'actor_user_id_required' }; }
        if (!params.target_type) { _logAndAudit('ERROR', 'target_type_required', params, correlationId); return { status: GATE_STATUS.ERROR, error: 'target_type_required' }; }
        if (!params.action_type) { _logAndAudit('ERROR', 'action_type_required', params, correlationId); return { status: GATE_STATUS.ERROR, error: 'action_type_required' }; }

        const actionKey = params.target_type + ':' + params.action_type;

        if (params.existing_approval_id) {
            const result = _verifyExistingApproval(db, params.existing_approval_id, params.org_id);
            logger.info('governance-gate', 'approval_verification', { org_id: params.org_id, user_id: params.actor_user_id, approval_id: params.existing_approval_id, status: result.status, correlation_id: correlationId });
            _recordAudit({ event_type: 'GOVERNANCE_' + result.status, org_id: params.org_id, actor_user_id: params.actor_user_id, target_type: params.target_type, target_id: params.target_id, action_key: actionKey, approval_id: params.existing_approval_id, outcome: result.status, detail: { correlation_id: correlationId } });
            return result;
        }

        let policyResult;
        try {
            policyResult = isApprovalRequired({ orgId: params.org_id, targetType: params.target_type, actionType: params.action_type, isBulk: !!params.is_bulk, isAiOriginated: !!params.is_ai_originated, isDestructive: !!params.is_destructive });
        } catch (err) {
            _logAndAudit('ERROR', 'governance_evaluation_failed: ' + err.message, params, correlationId);
            return { status: GATE_STATUS.ERROR, error: 'governance_evaluation_failed: ' + err.message };
        }

        if (!policyResult.required) {
            if (!WHITELISTED_NONE_ACTIONS.has(actionKey) && !SAFE_ACTIONS.has(params.action_type)) {
                logger.info('governance-gate', 'non_whitelisted_blocked', { org_id: params.org_id, user_id: params.actor_user_id, action_key: actionKey, correlation_id: correlationId });
                return await _createApprovalAndBlock(db, params, actionKey, { mode: 'SINGLE', risk: 'HIGH', reason: 'non_whitelisted_none_fail_closed', source: 'governance_gate' }, correlationId);
            }
            if (params.is_bulk || params.is_destructive || params.is_ai_originated) {
                return await _createApprovalAndBlock(db, params, actionKey, policyResult, correlationId);
            }
            logger.info('governance-gate', 'cleared', { org_id: params.org_id, user_id: params.actor_user_id, action_key: actionKey, correlation_id: correlationId });
            _recordAudit({ event_type: 'GOVERNANCE_CLEAR', org_id: params.org_id, actor_user_id: params.actor_user_id, target_type: params.target_type, target_id: params.target_id, action_key: actionKey, outcome: 'CLEAR', detail: { policy: policyResult, correlation_id: correlationId } });
            return { status: GATE_STATUS.CLEAR, policy: policyResult };
        }

        return await _createApprovalAndBlock(db, params, actionKey, policyResult, correlationId);
    } catch (err) {
        _logAndAudit('ERROR', 'gate_error: ' + err.message, params, correlationId);
        return { status: GATE_STATUS.ERROR, error: 'gate_error: ' + err.message };
    }
}

async function _verifyExistingApproval(db, approvalId, orgId) {
    const ar = await getApprovalRequest(db, approvalId, orgId);
    if (!ar.success) return { status: GATE_STATUS.ERROR, error: 'approval_lookup_failed: ' + ar.error };
    if (ar.request.request_status === 'APPROVED') return { status: GATE_STATUS.APPROVED, approval_request_id: approvalId };
    if (ar.request.request_status === 'PENDING') return { status: GATE_STATUS.PENDING, approval_request_id: approvalId };
    return { status: GATE_STATUS.DENIED, approval_request_id: approvalId, error: 'approval_' + ar.request.request_status.toLowerCase() };
}

async function _createApprovalAndBlock(db, params, actionKey, policyResult, correlationId) {
    const result = await createApprovalRequest(db, {
        org_id: params.org_id, target_type: params.target_type, target_id: String(params.target_id || ''),
        action_key: actionKey, approval_mode: policyResult.mode || 'SINGLE', risk_level: policyResult.risk || 'HIGH',
        requested_by_user_id: params.actor_user_id, request_payload: params.payload || {},
        policy_snapshot: { mode: policyResult.mode, risk: policyResult.risk, reason: policyResult.reason, source: policyResult.source },
        escalation_reason: policyResult.reason,
    });
    if (!result.success) {
        _logAndAudit('ERROR', 'approval_creation_failed: ' + result.error, params, correlationId);
        return { status: GATE_STATUS.ERROR, error: 'approval_creation_failed: ' + result.error };
    }
    logger.info('governance-gate', 'blocked_pending_approval', { org_id: params.org_id, user_id: params.actor_user_id, action_key: actionKey, approval_id: result.approval_request_id, mode: policyResult.mode, risk: policyResult.risk, correlation_id: correlationId });
    _recordAudit({ event_type: 'GOVERNANCE_PENDING', org_id: params.org_id, actor_user_id: params.actor_user_id, target_type: params.target_type, target_id: params.target_id, action_key: actionKey, approval_id: result.approval_request_id, outcome: 'PENDING', detail: { policy: policyResult, correlation_id: correlationId } });
    return { status: GATE_STATUS.PENDING, approval_request_id: result.approval_request_id };
}

function _logAndAudit(level, error, params, correlationId) {
    logger[level === 'ERROR' ? 'error' : 'warn']('governance-gate', error, { org_id: params.org_id, user_id: params.actor_user_id, correlation_id: correlationId });
    _recordAudit({ event_type: 'GOVERNANCE_ERROR', org_id: params.org_id || 'UNKNOWN', actor_user_id: params.actor_user_id || 'UNKNOWN', outcome: 'ERROR', detail: { error, correlation_id: correlationId } });
}

function assertGovernanceEnforced() {
    if (!_governanceCalled) throw new Error('GOVERNANCE_BYPASS_VIOLATION: execution occurred without governance enforcement');
}

module.exports = { enforceGovernance, assertGovernanceEnforced, _resetGovernanceFlag, _wasGovernanceCalled, setAuditRecorder, GATE_STATUS, WHITELISTED_NONE_ACTIONS };
