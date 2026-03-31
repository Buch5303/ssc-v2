'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const supertest = require('supertest');
const { createDatabase } = require('./test-db-helper');
const { validate, V } = require('../src/common/validate');
const approvalService = require('../src/services/approval-service');
const createApprovalRoutes = require('../src/routes/approvals');
const createWorkflowRoutes = require('../src/routes/workflows');

let db;
let passed = 0;
let failed = 0;
const failures = [];

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
    console.log('Day 24: Input Validation Tests');
    console.log('========================================');

    passed = 0; failed = 0; failures.length = 0;

    console.log('\n--- 1. String ---');
    test('required present', () => { const r = validate({ n: 'hi' }, { n: V.string() }); assert.strictEqual(r.valid, true); assert.strictEqual(r.cleaned.n, 'hi'); });
    test('required missing', () => { assert.strictEqual(validate({}, { n: V.string() }).valid, false); });
    test('optional missing → null', () => { assert.strictEqual(validate({}, { n: V.optString() }).cleaned.n, null); });
    test('exceeds maxLen', () => { assert.strictEqual(validate({ n: 'x'.repeat(11) }, { n: V.string(10) }).valid, false); });
    test('control chars', () => { assert.strictEqual(validate({ n: 'hi\x00' }, { n: V.string() }).valid, false); });
    test('non-string', () => { assert.strictEqual(validate({ n: 123 }, { n: V.string() }).valid, false); });

    console.log('\n--- 2. Enum ---');
    test('valid', () => { assert.strictEqual(validate({ s: 'A' }, { s: V.enumOf(['A', 'B']) }).cleaned.s, 'A'); });
    test('invalid', () => { assert.strictEqual(validate({ s: 'X' }, { s: V.enumOf(['A']) }).valid, false); });
    test('optional missing', () => { assert.strictEqual(validate({}, { s: V.optEnumOf(['A']) }).valid, true); });

    console.log('\n--- 3. Boolean ---');
    test('true', () => { assert.strictEqual(validate({ f: true }, { f: V.optBool() }).cleaned.f, true); });
    test('false', () => { assert.strictEqual(validate({ f: false }, { f: V.optBool() }).cleaned.f, false); });
    test('"true" coerced', () => { assert.strictEqual(validate({ f: 'true' }, { f: V.optBool() }).cleaned.f, true); });
    test('"false" coerced', () => { assert.strictEqual(validate({ f: 'false' }, { f: V.optBool() }).cleaned.f, false); });
    test('absent → false', () => { assert.strictEqual(validate({}, { f: V.optBool() }).cleaned.f, false); });
    test('invalid', () => { assert.strictEqual(validate({ f: 'maybe' }, { f: V.bool() }).valid, false); });

    console.log('\n--- 4. PosInt ---');
    test('valid', () => { assert.strictEqual(validate({ n: 5 }, { n: V.posInt() }).cleaned.n, 5); });
    test('string coerced', () => { assert.strictEqual(validate({ n: '10' }, { n: V.posInt() }).cleaned.n, 10); });
    test('zero', () => { assert.strictEqual(validate({ n: 0 }, { n: V.posInt() }).valid, false); });
    test('negative', () => { assert.strictEqual(validate({ n: -1 }, { n: V.posInt() }).valid, false); });
    test('float', () => { assert.strictEqual(validate({ n: 3.5 }, { n: V.posInt() }).valid, false); });

    console.log('\n--- 5. Object ---');
    test('valid', () => { assert.deepStrictEqual(validate({ d: { k: 'v' } }, { d: V.optObject() }).cleaned.d, { k: 'v' }); });
    test('absent → empty', () => { assert.deepStrictEqual(validate({}, { d: V.optObject() }).cleaned.d, {}); });
    test('array rejected', () => { assert.strictEqual(validate({ d: [1] }, { d: V.object() }).valid, false); });
    test('oversized', () => { assert.strictEqual(validate({ d: { big: 'x'.repeat(200) } }, { d: V.optObject(100) }).valid, false); });

    console.log('\n--- 6. Unknown Fields ---');
    test('stripped', () => { const r = validate({ n: 'ok', evil: 'x' }, { n: V.string() }); assert.strictEqual(r.cleaned.evil, undefined); });

    console.log('\n--- 7. Multiple Errors ---');
    test('both reported', () => { assert.strictEqual(validate({}, { a: V.string(), b: V.posInt() }).errors.length, 2); });

    console.log('\n--- 8. Edge Cases ---');
    test('null input', () => { assert.strictEqual(validate(null, { n: V.optString() }).valid, true); });
    test('undefined input', () => { assert.strictEqual(validate(undefined, { n: V.optString() }).valid, true); });

    console.log('\n--- 9. HTTP: Approval Validation ---');
    db = await createDatabase();
    const sql22 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8');
    const sql23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '017-day23-workflow-execution.sql'), 'utf-8');
    for (const s of sql22.split(';').filter(s => s.trim())) db.exec(s + ';');
    for (const s of sql23.split(';').filter(s => s.trim())) db.exec(s + ';');

    const app = express(); app.use(express.json());
    app.use('/approvals', createApprovalRoutes(db));
    app.use('/workflows', createWorkflowRoutes(db));
    const agent = supertest(app);

    const cr = approvalService.createApprovalRequest(db, { org_id: 'ov', target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: 'ur' });
    await asyncTest('approve valid → 200', async () => {
        assert.strictEqual((await agent.post('/approvals/' + cr.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ reason: 'ok', metadata: { n: 'ok' } })).status, 200);
    });

    const cr2 = approvalService.createApprovalRequest(db, { org_id: 'ov', target_type: 'workflow', target_id: 'wv2', action_key: 'workflow:execute', requested_by_user_id: 'ur' });
    await asyncTest('non-string reason → 400', async () => {
        const r = await agent.post('/approvals/' + cr2.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ reason: 12345 });
        assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'validation_failed');
    });
    await asyncTest('oversized metadata → 400', async () => {
        const r = await agent.post('/approvals/' + cr2.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ metadata: { huge: 'x'.repeat(200) } });
        assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'validation_failed');
    });

    console.log('\n--- 10. HTTP: Workflow Validation ---');
    await asyncTest('execute valid → 200', async () => { assert.strictEqual((await agent.post('/workflows/wv1/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ payload: { d: 1 }, is_bulk: false })).status, 200); });
    await asyncTest('non-bool is_bulk → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv2/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ is_bulk: 'maybe' })).body.error, 'validation_failed'); });
    await asyncTest('non-object payload → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv3/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ payload: 'str' })).body.error, 'validation_failed'); });
    await asyncTest('empty body → 200', async () => { assert.strictEqual((await agent.post('/workflows/wv4/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({})).status, 200); });
    await asyncTest('control chars → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv5/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ action_type: 'e\x00x' })).body.error, 'validation_failed'); });

    console.log('\n--- 11. Guards ---');
    test('validate.js exists', () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'common', 'validate.js'))); });
    test('schemas/approvals.js exists', () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'schemas', 'approvals.js'))); });
    test('schemas/workflows.js exists', () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'schemas', 'workflows.js'))); });

    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 24 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
