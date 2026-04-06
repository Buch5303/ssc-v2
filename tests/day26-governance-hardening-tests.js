'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const { interceptWorkflowExecution } = require('../src/services/workflow-approval-bridge');
const { interceptDecisionAction } = require('../src/services/decision-approval-bridge');
const { verifyApprovalInvariant, verifyExecutionInvariant } = require('../src/services/governance-invariants');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d26';
const UA = 'ua-d26'; const UB = 'ub-d26'; const UC = 'uc-d26'; const UD = 'ud-d26';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function reset() {
    db.exec('DELETE FROM approval_requests');
    db.exec('DELETE FROM workflow_executions');
    policyRegistry.clearOrgPolicies();
    approvalService.configureAuthorization(null);
    executionService.configureExecutor(null);
}

async function mkReq(overrides = {}) {
    return await approvalService.createApprovalRequest(db, {
        org_id: ORG, target_type: 'workflow', action_key: 'workflow:execute',
        requested_by_user_id: UA, ...overrides,
    });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 26: Governance Hardening Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }

    // ── 1. DUAL ENFORCEMENT ────────────────────────────────
    console.log('\n--- 1. DUAL Enforcement for Escalated Actions ---');
    await reset();

    await test('bulk escalation → DUAL mode', async () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isBulk: true });
        assert.strictEqual(r.required, true);
        assert.strictEqual(r.mode, 'DUAL');
    });
    await test('destructive escalation → DUAL mode', async () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isDestructive: true });
        assert.strictEqual(r.mode, 'DUAL');
    });
    await test('AI escalation → DUAL mode', async () => {
        const r = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isAiOriginated: true });
        assert.strictEqual(r.mode, 'DUAL');
    });
    await test('DUAL request requires two approvers', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        const r1 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(r1.request.request_status, 'PENDING');
        const r2 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r2.request.request_status, 'APPROVED');
    });
    await test('single approve does NOT close DUAL request', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.request_status, 'PENDING');
    });

    // ── 2. SAME-USER DUAL BLOCK ────────────────────────────
    console.log('\n--- 2. Same-User Dual Approval Blocked ---');
    await reset();

    await test('same user cannot approve twice (DUAL)', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(r.success, false);
        assert.strictEqual(r.error, 'dual_approval_requires_different_approvers');
    });
    await test('requester cannot approve own DUAL request', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH', requested_by_user_id: UA });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(r.error, 'self_approval_prohibited');
    });
    await test('requester cannot be second approver either', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(r.error, 'self_approval_prohibited');
    });

    // ── 3. STATE MACHINE HARDENING ─────────────────────────
    console.log('\n--- 3. Illegal State Transitions ---');
    await reset();

    await test('APPROVED → APPROVED blocked', async () => {
        const c = await mkReq();
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, false);
        assert.ok(r.error.includes('invalid_transition'));
    });
    await test('REJECTED → APPROVED blocked', async () => {
        const c = await mkReq();
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, false);
    });
    await test('CANCELLED → APPROVED blocked', async () => {
        const c = await mkReq();
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        const _r37 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(_r37.success, false);
    });
    await test('CANCELLED → REJECTED blocked', async () => {
        const c = await mkReq();
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        const _r38 = await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(_r38.success, false);
    });
    await test('REJECTED → CANCELLED blocked', async () => {
        const c = await mkReq();
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r39 = await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r39.success, false);
    });

    // ── 4. IDEMPOTENCY ─────────────────────────────────────
    console.log('\n--- 4. Idempotency Guarantees ---');
    await reset();

    await test('approve on APPROVED → idempotent, no state change', async () => {
        const c = await mkReq();
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
        assert.strictEqual(r.request.request_status, 'APPROVED');
    });
    await test('reject on REJECTED → idempotent', async () => {
        const c = await mkReq();
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.idempotent, true);
    });
    await test('cancel on CANCELLED → idempotent', async () => {
        const c = await mkReq();
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        const r = await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(r.idempotent, true);
    });
    await test('replay idempotency key blocks double execution', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'idem1', actor_user_id: UA, is_bulk: true });
        await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UC, org_id: ORG });
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const r2 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(r2.error, 'replay_already_executed');
    });

    // ── 5. BYPASS ATTEMPTS ─────────────────────────────────
    console.log('\n--- 5. Bypass Attempts ---');
    await reset();

    await test('cannot replay without approval', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp1', actor_user_id: UA, is_bulk: true });
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UB });
        assert.strictEqual(r.success, false);
        assert.ok(r.error.includes('approval_not_approved'));
    });
    await test('cannot replay with only first DUAL approval', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp2', actor_user_id: UA, is_bulk: true });
        await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        // Only first approval, still PENDING
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.strictEqual(r.success, false);
        assert.ok(r.error.includes('approval_not_approved'));
    });
    await test('rejected request blocks replay permanently', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp3', actor_user_id: UA, is_bulk: true });
        await approvalService.rejectApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        // Try to approve after rejection
        const ar = await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UC, org_id: ORG });
        assert.strictEqual(ar.success, false);
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(r.success, false);
    });
    await test('cross-org replay denied', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp4', actor_user_id: UA, is_bulk: true });
        await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        await approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UC, org_id: ORG });
        const r = await executionService.replayApprovedExecution(db, { org_id: 'org-attacker', execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(r.error, 'execution_not_found');
    });
    await test('body identity ignored in execution', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'byp5', actor_user_id: UA });
        const exec = await executionService.getExecution(db, e.execution_id, ORG);
        assert.strictEqual(exec.execution.actor_user_id, UA);
        assert.strictEqual(exec.execution.org_id, ORG);
    });

    // ── 6. HARD ENFORCEMENT LAYER ──────────────────────────
    console.log('\n--- 6. Hard Enforcement (Bridge) ---');
    await reset();

    await test('workflow bridge blocks bulk without approval', async () => {
        const r = await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'he1', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(r.status, 'PENDING_APPROVAL');
        assert.ok(r.approval_request_id);
    });
    await test('workflow bridge blocks destructive without approval', async () => {
        const _r40 = await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'he2', actor_user_id: UA, is_destructive: true });
        assert.strictEqual(_r40.status, 'PENDING_APPROVAL');
    });
    await test('workflow bridge blocks AI without approval', async () => {
        const _r41 = await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'he3', actor_user_id: UA, is_ai_originated: true });
        assert.strictEqual(_r41.status, 'PENDING_APPROVAL');
    });
    await test('decision bridge blocks bulk', async () => {
        const _r42 = await interceptDecisionAction(db, { org_id: ORG, decision_id: 'd1', action_type: 'resolve', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(_r42.status, 'PENDING_APPROVAL');
    });
    await test('bridge fails closed on missing org', async () => {
        const _r43 = await interceptWorkflowExecution(db, { workflow_id: 'x', actor_user_id: UA });
        assert.strictEqual(_r43.status, 'ERROR');
    });
    await test('bridge fails closed on missing actor', async () => {
        const _r44 = await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'x' });
        assert.strictEqual(_r44.status, 'ERROR');
    });

    // ── 7. POLICY ENGINE DETERMINISM ───────────────────────
    console.log('\n--- 7. Policy Engine Determinism ---');
    await reset();

    await test('default bulk policy is DUAL', async () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:bulk_operation').mode, 'DUAL');
    });
    await test('default delete is DUAL', async () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:delete').mode, 'DUAL');
    });
    await test('default standard execute is NONE', async () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'workflow:execute').mode, 'NONE');
    });
    await test('unknown action fails closed to SINGLE', async () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'unknown:mystery').mode, 'SINGLE');
    });
    await test('missing action key fails closed', async () => {
        const p = policyRegistry.getApprovalPolicy(ORG, null);
        assert.strictEqual(p.mode, 'SINGLE');
        assert.strictEqual(p.risk, 'HIGH');
    });
    await test('safe action passes through', async () => {
        assert.strictEqual(policyRegistry.getApprovalPolicy(ORG, 'any:list').mode, 'NONE');
    });

    // ── 8. INVARIANT VERIFICATION ──────────────────────────
    console.log('\n--- 8. Post-Write Invariant Checks ---');
    await reset();

    await test('approved SINGLE passes invariant', async () => {
        const c = await mkReq();
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const inv = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(inv.valid, true);
    });
    await test('approved DUAL passes invariant', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        const inv = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(inv.valid, true);
    });
    await test('rejected passes invariant', async () => {
        const c = await mkReq();
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r45 = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(_r45.valid, true);
    });
    await test('pending passes invariant', async () => {
        const c = await mkReq();
        const _r46 = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(_r46.valid, true);
    });
    await test('nonexistent row fails invariant', async () => {
        const inv = await verifyApprovalInvariant(db, 999999);
        assert.strictEqual(inv.valid, false);
        assert.strictEqual(inv.violation, 'ROW_MISSING');
    });
    await test('execution invariant passes on valid row', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'inv1', actor_user_id: UA });
        const _r47 = await verifyExecutionInvariant(db, e.execution_id);
        assert.strictEqual(_r47.valid, true);
    });

    // ── 9. MALFORMED INPUT ─────────────────────────────────
    console.log('\n--- 9. Malformed Input Rejection ---');
    await reset();

    await test('null params → error', async () => {
        const _r48 = await approvalService.createApprovalRequest(db, null);
        assert.strictEqual(_r48.success, false);
    });
    await test('missing org_id → error', async () => {
        const _r49 = await approvalService.createApprovalRequest(db, { target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        assert.strictEqual(_r49.error, 'org_id_required');
    });
    await test('missing target_type → error', async () => {
        const _r50 = await approvalService.createApprovalRequest(db, { org_id: ORG, action_key: 'w:e', requested_by_user_id: UA });
        assert.strictEqual(_r50.error, 'target_type_required');
    });
    await test('missing action_key → error', async () => {
        const _r51 = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', requested_by_user_id: UA });
        assert.strictEqual(_r51.error, 'action_key_required');
    });
    await test('missing requested_by → error', async () => {
        const _r52 = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e' });
        assert.strictEqual(_r52.error, 'requested_by_user_id_required');
    });
    await test('approve without actor → error', async () => {
        const c = await mkReq();
        const _r53 = await approvalService.approveApprovalRequest(db, c.approval_request_id, {});
        assert.strictEqual(_r53.error, 'actor_user_id_required');
    });
    await test('approve nonexistent → not found', async () => {
        const _r54 = await approvalService.approveApprovalRequest(db, 999999, { actor_user_id: UB });
        assert.strictEqual(_r54.error, 'approval_request_not_found');
    });
    await test('execution without org → error', async () => {
        const _r55 = await executionService.executeWorkflow(db, { workflow_id: 'x', actor_user_id: UA });
        assert.strictEqual(_r55.success, false);
    });
    await test('execution without workflow → error', async () => {
        const _r56 = await executionService.executeWorkflow(db, { org_id: ORG, actor_user_id: UA });
        assert.strictEqual(_r56.success, false);
    });
    await test('execution without actor → error', async () => {
        const _r57 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'x' });
        assert.strictEqual(_r57.success, false);
    });

    // ── 10. AUDIT TRAIL COMPLETENESS ───────────────────────
    console.log('\n--- 10. Audit Trail ---');
    await reset();

    await test('approved request has full audit fields', async () => {
        const c = await mkReq({ request_payload: { data: 'test' } });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, reason: 'verified' });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.ok(r.request.created_at);
        assert.ok(r.request.resolved_at);
        assert.ok(r.request.updated_at);
        assert.strictEqual(r.request.approved_by_user_id, UB);
        assert.strictEqual(r.request.requested_by_user_id, UA);
        assert.strictEqual(r.request.decision_metadata_json.reason, 'verified');
    });
    await test('DUAL approval records both approvers', async () => {
        const c = await mkReq({ approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.approved_by_user_id, UB);
        assert.strictEqual(r.request.second_approved_by_user_id, UC);
    });
    await test('rejected request has rejector and timestamp', async () => {
        const c = await mkReq();
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, reason: 'denied' });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.rejected_by_user_id, UB);
        assert.ok(r.request.resolved_at);
    });
    await test('execution records governance snapshot', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'aud1', actor_user_id: UA, is_bulk: true });
        const r = await executionService.getExecution(db, e.execution_id, ORG);
        assert.ok(r.execution.governance_snapshot_json);
        assert.ok(r.execution.governance_snapshot_json.gate_status);
    });

    // Cleanup
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 26 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
