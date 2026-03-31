// ============================================================
// Day 22: Approval Policy Registry (v3 — final corrections)
//
// v2 CORRECTIONS:
//  - Removed unsafe 'uncovered_default'. Unknown mutating
//    actions fail closed (SINGLE / MEDIUM).
//  - Added SAFE_ACTIONS allowlist for read-only verbs.
//
// v3 CORRECTIONS:
//  - Item 1: Missing actionKey now fails closed (SINGLE/HIGH)
//    instead of returning NONE/LOW.
//  - Item 2: Removed 'export', 'preview', 'validate' from
//    SAFE_ACTIONS — not provably side-effect-free.
//  - Item 3: Renamed isCoveredAction → isKnownCoveredAction.
//    Added isApprovalSensitive() reflecting actual fail-closed
//    behavior for unknown non-safe actions.
//
// Pattern: mirrors workflow-action-registry
// ============================================================

'use strict';

const APPROVAL_MODES = Object.freeze({
    NONE: 'NONE',
    SINGLE: 'SINGLE',
    DUAL: 'DUAL',
});

const RISK_LEVELS = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
});

// Action classification sets
const DESTRUCTIVE_ACTIONS = new Set([
    'delete', 'force_approve', 'force_reject', 'purge',
    'override', 'rollback', 'force_close',
]);

const BULK_ACTIONS = new Set([
    'bulk_operation', 'bulk_approve', 'bulk_reject',
    'bulk_reprocess', 'bulk_delete', 'bulk_resolve', 'bulk_dismiss',
]);

const AI_ORIGINATED_ACTIONS = new Set([
    'ai_reprocess', 'ai_quarantine_release', 'ai_auto_resolve',
    'risky_reprocess',
]);

const COVERED_ACTIONS = new Set([
    ...DESTRUCTIVE_ACTIONS, ...BULK_ACTIONS, ...AI_ORIGINATED_ACTIONS,
]);

// Explicit safe allowlist — ONLY provably side-effect-free,
// non-sensitive read-only verbs. Nothing that generates files,
// triggers computation, or touches external systems.
//
// Removed: 'export' (file generation, data extraction),
//          'preview' (rendering, resource allocation),
//          'validate' (may trigger external calls, mutation)
const SAFE_ACTIONS = new Set([
    'list', 'get', 'read', 'view', 'search', 'count',
    'check', 'ping', 'health',
]);

// Default policy table
const DEFAULT_POLICIES = Object.freeze({
    'workflow:execute':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'workflow:bulk_operation':  { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM },
    'workflow:delete':          { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },

    'decision:resolve':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'decision:dismiss':         { mode: APPROVAL_MODES.NONE,   risk: RISK_LEVELS.LOW },
    'decision:bulk_resolve':    { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM },
    'decision:bulk_dismiss':    { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM },
    'decision:override':        { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },

    'quarantine:force_approve':         { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },
    'quarantine:risky_reprocess':       { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH },
    'quarantine:bulk_operation':        { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
    'quarantine:ai_reprocess':          { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM },
    'quarantine:ai_quarantine_release': { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM },
    'quarantine:purge':                 { mode: APPROVAL_MODES.DUAL,   risk: RISK_LEVELS.HIGH },
});

let _orgPolicies = {};

// ------------------------------------------------------------
// Core
// ------------------------------------------------------------

function getApprovalPolicy(orgId, actionKey) {
    if (!actionKey) {
        // FAIL CLOSED: missing action key is not a safe condition
        return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH, source: 'missing_action_key_fail_closed' };
    }
    if (orgId) {
        const orgKey = `${orgId}:${actionKey}`;
        if (_orgPolicies[orgKey]) return { ..._orgPolicies[orgKey], source: 'org_override' };
    }
    if (DEFAULT_POLICIES[actionKey]) return { ...DEFAULT_POLICIES[actionKey], source: 'default_policy' };
    return _resolveByCategory(actionKey);
}

