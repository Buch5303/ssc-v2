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
const { authenticate } = require('../src/middleware/auth');
const { extractIdentity } = require('../src/middleware/context');

let db;
let passed = 0;
let failed = 0;
const failures = [];

const ORG = 'org-d23';
const OX = 'org-att-d23';
const UA = 'ua-d23';
const UB = 'ub-d23';
const UC = 'uc-d23';
const UD = 'ud-d23';

    console.log('\n========================================');
async function test(name, fn) {
    try { await fn(); passed++; console.log("  ✓ " + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log("  ✗ " + name + ": " + err.message); }
}

async function dualApprove(approvalRequestId) {
    await approvalService.approveApprovalRequest(db, approvalRequestId, { actor_user_id: UB, org_id: ORG });
    await approvalService.approveApprovalRequest(db, approvalRequestId, { actor_user_id: UC, org_id: ORG });
}
async function runTests() {
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
    await test('standard execute → EXECUTED', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf1', actor_user_id: UA, payload: { s: 1 } });
        assert.strictEqual(r.success, true); assert.strictEqual(r.execution_status, 'EXECUTED'); assert.ok(r.execution_id);
    });
    await test('persisted', async () => {
        const _r17 = await executionService.listExecutions(db, { org_id: ORG, execution_status: 'EXECUTED' });
        assert.ok(_r17.executions.length >= 1);
    });

    console.log('\n--- 2. Blocked ---');
    await test('bulk → BLOCKED', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf2', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(r.execution_status, 'BLOCKED_PENDING_APPROVAL'); assert.ok(r.approval_request_id);
    });
    await test('destructive → BLOCKED', async () => {
        const _r18 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf3', actor_user_id: UA, is_destructive: true });
        assert.strictEqual(_r18.execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('AI → BLOCKED', async () => {
        const _r19 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf4', actor_user_id: UA, is_ai_originated: true });
        assert.strictEqual(_r19.execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('links approval_request_id', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wf5', actor_user_id: UA, is_bulk: true });
        const _r20 = await executionService.getExecution(db, r.execution_id, ORG);
        assert.ok(_r20.execution.approval_request_id);
    });

    console.log('\n--- 3. Fail-Closed ---');
    const _r21 = await executionService.executeWorkflow(db, { workflow_id: 'x', actor_user_id: UA });
    await test('no org', async () => { assert.strictEqual(_r21.success, false); });
    const _r22 = await executionService.executeWorkflow(db, { org_id: ORG, actor_user_id: UA });
    await test('no wf', async () => { assert.strictEqual(_r22.success, false); });
    const _r23 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'x' });
    await test('no actor', async () => { assert.strictEqual(_r23.success, false); });

    console.log('\n--- 4. Replay (DUAL approval required) ---');
    await test('approved replay succeeds', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wr1', actor_user_id: UA, is_bulk: true, payload: { t: 1 } });
        await dualApprove(e.approval_request_id);
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(r.execution_status, 'REPLAYED'); assert.ok(r.execution_id !== e.execution_id);
    });
    await test('preserves payload', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wr2', actor_user_id: UA, is_bulk: true, payload: { k: 'v' } });
        await dualApprove(e.approval_request_id);
        const r = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const _r24 = await executionService.getExecution(db, r.execution_id, ORG);
        assert.deepStrictEqual(_r24.execution.request_payload_json, { k: 'v' });
    });

    console.log('\n--- 5. Reject/Cancel ---');
    await test('rejected blocks', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wrj', actor_user_id: UA, is_bulk: true });
        await approvalService.rejectApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        const _r25 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.ok(_r25.error.includes('approval_not_approved'));
    });
    await test('cancelled blocks', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wcn', actor_user_id: UA, is_bulk: true });
        await approvalService.cancelApprovalRequest(db, e.approval_request_id, { actor_user_id: UB, org_id: ORG });
        const _r26 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.strictEqual(_r26.success, false);
    });
    await test('pending blocks', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wpn', actor_user_id: UA, is_bulk: true });
        const _r27 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UC });
        assert.strictEqual(_r27.success, false);
    });

    console.log('\n--- 6. Double-Replay ---');
    await test('second blocked', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wdb', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const _r28 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r28.error, 'replay_already_executed');
    });

    console.log('\n--- 7. Cross-Org ---');
    await test('replay denied', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wxo', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        const _r29 = await executionService.replayApprovedExecution(db, { org_id: OX, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r29.error, 'execution_not_found');
    });
    await test('get denied', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wxo2', actor_user_id: UA });
        const _r30 = await executionService.getExecution(db, e.execution_id, OX);
        assert.strictEqual(_r30.success, false);
    });
    await test('list empty', async () => {
        const _r31 = await executionService.listExecutions(db, { org_id: OX });
        assert.strictEqual(_r31.executions.length, 0);
    });

    console.log('\n--- 8. Audit ---');
    await test('executed fields', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wau', actor_user_id: UA, payload: { a: 1 } });
        const _r32 = await executionService.getExecution(db, e.execution_id, ORG);
        const r = _r32.execution;
        assert.strictEqual(r.org_id, ORG); assert.strictEqual(r.is_replay, 0); assert.ok(r.created_at);
    });
    await test('replay fields', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wa2', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        const rp = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const _r33 = await executionService.getExecution(db, rp.execution_id, ORG);
        const r = _r33.execution;
        assert.strictEqual(r.is_replay, 1); assert.strictEqual(r.replayed_by_user_id, UD);
    });

    console.log('\n--- 9. Executor ---');
    await test('receives params', async () => {
        let cap = null;
        executionService.configureExecutor((_db, w, p, ctx) => { cap = { w, p, ctx }; return { success: true }; });
        await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'wcu', actor_user_id: UA, payload: { x: 1 } });
        assert.strictEqual(cap.w, 'wcu');
        executionService.configureExecutor(null);
    });

    console.log('\n--- 10. List/Get ---');
    await test('filter', async () => {
        const _r34 = await executionService.listExecutions(db, { org_id: ORG, execution_status: 'EXECUTED' });
        _r34.executions.forEach(e => assert.strictEqual(e.execution_status, 'EXECUTED'));
    });
    const _r35 = await executionService.getExecution(db, 99999, ORG);
    await test('not found', async () => { assert.strictEqual(_r35.success, false); });

    console.log('\n--- 11-14. HTTP ---');
    process.env.AUTH_MODE = 'headers';
    const app = express(); app.use(express.json()); app.use(authenticate); app.use(extractIdentity);
    app.use('/workflows', createWorkflowRoutes(db));
    app.use('/approvals', createApprovalRoutes(db));
    const ag = supertest(app);

    await test('no auth → 401', async () => { assert.strictEqual((await ag.post('/workflows/wh1/execute').send({})).status, 401); });
    await test('auth → 200', async () => { assert.strictEqual((await ag.post('/workflows/wh2/execute').set('x-user-id', UA).set('x-org-id', ORG).send({})).status, 200); });
    await test('bulk → 202', async () => { assert.strictEqual((await ag.post('/workflows/wh3/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true })).status, 202); });

    const r4 = await ag.post('/workflows/wh4/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true });
    await dualApprove(r4.body.approval_request_id);

    await test('replay → 200', async () => { assert.strictEqual((await ag.post('/workflows/' + r4.body.execution_id + '/replay').set('x-user-id', UD).set('x-org-id', ORG).send({})).status, 200); });
    await test('double → 409', async () => { assert.strictEqual((await ag.post('/workflows/' + r4.body.execution_id + '/replay').set('x-user-id', UD).set('x-org-id', ORG).send({})).status, 409); });
    await test('nonexist → 404', async () => { assert.strictEqual((await ag.post('/workflows/999999/replay').set('x-user-id', UD).set('x-org-id', ORG).send({})).status, 404); });

    const r8 = await ag.post('/workflows/wh5/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ is_bulk: true });
    await test('unapproved → 403', async () => { assert.strictEqual((await ag.post('/workflows/' + r8.body.execution_id + '/replay').set('x-user-id', UD).set('x-org-id', ORG).send({})).status, 403); });
    await test('list → 200', async () => { assert.ok((await ag.get('/workflows/executions').set('x-user-id', UA).set('x-org-id', ORG)).body.executions.length > 0); });
    await test('list other → empty', async () => { assert.strictEqual((await ag.get('/workflows/executions').set('x-user-id', UA).set('x-org-id', OX)).body.executions.length, 0); });

    const eg = await ag.post('/workflows/whg/execute').set('x-user-id', UA).set('x-org-id', ORG).send({});
    await test('get → 200', async () => { assert.strictEqual((await ag.get('/workflows/executions/' + eg.body.execution_id).set('x-user-id', UA).set('x-org-id', ORG)).status, 200); });
    await test('get xorg → 404', async () => { assert.strictEqual((await ag.get('/workflows/executions/' + eg.body.execution_id).set('x-user-id', UA).set('x-org-id', OX)).status, 404); });
    await test('get bad → 400', async () => { assert.strictEqual((await ag.get('/workflows/executions/abc').set('x-user-id', UA).set('x-org-id', ORG)).status, 400); });
    await test('spoofed', async () => {
        const r = await ag.post('/workflows/wsp/execute').set('x-user-id', UA).set('x-org-id', ORG).send({ actor_user_id: 'evil', org_id: 'evil' });
        const _r36 = await executionService.getExecution(db, r.body.execution_id, ORG);
        assert.strictEqual(_r36.execution.actor_user_id, UA);
    });

    console.log('\n--- 15. Guards ---');
    await test('factory requires db', async () => { assert.throws(() => createWorkflowRoutes(null), /db required/); });
    await test('migration exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '017-day23-workflow-execution.sql'))); });

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
