'use strict';

const APPROVAL_MODES = Object.freeze({ NONE: 'NONE', SINGLE: 'SINGLE', DUAL: 'DUAL' });
const RISK_LEVELS = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

const DESTRUCTIVE_ACTIONS = new Set([
    'delete', 'force_approve', 'force_reject', 'purge',
    'override', 'rollback', 'force_close',
]);
const BULK_ACTIONS = new Set([
    'bulk_operation', 'bulk_approve', 'bulk_reject',
    'bulk_reprocess', 'bulk_delete', 'bulk_resolve', 'bulk_dismiss',
]);
const AI_ORIGINATED_ACTIONS = new Set([
    'ai_reprocess', 'ai_quarantine_release', 'ai_auto_resolve', 'risky_reprocess',
]);
const COVERED_ACTIONS = new Set([...DESTRUCTIVE_ACTIONS, ...BULK_ACTIONS, ...AI_ORIGINATED_ACTIONS]);
const SAFE_ACTIONS = new Set(['list', 'get', 'read', 'view', 'search', 'count', 'check', 'ping', 'health']);

const DEFAULT_POLICIES = Object.freeze({
    'workflow:execute':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'workflow:bulk_operation':  { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'workflow:delete':          { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'decision:resolve':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'decision:dismiss':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'decision:bulk_resolve':    { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'decision:bulk_dismiss':    { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'decision:override':        { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },
    'quarantine:force_approve':         { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },
    'quarantine:risky_reprocess':       { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },
    'quarantine:bulk_operation':        { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'quarantine:ai_reprocess':          { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'quarantine:ai_quarantine_release': { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'quarantine:purge':                 { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
});

let _orgPolicies = {};

function getApprovalPolicy(orgId, actionKey) {
    if (!actionKey) return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH, source: 'missing_action_key_fail_closed' };
    if (orgId) {
        const orgKey = orgId + ':' + actionKey;
        if (_orgPolicies[orgKey]) return { ..._orgPolicies[orgKey], source: 'org_override' };
    }
    if (DEFAULT_POLICIES[actionKey]) return { ...DEFAULT_POLICIES[actionKey], source: 'default_policy' };
    return _resolveByCategory(actionKey);
}

function isApprovalRequired(input) {
    if (!input || !input.targetType || !input.actionType) {
        return { required: true, mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH,
            reason: 'missing_input_fail_closed', source: 'fail_closed' };
    }
    const { orgId, targetType, actionType, isBulk, isAiOriginated, isDestructive } = input;
    const actionKey = targetType + ':' + actionType;
    const policy = getApprovalPolicy(orgId || '__default__', actionKey);

    if (policy.mode === APPROVAL_MODES.NONE) {
        // Escalation: destructive/bulk/AI always escalate to DUAL
        if (isDestructive || DESTRUCTIVE_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH,
                reason: 'destructive_action_escalation', source: 'category_override' };
        }
        if (isBulk || BULK_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH,
                reason: 'bulk_action_escalation', source: 'category_override' };
        }
        if (isAiOriginated || AI_ORIGINATED_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH,
                reason: 'ai_originated_escalation', source: 'category_override' };
        }
        return { required: false, mode: APPROVAL_MODES.NONE, risk: policy.risk,
            reason: 'policy_allows', source: policy.source };
    }
    return { required: true, mode: policy.mode, risk: policy.risk,
        reason: 'policy_requires', source: policy.source };
}

function _resolveByCategory(actionKey) {
    const parts = actionKey.split(':');
    const actionType = parts.length > 1 ? parts[1] : actionKey;
    if (DESTRUCTIVE_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH, source: 'fail_closed_destructive' };
    if (BULK_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH, source: 'fail_closed_bulk' };
    if (AI_ORIGINATED_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.DUAL, risk: RISK_LEVELS.HIGH, source: 'fail_closed_ai' };
    if (SAFE_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.NONE, risk: RISK_LEVELS.LOW, source: 'safe_allowlist' };
    return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM, source: 'unknown_action_fail_closed' };
}

function loadOrgPolicies(policies) {
    _orgPolicies = {};
    if (!Array.isArray(policies)) return;
    for (const p of policies) {
        if (p.org_id && p.action_key && p.approval_mode) {
            _orgPolicies[p.org_id + ':' + p.action_key] = { mode: p.approval_mode, risk: p.risk_level || RISK_LEVELS.LOW };
        }
    }
}
function clearOrgPolicies() { _orgPolicies = {}; }
function loadOrgPoliciesFromDb(db, orgId) {
    if (!db || !orgId) return;
    try {
        const rows = db.prepare('SELECT org_id, action_key, approval_mode, risk_level FROM approval_policies WHERE org_id = ? AND is_active = 1').all(orgId);
        if (Array.isArray(rows)) {
            for (const p of rows) _orgPolicies[p.org_id + ':' + p.action_key] = { mode: p.approval_mode, risk: p.risk_level || RISK_LEVELS.LOW };
        }
    } catch (err) { console.error('[approval-policy-registry] load failed: ' + err.message); }
}
function getRegisteredPolicies() { return { ...DEFAULT_POLICIES }; }
function getLoadedOrgPolicies() { return { ..._orgPolicies }; }
function isKnownCoveredAction(actionType) { return COVERED_ACTIONS.has(actionType); }
function isApprovalSensitive(actionType) {
    if (SAFE_ACTIONS.has(actionType)) return false;
    if (COVERED_ACTIONS.has(actionType)) return true;
    return true;
}
function isSafeAction(actionType) { return SAFE_ACTIONS.has(actionType); }

module.exports = {
    getApprovalPolicy, isApprovalRequired,
    isKnownCoveredAction, isApprovalSensitive, isSafeAction,
    loadOrgPolicies, loadOrgPoliciesFromDb, clearOrgPolicies,
    getRegisteredPolicies, getLoadedOrgPolicies,
    APPROVAL_MODES, RISK_LEVELS,
    DESTRUCTIVE_ACTIONS, BULK_ACTIONS, AI_ORIGINATED_ACTIONS,
    COVERED_ACTIONS, SAFE_ACTIONS,
};
