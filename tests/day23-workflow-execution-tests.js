'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const supertest = require('supertest');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const createWorkflowRoutes = require('../src/routes/workflows');
const createApprovalRoutes = require('../src/routes/approvals');

let db;
let passed = 0;
let failed = 0;
const failures = [];

const ORG = 'org-d23';
const OX = 'org-att-d23';
const UA = 'ua-d23';
const UB = 'ub-d23';
const UC = 'uc-d23';

function test(name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

async function asyncTest(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 23: Workflow Execution Tests');
    console.log('========================================');

    passed = 0; failed = 0; failures.length = 0;

    db = await createDatabase();
    const sql22 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8');
    const sql23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '017-day23-workflow-execution.sql'), 'utf-8');
    for (const s of sql22.split(';').filter(s => s.trim())) db.exec(s + ';');
    for (const s of sql23.split(';').filter(s => s.trim())) db.exec(s + ';');
    executionService.configureExecutor(null);
    policyRegistry.clearOrgPolicies();

    console.log('\n--- 1. Pass-Through ---');
    test('standard execute → EXECUTED', () => {
        const r = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf1', actor_user_id: UA, payload: { s: 1 } });
        assert.strictEqual(r.success, true); assert.strictEqual(r.execution_status, 'EXECUTED'); assert.ok(r.execution_id);
    });
    test('persisted', () => {
        assert.ok(executionService.listExecutions(db, { org_id: ORG, execution_status: 'EXECUTED' }).executions.length >= 1);
    });

    console.log('\n--- 2. Blocked ---');
    test('bulk → BLOCKED', () => {
        const r = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf2', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(r.execution_status, 'BLOCKED_PENDING_APPROVAL'); assert.ok(r.approval_request_id);
    });
    test('destructive → BLOCKED', () => {
        assert.strictEqual(executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf3', actor_user_id: UA, is_destructive: true }).execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    test('AI → BLOCKED', () => {
        assert.strictEqual(executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf4', actor_user_id: UA, is_ai_originated: true }).execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    test('links approval_request_id', () => {
        const r = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf5', actor_user_id: UA, is_bulk: true });
        assert.ok(executionService.getExecution(db, r.execution_id, ORG).execution.approval_request_id);
    });

    console.log('\n--- 3. Fail-Closed ---');
    test('no org', () => { assert.strictEqual(executionService.executeWorkflow(db, { workflow_id: 'x', actor_user_id: UA }).success, false); });
    test('no wf', () => { assert.strictEqual(executionService.executeWorkflow(db, { org_id: ORG, actor_user_id: UA }).success, false); });
    test('no actor', () => { assert.strictEqual(executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'x' }).success, false); });

    console.log('\n--- 4. Replay ---');
    test('approved replay succeeds', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wr1', actor_user_id: UA, is_bulk: true, payload: { t: 1 } });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        const r = executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.strictEqual(r.execution_status, 'REPLAYED'); assert.ok(r.execution_id !== e.execution_id);
    });
    test('preserves payload', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wr2', actor_user_id: UA, is_bulk: true, payload: { k: 'v' } });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        const r = executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.deepStrictEqual(executionService.getExecution(db, r.execution_id, ORG).execution.request_payload_json, { k: 'v' });
    });

    console.log('\n--- 5. Reject/Cancel ---');
    test('rejected blocks', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wrj', actor_user_id: UA, is_bulk: true });
        approvalService.rejectApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        assert.ok(executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC }).error.includes('approval_not_approved'));
    });
    test('cancelled blocks', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wcn', actor_user_id: UA, is_bulk: true });
        approvalService.cancelApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        assert.strictEqual(executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC }).success, false);
    });
    test('pending blocks', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wpn', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC }).success, false);
    });

    console.log('\n--- 6. Double-Replay ---');
    test('second blocked', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wdb', actor_user_id: UA, is_bulk: true });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.strictEqual(executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC }).error, 'replay_already_executed');
    });

    console.log('\n--- 7. Cross-Org ---');
    test('replay denied', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wxo', actor_user_id: UA, is_bulk: true });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        assert.strictEqual(executionService.replayApprovedExecution(db, { org_id: OX, execution_id: e.execution_id, actor_user_id: UC }).error, 'execution_not_found');
    });
    test('get denied', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wxo2', actor_user_id: UA });
        assert.strictEqual(executionService.getExecution(db, e.execution_id, OX).success, false);
    });
    test('list empty', () => {
        assert.strictEqual(executionService.listExecutions(db, { org_id: OX }).executions.length, 0);
    });

    console.log('\n--- 8. Audit ---');
    test('executed fields', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wau', actor_user_id: UA, payload: { a: 1 } });
        const r = executionService.getExecution(db, e.execution_id, ORG).execution;
        assert.strictEqual(r.org_id, ORG); assert.strictEqual(r.is_replay, 0); assert.ok(r.created_at);
    });
    test('replay fields', () => {
        const e = executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wa2', actor_user_id: UA, is_bulk: true });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        const rp = executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        const r = executionService.getExecution(db, rp.execution_id, ORG).execution;
        assert.strictEqual(r.is_replay, 1); assert.strictEqual(r.replayed_by_user_id, UC);
    });

    console.log('\n--- 9. Executor ---');
    test('receives params', () => {
        let cap = null;
        executionService.configureExecutor((_db, w, p, ctx) => { cap = { w, p, ctx }; return { success: true }; });
        executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wcu', actor_user_id: UA, payload: { x: 1 } });
        assert.strictEqual(cap.w, 'wcu');
        executionService.configureExecutor(null);
    });

    console.log('\n--- 10. List/Get ---');
    test('filter', () => {
        executionService.listExecutions(db, { org_id: ORG, execution_status: 'EXECUTED' }).executions.forEach(e => assert.strictEqual(e.execution_status, 'EXECUTED'));
    });
    test('not found', () => { assert.strictEqual(executionService.getExecution(db, 99999, ORG).success, false); });

    console.log('\n--- 11-14. HTTP ---');
    const app = express(); app.use(express.json());
    app.use('/workflows', createWorkflowRoutes(db));
    app.use('/approvals', createApprovalRoutes(db));
    const ag = supertest(app);

    await asyncTest('no auth → 401', async () => { assert.strictEqual((await ag.post('/workflows/wh1/execute').send({})).status, 401); });
    await asyncTest('auth → 200', async () => { assert.strictEqual((await ag.post('/workflows/wh2/execute').set('x-user-id', UA).set('x-org-id', ORG).send({})).status, 200); });
    await asyncTest('bulk → 202', async () => { assert.strictEqual((await ag.post('/workflows/wh3/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true })).status, 202); });

    const r4 = await ag.post('/workflows/wh4/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true });
    approvalService.approveApprovalRequest(db, r4.body.approval_request_id, { actor_user_id: UB, org_id: ORG });

    await asyncTest('replay → 200', async () => { assert.strictEqual((await ag.post('/workflows/' + r4.body.execution_id + '/replay').set('x-user-id', UC).set('x-org-id', ORG).send({})).status, 200); });
    await asyncTest('double → 409', async () => { assert.strictEqual((await ag.post('/workflows/' + r4.body.execution_id + '/replay').set('x-user-id', UC).set('x-org-id', ORG).send({})).status, 409); });
    await asyncTest('nonexist → 404', async () => { assert.strictEqual((await ag.post('/workflows/999999/replay').set('x-user-id', UC).set('x-org-id', ORG).send({})).status, 404); });

    const r8 = await ag.post('/workflows/wh5/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true });
    await asyncTest('unapproved → 403', async () => { assert.strictEqual((await ag.post('/workflows/' + r8.body.execution_id + '/replay').set('x-user-id', UC).set('x-org-id', ORG).send({})).status, 403); });
    await asyncTest('list → 200', async () => { assert.ok((await ag.get('/workflows/executions').set('x-user-id', UA).set('x-org-id', ORG)).body.executions.length > 0); });
    await asyncTest('list other → empty', async () => { assert.strictEqual((await ag.get('/workflows/executions').set('x-user-id', UA).set('x-org-id', OX)).body.executions.length, 0); });

    const eg = await ag.post('/workflows/whg/execute').set('x-user-id', UA).set('x-org-id', ORG).send({});
    await asyncTest('get → 200', async () => { assert.strictEqual((await ag.get('/workflows/executions/' + eg.body.execution_id).set('x-user-id', UA).set('x-org-id', ORG)).status, 200); });
    await asyncTest('get xorg → 404', async () => { assert.strictEqual((await ag.get('/workflows/executions/' + eg.body.execution_id).set('x-user-id', UA).set('x-org-id', OX)).status, 404); });
    await asyncTest('get bad → 400', async () => { assert.strictEqual((await ag.get('/workflows/executions/abc').set('x-user-id', UA).set('x-org-id', ORG)).status, 400); });
    await asyncTest('spoofed', async () => {
        const r = await ag.post('/workflows/wsp/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ actor_user_id: 'evil', org_id: 'evil' });
        assert.strictEqual(executionService.getExecution(db, r.body.execution_id, ORG).execution.actor_user_id, UA);
    });

    console.log('\n--- 15. Guards ---');
    test('factory requires db', () => { assert.throws(() => createWorkflowRoutes(null), /db required/); });
    test('migration exists', () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '017-day23-workflow-execution.sql'))); });

    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 23 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
