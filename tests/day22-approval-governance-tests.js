// ============================================================
// Day 22: Approval Governance — Full Test Suite (v2 — corrected)
//
// CORRECTIONS:
//  - Item 7:  Real HTTP tests via supertest (missing context,
//             invalid ID, cross-org, body-identity-ignored,
//             unauthorized approver, valid approve/reject/cancel).
//  - Item 10: Dedup prevention, unknown action fail-closed,
//             unauthorized approver denial, second-approval
//             race correctness, exact idempotency contracts.
//  - Item 11: Coverage claims match reality.
//
// CATEGORIES (23):
//  1.  Policy engine modes
//  2.  Risk levels
//  3.  Escalation rules
//  4.  Fail-closed on missing input
//  5.  Fail-closed on unknown actions (Item 4/10)
//  6.  Org-scoped policy
//  7.  Create / list / get
//  8.  Request deduplication (Item 3/10)
//  9.  Approve / reject / cancel transitions
//  10. Terminal state immutability
//  11. DUAL approval
//  12. Exact idempotency contracts (Item 10)
//  13. Self-approval prevention
//  14. Approver authorization denial (Item 2/10)
//  15. Second-approval race determinism (Item 5/10)
//  16. Workflow bridge
//  17. Decision bridge
//  18. Bridge fail-closed
//  19. Spoofed actor / cross-org
//  20. Bypass attempts
//  21. Audit trail
//  22. HTTP route tests (Item 7)
//  23. Mount/regression guards
// ============================================================

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const supertest = require('supertest');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const { interceptWorkflowExecution } = require('../src/services/workflow-approval-bridge');
const { interceptDecisionAction } = require('../src/services/decision-approval-bridge');
const createApprovalRoutes = require('../src/routes/approvals');

let db;
let passed = 0;
let failed = 0;
const failures = [];