function isApprovalRequired(input) {
    if (!input || !input.targetType || !input.actionType) {
        return {
            required: true, mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH,
            reason: 'missing_input_fail_closed', source: 'fail_closed',
        };
    }

    const { orgId, targetType, actionType, isBulk, isAiOriginated, isDestructive } = input;
    const actionKey = `${targetType}:${actionType}`;
    const policy = getApprovalPolicy(orgId || '__default__', actionKey);

    if (policy.mode === APPROVAL_MODES.NONE) {
        if (isBulk || BULK_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM,
                reason: 'bulk_action_escalation', source: 'category_override' };
        }
        if (isDestructive || DESTRUCTIVE_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH,
                reason: 'destructive_action_escalation', source: 'category_override' };
        }
        if (isAiOriginated || AI_ORIGINATED_ACTIONS.has(actionType)) {
            return { required: true, mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM,
                reason: 'ai_originated_escalation', source: 'category_override' };
        }
        return { required: false, mode: APPROVAL_MODES.NONE, risk: policy.risk,
            reason: 'policy_allows', source: policy.source };
    }

    return { required: true, mode: policy.mode, risk: policy.risk,
        reason: 'policy_requires', source: policy.source };
}

// FAIL CLOSED for unknown mutating; only SAFE_ACTIONS pass.
function _resolveByCategory(actionKey) {
    const parts = actionKey.split(':');
    const actionType = parts.length > 1 ? parts[1] : actionKey;

    if (DESTRUCTIVE_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.HIGH, source: 'fail_closed_destructive' };
    if (BULK_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM, source: 'fail_closed_bulk' };
    if (AI_ORIGINATED_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM, source: 'fail_closed_ai' };
    if (SAFE_ACTIONS.has(actionType))
        return { mode: APPROVAL_MODES.NONE, risk: RISK_LEVELS.LOW, source: 'safe_allowlist' };

    // FAIL CLOSED: unknown action, not safe, not in any policy
    return { mode: APPROVAL_MODES.SINGLE, risk: RISK_LEVELS.MEDIUM, source: 'unknown_action_fail_closed' };
}

// Org policy management
function loadOrgPolicies(policies) {
    _orgPolicies = {};
    if (!Array.isArray(policies)) return;
    for (const p of policies) {
        if (p.org_id && p.action_key && p.approval_mode) {
            _orgPolicies[`${p.org_id}:${p.action_key}`] = {
                mode: p.approval_mode, risk: p.risk_level || RISK_LEVELS.LOW,
            };
        }
    }
}
function clearOrgPolicies() { _orgPolicies = {}; }
function loadOrgPoliciesFromDb(db, orgId) {
    if (!db || !orgId) return;
    try {
        const rows = db.prepare(
            `SELECT org_id, action_key, approval_mode, risk_level
             FROM approval_policies WHERE org_id = ? AND is_active = 1`
        ).all(orgId);
        if (Array.isArray(rows)) {
            for (const p of rows)
                _orgPolicies[`${p.org_id}:${p.action_key}`] = { mode: p.approval_mode, risk: p.risk_level || RISK_LEVELS.LOW };
        }
    } catch (err) { console.error(`[approval-policy-registry] load failed: ${err.message}`); }
}

function getRegisteredPolicies() { return { ...DEFAULT_POLICIES }; }
function getLoadedOrgPolicies() { return { ..._orgPolicies }; }

// Returns true only for actions in the known covered category sets
// (destructive, bulk, AI-originated). Does NOT reflect unknown-action
// fail-closed behavior. Use isApprovalSensitive() for that.
function isKnownCoveredAction(actionType) { return COVERED_ACTIONS.has(actionType); }

// Returns true if an action should be treated as approval-sensitive
// under fail-closed rules: any action that is NOT in SAFE_ACTIONS
// and NOT explicitly NONE in DEFAULT_POLICIES will require approval.
function isApprovalSensitive(actionType) {
    if (SAFE_ACTIONS.has(actionType)) return false;
    if (COVERED_ACTIONS.has(actionType)) return true;
    // Unknown action — fails closed, so yes, approval-sensitive
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
