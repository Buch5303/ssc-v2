'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const { executeDecisionAction, ALL_DECISION_ACTIONS } = require('../src/services/decision-execution-service');
const { enforceGovernance, assertGovernanceEnforced, _resetGovernanceFlag, _wasGovernanceCalled, GATE_STATUS, WHITELISTED_NONE_ACTIONS } = require('../src/services/governance-gate');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d27';
const UA = 'ua-d27'; const UB = 'ub-d27'; const UC = 'uc-d27'; const UD = 'ud-d27';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function reset() {
    db.exec('DELETE FROM approval_requests');
    db.exec('DELETE FROM workflow_executions');
    policyRegistry.clearOrgPolicies();
    approvalService.configureAuthorization(null);
    executionService.configureExecutor(null);
}

async function dualApprove(id) {
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UB, org_id: ORG });
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UC, org_id: ORG });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 27: Enforcement Architecture Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    // Trigger migration: run as whole (triggers contain internal semicolons)
    const triggerSql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '018-day27-enforcement.sql'), 'utf-8');
    db._raw.exec(triggerSql);

    // ── 1. GOVERNANCE GATE AS SINGLE ENTRY POINT ───────────
    console.log('\n--- 1. Governance Gate ---');
    await reset();

    await test('gate returns CLEAR for whitelisted standard execute', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, GATE_STATUS.CLEAR);
    });
    await test('gate returns PENDING for bulk', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf2', action_type: 'execute', is_bulk: true });
        assert.strictEqual(r.status, GATE_STATUS.PENDING);
        assert.ok(r.approval_request_id);
    });
    await test('gate returns PENDING for destructive', async () => {
        const _r58 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf3', action_type: 'execute', is_destructive: true });
        assert.strictEqual(_r58.status, GATE_STATUS.PENDING);
    });
    await test('gate returns PENDING for AI-originated', async () => {
        const _r59 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf4', action_type: 'execute', is_ai_originated: true });
        assert.strictEqual(_r59.status, GATE_STATUS.PENDING);
    });
    await test('gate returns ERROR on missing org', async () => {
        const _r60 = await enforceGovernance(db, { actor_user_id: UA, target_type: 'workflow', action_type: 'execute' });
        assert.strictEqual(_r60.status, GATE_STATUS.ERROR);
    });
    await test('gate returns ERROR on missing actor', async () => {
        const _r61 = await enforceGovernance(db, { org_id: ORG, target_type: 'workflow', action_type: 'execute' });
        assert.strictEqual(_r61.status, GATE_STATUS.ERROR);
    });
    await test('gate returns ERROR on missing target_type', async () => {
        const _r62 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, action_type: 'execute' });
        assert.strictEqual(_r62.status, GATE_STATUS.ERROR);
    });
    await test('gate returns ERROR on missing action_type', async () => {
        const _r63 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow' });
        assert.strictEqual(_r63.status, GATE_STATUS.ERROR);
    });

    // ── 2. GOVERNANCE ASSERTION ────────────────────────────
    console.log('\n--- 2. Governance Assertion ---');

    await test('assertGovernanceEnforced passes after gate call', async () => {
        _resetGovernanceFlag();
        await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute' });
        assert.doesNotThrow(() => assertGovernanceEnforced());
    });
    await test('assertGovernanceEnforced throws without gate call', async () => {
        _resetGovernanceFlag();
        assert.throws(() => assertGovernanceEnforced(), /GOVERNANCE_BYPASS_VIOLATION/);
    });

    // ── 3. WORKFLOW EXECUTION USES GATE ────────────────────
    console.log('\n--- 3. Workflow Execution via Gate ---');
    await reset();

    await test('standard workflow executes through gate', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'ge1', actor_user_id: UA });
        assert.strictEqual(r.execution_status, 'EXECUTED');
    });
    await test('bulk workflow blocked through gate', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'ge2', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(r.execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('executor cannot run without governance clearance', async () => {
        let bypassAttempted = false;
        executionService.configureExecutor(() => { bypassAttempted = true; return { success: true }; });
        // Execute bulk — should block, NOT call executor
        await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'ge3', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(bypassAttempted, false);
        executionService.configureExecutor(null);
    });

    // ── 4. DECISION SERVICE FULL COVERAGE ──────────────────
    console.log('\n--- 4. Decision Service Coverage ---');
    await reset();

    await test('resolve → governance gate', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd1', actor_user_id: UA, action_type: 'resolve' });
        assert.strictEqual(r.action_status, 'EXECUTED');
    });
    await test('dismiss → governance gate', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd2', actor_user_id: UA, action_type: 'dismiss' });
        assert.strictEqual(r.action_status, 'EXECUTED');
    });
    await test('update → governance gate (non-whitelisted → blocked)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd3', actor_user_id: UA, action_type: 'update' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('delete → governance gate (blocked)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd4', actor_user_id: UA, action_type: 'delete' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('reassign → governance gate (blocked)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd5', actor_user_id: UA, action_type: 'reassign' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('comment → governance gate (blocked)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd6', actor_user_id: UA, action_type: 'comment' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('archive → governance gate (blocked)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd7', actor_user_id: UA, action_type: 'archive' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('unknown action rejected', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd8', actor_user_id: UA, action_type: 'teleport' });
        assert.strictEqual(r.success, false);
        assert.ok(r.error.includes('unknown_decision_action'));
    });
    await test('bulk resolve → blocked (DUAL required)', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd9', actor_user_id: UA, action_type: 'resolve', is_bulk: true });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('all 7 action types are covered', async () => {
        assert.strictEqual(ALL_DECISION_ACTIONS.size, 7);
        for (const a of ['resolve', 'dismiss', 'update', 'delete', 'reassign', 'comment', 'archive']) {
            assert.ok(ALL_DECISION_ACTIONS.has(a), 'missing: ' + a);
        }
    });

    // ── 5. PASS-THROUGH ELIMINATION ────────────────────────
    console.log('\n--- 5. No Pass-Through for Non-Whitelisted ---');
    await reset();

    await test('non-whitelisted action with NONE policy → blocked', async () => {
        // 'update' is not in WHITELISTED_NONE_ACTIONS and not in SAFE_ACTIONS
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'decision', target_id: 'x', action_type: 'update' });
        assert.strictEqual(r.status, GATE_STATUS.PENDING);
    });
    await test('whitelisted NONE actions are explicitly defined', async () => {
        assert.ok(WHITELISTED_NONE_ACTIONS.has('workflow:execute'));
        assert.ok(WHITELISTED_NONE_ACTIONS.has('decision:resolve'));
        assert.ok(WHITELISTED_NONE_ACTIONS.has('decision:dismiss'));
        assert.strictEqual(WHITELISTED_NONE_ACTIONS.size, 3);
    });
    await test('safe action (list/get) passes through gate', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'any', target_id: 'x', action_type: 'list' });
        assert.strictEqual(r.status, GATE_STATUS.CLEAR);
    });
    await test('escalation overrides whitelist', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute', is_bulk: true });
        assert.strictEqual(r.status, GATE_STATUS.PENDING);
    });

    // ── 6. DB TRIGGERS ─────────────────────────────────────
    console.log('\n--- 6. Database-Level Protection ---');
    await reset();

    await test('trigger blocks terminal → different terminal', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        // Try direct DB write to change APPROVED → REJECTED
        let error = null;
        try {
            db.prepare('UPDATE approval_requests SET request_status = ? WHERE id = ?').run('REJECTED', c.approval_request_id);
        } catch (e) { error = e.message; }
        assert.ok(error && error.includes('TRIGGER_VIOLATION'));
    });
    await test('trigger prevents direct CANCELLED override', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        let error = null;
        try {
            db.prepare('UPDATE approval_requests SET request_status = ? WHERE id = ?').run('APPROVED', c.approval_request_id);
        } catch (e) { error = e.message; }
        assert.ok(error && error.includes('TRIGGER_VIOLATION'));
    });

    // ── 7. APPROVAL VERIFICATION IN GATE ───────────────────
    console.log('\n--- 7. Approval Verification ---');
    await reset();

    await test('gate verifies APPROVED approval', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'replay', existing_approval_id: c.approval_request_id });
        assert.strictEqual(r.status, GATE_STATUS.APPROVED);
    });
    await test('gate rejects PENDING approval', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'replay', existing_approval_id: c.approval_request_id });
        assert.strictEqual(r.status, GATE_STATUS.PENDING);
    });
    await test('gate rejects REJECTED approval', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'replay', existing_approval_id: c.approval_request_id });
        assert.strictEqual(r.status, GATE_STATUS.DENIED);
    });
    await test('gate rejects nonexistent approval', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'replay', existing_approval_id: 999999 });
        assert.strictEqual(r.status, GATE_STATUS.ERROR);
    });

    // ── 8. BACKGROUND / ASYNC ENFORCEMENT ──────────────────
    console.log('\n--- 8. Background Job Enforcement ---');
    await reset();

    await test('simulated background job goes through gate', async () => {
        // Background job must call enforceGovernance, not bypass
        _resetGovernanceFlag();
        const gate = await enforceGovernance(db, { org_id: ORG, actor_user_id: 'system-worker', target_type: 'workflow', target_id: 'bg1', action_type: 'execute' });
        assert.strictEqual(_wasGovernanceCalled(), true);
        assert.strictEqual(gate.status, GATE_STATUS.CLEAR);
    });
    await test('bulk background job blocked', async () => {
        const gate = await enforceGovernance(db, { org_id: ORG, actor_user_id: 'system-worker', target_type: 'workflow', target_id: 'bg2', action_type: 'execute', is_bulk: true });
        assert.strictEqual(gate.status, GATE_STATUS.PENDING);
    });

    // ── 9. BYPASS ATTEMPTS ─────────────────────────────────
    console.log('\n--- 9. Bypass Attempt Tests ---');
    await reset();

    await test('execution without governance flag throws in assertion', async () => {
        _resetGovernanceFlag();
        assert.throws(() => assertGovernanceEnforced(), /GOVERNANCE_BYPASS/);
    });
    await test('replay without approved approval fails', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp1', actor_user_id: UA, is_bulk: true });
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UB });
        assert.strictEqual(r.success, false);
    });
    await test('cross-org governance fails', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: UA });
        const r = await enforceGovernance(db, { org_id: 'org-attacker', actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'replay', existing_approval_id: c.approval_request_id });
        assert.strictEqual(r.status, GATE_STATUS.ERROR);
    });

    // ── 10. FILES EXIST ────────────────────────────────────
    console.log('\n--- 10. File Guards ---');
    await test('governance-gate.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'governance-gate.js'))); });
    await test('decision-execution-service.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'decision-execution-service.js'))); });
    await test('migration 018 exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '018-day27-enforcement.sql'))); });

    // Cleanup
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 27 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