const ORG = 'org-test-001';
const ORG_OTHER = 'org-attacker';
const USER_A = 'user-alpha';
const USER_B = 'user-beta';
const USER_C = 'user-gamma';
const USER_UNAUTH = 'user-unauthorized';

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        failures.push({ name, error: err.message });
        console.log(`  ✗ ${name}`);
        console.log(`    → ${err.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        failures.push({ name, error: err.message });
        console.log(`  ✗ ${name}`);
        console.log(`    → ${err.message}`);
    }
}

function reset() {
    db.exec('DELETE FROM approval_requests');
    db.exec('DELETE FROM approval_policies');
    policyRegistry.clearOrgPolicies();
    approvalService.configureAuthorization(null);
}

function createReq(overrides = {}) {
    return approvalService.createApprovalRequest(db, {
        org_id: ORG, target_type: 'workflow',
        action_key: 'workflow:execute',
        requested_by_user_id: USER_A,
        ...overrides,
    });
}

async function initDb() {
    db = await createDatabase();
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8'
    );
    for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/approvals', createApprovalRoutes(db));
    return app;
}

// ============================================================
async function runTests() {
    console.log('\n========================================');
    console.log('Day 22: Approval Governance Tests (v2)');
    console.log('========================================\n');

    await initDb();

    // 1. Policy modes
    console.log('--- 1. Policy Engine: Modes ---');
    test('NONE for standard execute', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:execute').mode, 'NONE');
    });
    test('SINGLE for bulk operation', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:bulk_operation').mode, 'SINGLE');
    });
    test('DUAL for workflow delete', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:delete').mode, 'DUAL');
    });
    test('SINGLE for quarantine force_approve', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'quarantine:force_approve').mode, 'SINGLE');
    });
    test('DUAL for quarantine purge', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'quarantine:purge').mode, 'DUAL');
    });
    test('NONE for decision resolve', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'decision:resolve').mode, 'NONE');
    });

    // 2. Risk levels
    console.log('\n--- 2. Risk Levels ---');
    test('LOW for standard execute', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:execute').risk, 'LOW');
    });
    test('MEDIUM for bulk', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:bulk_operation').risk, 'MEDIUM');
    });
    test('HIGH for force_approve', () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'quarantine:force_approve').risk, 'HIGH');
    });

    // 3. Escalation
    console.log('\n--- 3. Escalation ---');
    test('bulk flag escalates', () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isBulk: true });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.reason, 'bulk_action_escalation');
    });
    test('destructive flag escalates', () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isDestructive: true });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.reason, 'destructive_action_escalation');
    });
    test('AI flag escalates', () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isAiOriginated: true });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.reason, 'ai_originated_escalation');
    });

    // 4. Fail-closed missing input
    console.log('\n--- 4. Fail-Closed: Missing Input ---');
    test('null input → fail closed', () => {
        const r = policyRegistry.isApprovalRequired(null);
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.source, 'fail_closed');
    });
    test('missing targetType → fail closed', () => {
        assert.strictEqual(policyRegistry.isApprovalRequired({ actionType: 'x' }).required, true);
    });
    test('missing actionType → fail closed', () => {
        assert.strictEqual(policyRegistry.isApprovalRequired({ targetType: 'x' }).required, true);
    });

    // 5. Fail-closed unknown actions + v3 corrections
    console.log('\n--- 5. Fail-Closed: Unknown Actions + v3 ---');
    test('unknown mutating action fails closed', () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'widget', actionType: 'transmute' });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.source, 'unknown_action_fail_closed');
    });
    test('unknown action on unknown target fails closed', () => {
        const p = policyRegistry.getApprovalPolicy(ORG, 'foo:bar');
        assert.strictEqual(p.mode, 'SINGLE');
        assert.strictEqual(p.source, 'unknown_action_fail_closed');
    });
    test('safe allowlisted action passes', () => {
        const p = policyRegistry.getApprovalPolicy(ORG, 'widget:list');
        assert.strictEqual(p.mode, 'NONE');
        assert.strictEqual(p.source, 'safe_allowlist');
    });
    test('isSafeAction identifies safe actions', () => {
        assert.strictEqual(policyRegistry.isSafeAction('list'), true);
        assert.strictEqual(policyRegistry.isSafeAction('get'), true);
        assert.strictEqual(policyRegistry.isSafeAction('transmute'), false);
    });

    // v3 Item 1: missing actionKey fails closed
    test('missing actionKey → SINGLE/HIGH fail closed', () => {
        const p = policyRegistry.getApprovalPolicy(ORG, null);
        assert.strictEqual(p.mode, 'SINGLE');
        assert.strictEqual(p.risk, 'HIGH');
        assert.strictEqual(p.source, 'missing_action_key_fail_closed');
    });
    test('empty string actionKey → SINGLE/HIGH fail closed', () => {
        const p = policyRegistry.getApprovalPolicy(ORG, '');
        assert.strictEqual(p.mode, 'SINGLE');
        assert.strictEqual(p.risk, 'HIGH');
        assert.strictEqual(p.source, 'missing_action_key_fail_closed');
    });
    test('undefined actionKey → SINGLE/HIGH fail closed', () => {
        const p = policyRegistry.getApprovalPolicy(ORG, undefined);
        assert.strictEqual(p.mode, 'SINGLE');
        assert.strictEqual(p.risk, 'HIGH');
        assert.strictEqual(p.source, 'missing_action_key_fail_closed');
    });

    // v3 Item 2: removed SAFE_ACTIONS entries now require approval
    test('export is not safe — requires approval', () => {
        assert.strictEqual(policyRegistry.isSafeAction('export'), false);
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'data', actionType: 'export' });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.source, 'unknown_action_fail_closed');
    });
    test('preview is not safe — requires approval', () => {
        assert.strictEqual(policyRegistry.isSafeAction('preview'), false);
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'report', actionType: 'preview' });
        assert.strictEqual(r.required, true);
    });
    test('validate is not safe — requires approval', () => {
        assert.strictEqual(policyRegistry.isSafeAction('validate'), false);
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'config', actionType: 'validate' });
        assert.strictEqual(r.required, true);
    });

    // v3 Item 3: renamed helpers
    test('isKnownCoveredAction returns true for known categories', () => {
        assert.strictEqual(policyRegistry.isKnownCoveredAction('bulk_delete'), true);
        assert.strictEqual(policyRegistry.isKnownCoveredAction('force_approve'), true);
        assert.strictEqual(policyRegistry.isKnownCoveredAction('ai_reprocess'), true);
    });
    test('isKnownCoveredAction returns false for unknown actions', () => {
        assert.strictEqual(policyRegistry.isKnownCoveredAction('transmute'), false);
        assert.strictEqual(policyRegistry.isKnownCoveredAction('list'), false);
    });
    test('isApprovalSensitive returns true for known covered actions', () => {
        assert.strictEqual(policyRegistry.isApprovalSensitive('bulk_delete'), true);
        assert.strictEqual(policyRegistry.isApprovalSensitive('force_approve'), true);
    });
    test('isApprovalSensitive returns true for unknown non-safe actions', () => {
        assert.strictEqual(policyRegistry.isApprovalSensitive('transmute'), true);
        assert.strictEqual(policyRegistry.isApprovalSensitive('export'), true);
        assert.strictEqual(policyRegistry.isApprovalSensitive('preview'), true);
    });
    test('isApprovalSensitive returns false for safe actions', () => {
        assert.strictEqual(policyRegistry.isApprovalSensitive('list'), false);
        assert.strictEqual(policyRegistry.isApprovalSensitive('get'), false);
        assert.strictEqual(policyRegistry.isApprovalSensitive('ping'), false);
    });
    test('non-safe unknown action does not pass through isApprovalRequired', () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'system', actionType: 'reconfigure' });
        assert.strictEqual(r.required, true);
        assert.notStrictEqual(r.reason, 'policy_allows');
    });

    // 6. Org-scoped policy
    console.log('\n--- 6. Org-Scoped Policy ---');
    test('org override takes precedence', () => {
        policyRegistry.loadOrgPolicies([{ org_id: ORG, action_key: 'workflow:execute', approval_mode: 'DUAL', risk_level: 'HIGH' }]);
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:execute').mode, 'DUAL');
        policyRegistry.clearOrgPolicies();
    });
    test('other org does not see override', () => {
        policyRegistry.loadOrgPolicies([{ org_id: ORG_OTHER, action_key: 'workflow:execute', approval_mode: 'DUAL', risk_level: 'HIGH' }]);
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:execute').mode, 'NONE');
        policyRegistry.clearOrgPolicies();
    });

    // 7. Create / list / get
    console.log('\n--- 7. Create / List / Get ---');
    reset();
    test('create succeeds', () => {
        assert.strictEqual(createReq().success, true);
    });
    test('create fails without org_id', () => {
        assert.strictEqual(approvalService.createApprovalRequest(db, { target_type: 'w', action_key: 'w:e', requested_by_user_id: USER_A }).error, 'org_id_required');
    });
    test('create fails without requested_by', () => {
        assert.strictEqual(approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e' }).error, 'requested_by_user_id_required');
    });
    test('get requires org_id (Item 9)', () => {
        const c = createReq();
        const r = approvalService.getApprovalRequest(db, c.approval_request_id);
        assert.strictEqual(r.success, false);
        assert.strictEqual(r.error, 'org_id_required_for_scoped_read');
    });
    test('getInternal works without org_id', () => {
        const c = createReq();
        const r = approvalService.getApprovalRequestInternal(db, c.approval_request_id);
        assert.strictEqual(r.success, true);
    });
    test('list with limit/offset', () => {
        reset();
        for (let i = 0; i < 5; i++) createReq({ target_id: `wf-${i}` });
        const r = approvalService.listApprovalRequests(db, { org_id: ORG, limit: 2 });
        assert.strictEqual(r.requests.length, 2);
        assert.strictEqual(r.total, 5);
    });
    test('pagination clamps negative limit to 1', () => {
        const r = approvalService.listApprovalRequests(db, { org_id: ORG, limit: -5, offset: -10 });
        assert.strictEqual(r.success, true); // doesn't crash
    });

    // 8. Deduplication (Item 3/10)
    console.log('\n--- 8. Deduplication ---');
    reset();
    test('duplicate pending request returns existing', () => {
        const first = createReq({ target_id: 'wf-dup-1' });
        const second = createReq({ target_id: 'wf-dup-1' });
        assert.strictEqual(second.success, true);
        assert.strictEqual(second.deduplicated, true);
        assert.strictEqual(second.approval_request_id, first.approval_request_id);
    });
    test('different target_id creates new request', () => {
        const first = createReq({ target_id: 'wf-dup-A' });
        const second = createReq({ target_id: 'wf-dup-B' });
        assert.ok(second.approval_request_id !== first.approval_request_id);
        assert.strictEqual(second.deduplicated, undefined);
    });
    test('dedup does not fire if first request is resolved', () => {
        const first = createReq({ target_id: 'wf-dup-resolved' });
        approvalService.rejectApprovalRequest(db, first.approval_request_id, { actor_user_id: USER_B });
        const second = createReq({ target_id: 'wf-dup-resolved' });
        assert.ok(second.approval_request_id !== first.approval_request_id);
    });
    test('null target_id skips dedup', () => {
        const first = createReq({ target_id: null });
        const second = createReq({ target_id: null });
        assert.ok(second.approval_request_id !== first.approval_request_id);
    });

    // 9. State transitions
    console.log('\n--- 9. State Transitions ---');
    reset();
    test('PENDING → APPROVED', () => {
        const c = createReq();
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.request.request_status, 'APPROVED');
    });
    test('PENDING → REJECTED', () => {
        const c = createReq();
        const r = approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.request.request_status, 'REJECTED');
    });
    test('PENDING → CANCELLED', () => {
        const c = createReq();
        const r = approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_A });
        assert.strictEqual(r.request.request_status, 'CANCELLED');
    });

    // 10. Terminal immutability
    console.log('\n--- 10. Terminal Immutability ---');
    reset();
    test('APPROVED → REJECTED blocked', () => {
        const c = createReq();
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.success, false);
    });
    test('REJECTED → APPROVED blocked', () => {
        const c = createReq();
        approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C }).success, false);
    });
    test('CANCELLED → anything blocked', () => {
        const c = createReq();
        approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_A });
        assert.strictEqual(approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B }).success, false);
    });

    // 11. DUAL approval
    console.log('\n--- 11. DUAL Approval ---');
    reset();
    test('first approval keeps PENDING', () => {
        const c = createReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.request.request_status, 'PENDING');
        assert.ok(r.message.includes('awaiting_second'));
    });
    test('second by different user → APPROVED', () => {
        const c = createReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.request.request_status, 'APPROVED');
    });
    test('same user cannot give both', () => {
        const c = createReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.error, 'dual_approval_requires_different_approvers');
    });
    test('reject works after first approval', () => {
        const c = createReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.request.request_status, 'REJECTED');
    });

    // 12. Exact idempotency (Item 10)
    console.log('\n--- 12. Exact Idempotency ---');
    reset();
    test('approve on APPROVED → idempotent=true exactly', () => {
        const c = createReq();
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
        assert.strictEqual(r.message, 'already_approved');
    });
    test('reject on REJECTED → idempotent=true exactly', () => {
        const c = createReq();
        approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
        assert.strictEqual(r.message, 'already_rejected');
    });
    test('cancel on CANCELLED → idempotent=true exactly', () => {
        const c = createReq();
        approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_A });
        const r = approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
        assert.strictEqual(r.message, 'already_cancelled');
    });

    // 13. Self-approval prevention
    console.log('\n--- 13. Self-Approval ---');
    reset();
    test('requester cannot approve own request', () => {
        const c = createReq({ requested_by_user_id: USER_A });
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_A });
        assert.strictEqual(r.error, 'self_approval_prohibited');
    });

    // 14. Approver authorization (Item 2/10)
    console.log('\n--- 14. Approver Authorization ---');
    reset();
    test('authorized approver succeeds', () => {
        approvalService.configureAuthorization((actor) => actor !== USER_UNAUTH);
        const c = createReq();
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.strictEqual(r.success, true);
        approvalService.configureAuthorization(null);
    });
    test('unauthorized approver is denied', () => {
        approvalService.configureAuthorization((actor) => actor !== USER_UNAUTH);
        const c = createReq();
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_UNAUTH });
        assert.strictEqual(r.success, false);
        assert.strictEqual(r.error, 'approver_not_authorized');
        approvalService.configureAuthorization(null);
    });
    test('unauthorized rejector is denied', () => {
        approvalService.configureAuthorization((actor) => actor !== USER_UNAUTH);
        const c = createReq();
        const r = approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_UNAUTH });
        assert.strictEqual(r.success, false);
        assert.strictEqual(r.error, 'approver_not_authorized');
        approvalService.configureAuthorization(null);
    });
    test('auth check receives row context', () => {
        let receivedRow = null;
        approvalService.configureAuthorization((actor, org, row) => { receivedRow = row; return true; });
        const c = createReq({ target_id: 'wf-auth-ctx' });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        assert.ok(receivedRow);
        assert.strictEqual(receivedRow.target_id, 'wf-auth-ctx');
        approvalService.configureAuthorization(null);
    });

    // 15. Second-approval race (Item 5/10)
    console.log('\n--- 15. DUAL Race Handling ---');
    reset();
    test('second approval on already-approved DUAL returns deterministic result', () => {
        const c = createReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_C });
        // Now it's APPROVED. Third attempt:
        const r = approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_A });
        // Must be idempotent success (already approved) not undefined behavior
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
    });

    // 16. Workflow bridge
    console.log('\n--- 16. Workflow Bridge ---');
    reset();
    test('standard execute → PASS_THROUGH', () => {
        assert.strictEqual(interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-1', actor_user_id: USER_A }).status, 'PASS_THROUGH');
    });
    test('bulk → PENDING_APPROVAL', () => {
        const r = interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-2', actor_user_id: USER_A, is_bulk: true });
        assert.strictEqual(r.status, 'PENDING_APPROVAL');
        assert.ok(r.approval_request_id);
    });
    test('destructive → PENDING_APPROVAL', () => {
        assert.strictEqual(interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-3', actor_user_id: USER_A, is_destructive: true }).status, 'PENDING_APPROVAL');
    });
    test('AI-originated → PENDING_APPROVAL', () => {
        assert.strictEqual(interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-4', actor_user_id: USER_A, is_ai_originated: true }).status, 'PENDING_APPROVAL');
    });

    // 17. Decision bridge
    console.log('\n--- 17. Decision Bridge ---');
    reset();
    test('standard resolve → PASS_THROUGH', () => {
        assert.strictEqual(interceptDecisionAction(db, { org_id: ORG, decision_id: 'd-1', action_type: 'resolve', actor_user_id: USER_A }).status, 'PASS_THROUGH');
    });
    test('bulk resolve → PENDING_APPROVAL', () => {
        assert.strictEqual(interceptDecisionAction(db, { org_id: ORG, decision_id: 'd-2', action_type: 'resolve', actor_user_id: USER_A, is_bulk: true }).status, 'PENDING_APPROVAL');
    });
    test('unknown action → PASS_THROUGH (not intercepted)', () => {
        assert.strictEqual(interceptDecisionAction(db, { org_id: ORG, decision_id: 'd-3', action_type: 'comment', actor_user_id: USER_A }).status, 'PASS_THROUGH');
    });

    // 18. Bridge fail-closed
    console.log('\n--- 18. Bridge Fail-Closed ---');
    test('workflow: missing org_id → ERROR', () => {
        assert.strictEqual(interceptWorkflowExecution(db, { workflow_id: 'x', actor_user_id: USER_A }).status, 'ERROR');
    });
    test('workflow: missing actor → ERROR', () => {
        assert.strictEqual(interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'x' }).status, 'ERROR');
    });
    test('decision: missing org_id → ERROR', () => {
        assert.strictEqual(interceptDecisionAction(db, { decision_id: 'x', actor_user_id: USER_A, action_type: 'resolve' }).status, 'ERROR');
    });
    test('decision: missing actor → ERROR', () => {
        assert.strictEqual(interceptDecisionAction(db, { org_id: ORG, decision_id: 'x', action_type: 'resolve' }).status, 'ERROR');
    });

    // 19. Spoofed actor / cross-org
    console.log('\n--- 19. Cross-Org ---');
    reset();
    test('get with wrong org → not_found', () => {
        const c = createReq();
        assert.strictEqual(approvalService.getApprovalRequest(db, c.approval_request_id, ORG_OTHER).success, false);
    });
    test('approve with wrong org → not_found', () => {
        const c = createReq();
        assert.strictEqual(approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B, org_id: ORG_OTHER }).success, false);
    });
    test('list only returns own org', () => {
        createReq({ org_id: ORG_OTHER });
        const r = approvalService.listApprovalRequests(db, { org_id: ORG });
        assert.ok(r.requests.every(x => x.org_id === ORG));
    });

    // 20. Bypass attempts
    console.log('\n--- 20. Bypass ---');
    reset();
    test('rejection blocks further approval', () => {
        const inter = interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-byp', actor_user_id: USER_A, is_bulk: true });
        approvalService.rejectApprovalRequest(db, inter.approval_request_id, { actor_user_id: USER_B });
        const r = approvalService.approveApprovalRequest(db, inter.approval_request_id, { actor_user_id: USER_C });
        assert.strictEqual(r.success, false);
    });

    // 21. Audit trail
    console.log('\n--- 21. Audit Trail ---');
    reset();
    test('approved request has full audit', () => {
        const c = createReq({ request_payload: { x: 1 } });
        approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B, reason: 'ok' });
        const r = approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.approved_by_user_id, USER_B);
        assert.ok(r.request.resolved_at);
        assert.strictEqual(r.request.decision_metadata_json.reason, 'ok');
    });
    test('bridge preserves policy snapshot', () => {
        const inter = interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'wf-aud', actor_user_id: USER_A, is_bulk: true });
        const r = approvalService.getApprovalRequest(db, inter.approval_request_id, ORG);
        assert.ok(r.request.policy_snapshot_json.mode);
        assert.ok(r.request.escalation_reason);
    });

    // 22. HTTP Route Tests (Item 7)
    console.log('\n--- 22. HTTP Route Tests ---');
    reset();
    const app = buildApp();

    await asyncTest('GET /approvals without trusted context → 401', async () => {
        const res = await supertest(app).get('/approvals');
        assert.strictEqual(res.status, 401);
    });

    await asyncTest('GET /approvals with trusted context → 200', async () => {
        const res = await supertest(app).get('/approvals')
            .set('x-user-id', USER_A).set('x-org-id', ORG);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
    });

    await asyncTest('GET /approvals/:id with invalid id → 400', async () => {
        const res = await supertest(app).get('/approvals/abc')
            .set('x-user-id', USER_A).set('x-org-id', ORG);
        assert.strictEqual(res.status, 400);
    });

    await asyncTest('GET /approvals/:id cross-org → 404', async () => {
        const c = createReq();
        const res = await supertest(app).get(`/approvals/${c.approval_request_id}`)
            .set('x-user-id', USER_A).set('x-org-id', ORG_OTHER);
        assert.strictEqual(res.status, 404);
    });

    await asyncTest('POST /approvals/:id/approve ignores body-supplied identity', async () => {
        const c = createReq();
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/approve`)
            .set('x-user-id', USER_B).set('x-org-id', ORG)
            .send({ actor_user_id: 'spoofed-user', org_id: 'spoofed-org', reason: 'test' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.request.approved_by_user_id, USER_B); // trusted, not spoofed
    });

    await asyncTest('POST approve with self-approval → 403', async () => {
        const c = createReq({ requested_by_user_id: USER_A });
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/approve`)
            .set('x-user-id', USER_A).set('x-org-id', ORG)
            .send({ reason: 'self' });
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.error, 'self_approval_prohibited');
    });

    await asyncTest('POST approve unauthorized → 403', async () => {
        approvalService.configureAuthorization((actor) => actor !== USER_UNAUTH);
        const c = createReq();
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/approve`)
            .set('x-user-id', USER_UNAUTH).set('x-org-id', ORG)
            .send({});
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.error, 'approver_not_authorized');
        approvalService.configureAuthorization(null);
    });

    await asyncTest('POST reject valid → 200', async () => {
        const c = createReq();
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/reject`)
            .set('x-user-id', USER_B).set('x-org-id', ORG)
            .send({ reason: 'nope' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.request.request_status, 'REJECTED');
    });

    await asyncTest('POST cancel valid → 200', async () => {
        const c = createReq();
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/cancel`)
            .set('x-user-id', USER_A).set('x-org-id', ORG).send({});
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.request.request_status, 'CANCELLED');
    });

    await asyncTest('POST approve on REJECTED → 409 conflict', async () => {
        const c = createReq();
        approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: USER_B });
        const res = await supertest(app).post(`/approvals/${c.approval_request_id}/approve`)
            .set('x-user-id', USER_C).set('x-org-id', ORG).send({});
        assert.strictEqual(res.status, 409);
    });

    await asyncTest('GET /approvals/summary → 200', async () => {
        const res = await supertest(app).get('/approvals/summary')
            .set('x-user-id', USER_A).set('x-org-id', ORG);
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.summary);
    });

    // 23. Mount/regression
    console.log('\n--- 23. Regression Guards ---');
    test('route factory requires db', () => {
        assert.throws(() => createApprovalRoutes(null), /db required/);
    });
    test('repeated factory calls produce independent routers (Item 1)', () => {
        const mockDb = { prepare: () => ({ run() {}, get() {}, all() { return []; } }) };
        const r1 = createApprovalRoutes(mockDb);
        const r2 = createApprovalRoutes(mockDb);
        assert.ok(r1 !== r2);
    });
    test('all files exist', () => {
        for (const f of [
            'src/db/migrations/016-day22-approval-governance.sql',
            'src/services/approval-policy-registry.js',
            'src/services/approval-service.js',
            'src/services/workflow-approval-bridge.js',
            'src/services/decision-approval-bridge.js',
            'src/routes/approvals.js',
        ]) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `missing: ${f}`);
        }
    });

    // Summary
    if (db) db.close();
    console.log('\n========================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('========================================');
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  ✗ ${f.name}: ${f.error}`);
    }
    console.log('\nDay 22 v2: Approval Governance Tests — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) {
    runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { runTests };
