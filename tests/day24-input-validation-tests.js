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
const { authenticate } = require('../src/middleware/auth');
const { extractIdentity } = require('../src/middleware/context');

let db;
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}
async function runTests() {
    console.log('\n========================================');
    console.log('Day 24: Input Validation Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;

    console.log('\n--- 1. String ---');
    await test('required present', async () => { const r = validate({ n: 'hi' }, { n: V.string() }); assert.strictEqual(r.valid, true); assert.strictEqual(r.cleaned.n, 'hi'); });
    await test('required missing', async () => { assert.strictEqual(validate({}, { n: V.string() }).valid, false); });
    await test('optional missing → null', async () => { assert.strictEqual(validate({}, { n: V.optString() }).cleaned.n, null); });
    await test('exceeds maxLen', async () => { assert.strictEqual(validate({ n: 'x'.repeat(11) }, { n: V.string(10) }).valid, false); });
    await test('control chars', async () => { assert.strictEqual(validate({ n: 'hi\x00' }, { n: V.string() }).valid, false); });
    await test('non-string', async () => { assert.strictEqual(validate({ n: 123 }, { n: V.string() }).valid, false); });

    console.log('\n--- 2. Enum ---');
    await test('valid', async () => { assert.strictEqual(validate({ s: 'A' }, { s: V.enumOf(['A', 'B']) }).cleaned.s, 'A'); });
    await test('invalid', async () => { assert.strictEqual(validate({ s: 'X' }, { s: V.enumOf(['A']) }).valid, false); });
    await test('optional missing', async () => { assert.strictEqual(validate({}, { s: V.optEnumOf(['A']) }).valid, true); });

    console.log('\n--- 3. Boolean ---');
    await test('true', async () => { assert.strictEqual(validate({ f: true }, { f: V.optBool() }).cleaned.f, true); });
    await test('false', async () => { assert.strictEqual(validate({ f: false }, { f: V.optBool() }).cleaned.f, false); });
    await test('"true" coerced', async () => { assert.strictEqual(validate({ f: 'true' }, { f: V.optBool() }).cleaned.f, true); });
    await test('"false" coerced', async () => { assert.strictEqual(validate({ f: 'false' }, { f: V.optBool() }).cleaned.f, false); });
    await test('absent → false', async () => { assert.strictEqual(validate({}, { f: V.optBool() }).cleaned.f, false); });
    await test('invalid', async () => { assert.strictEqual(validate({ f: 'maybe' }, { f: V.bool() }).valid, false); });

    console.log('\n--- 4. PosInt ---');
    await test('valid', async () => { assert.strictEqual(validate({ n: 5 }, { n: V.posInt() }).cleaned.n, 5); });
    await test('string coerced', async () => { assert.strictEqual(validate({ n: '10' }, { n: V.posInt() }).cleaned.n, 10); });
    await test('zero', async () => { assert.strictEqual(validate({ n: 0 }, { n: V.posInt() }).valid, false); });
    await test('negative', async () => { assert.strictEqual(validate({ n: -1 }, { n: V.posInt() }).valid, false); });
    await test('float', async () => { assert.strictEqual(validate({ n: 3.5 }, { n: V.posInt() }).valid, false); });

    console.log('\n--- 5. Object ---');
    await test('valid', async () => { assert.deepStrictEqual(validate({ d: { k: 'v' } }, { d: V.optObject() }).cleaned.d, { k: 'v' }); });
    await test('absent → empty', async () => { assert.deepStrictEqual(validate({}, { d: V.optObject() }).cleaned.d, {}); });
    await test('array rejected', async () => { assert.strictEqual(validate({ d: [1] }, { d: V.object() }).valid, false); });
    await test('oversized', async () => { assert.strictEqual(validate({ d: { big: 'x'.repeat(200) } }, { d: V.optObject(100) }).valid, false); });

    console.log('\n--- 6. Unknown Fields ---');
    await test('stripped', async () => { const r = validate({ n: 'ok', evil: 'x' }, { n: V.string() }); assert.strictEqual(r.cleaned.evil, undefined); });

    console.log('\n--- 7. Multiple Errors ---');
    await test('both reported', async () => { assert.strictEqual(validate({}, { a: V.string(), b: V.posInt() }).errors.length, 2); });

    console.log('\n--- 8. Edge Cases ---');
    await test('null input', async () => { assert.strictEqual(validate(null, { n: V.optString() }).valid, true); });
    await test('undefined input', async () => { assert.strictEqual(validate(undefined, { n: V.optString() }).valid, true); });

    console.log('\n--- 9. HTTP: Approval Validation ---');
    db = await createDatabase();
    const sql22 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8');
    const sql23 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '017-day23-workflow-execution.sql'), 'utf-8');
    for (const s of sql22.split(';').filter(s => s.trim())) db.exec(s + ';');
    for (const s of sql23.split(';').filter(s => s.trim())) db.exec(s + ';');

    process.env.AUTH_MODE = 'headers';
    const app = express(); app.use(express.json()); app.use(authenticate); app.use(extractIdentity);
    app.use('/approvals', createApprovalRoutes(db));
    app.use('/workflows', createWorkflowRoutes(db));
    const agent = supertest(app);

    const cr = await approvalService.createApprovalRequest(db, { org_id: 'ov', target_type: 'workflow', action_key: 'workflow:execute', requested_by_user_id: 'ur' });
    await test('approve valid → 200', async () => {
        assert.strictEqual((await agent.post('/approvals/' + cr.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ reason: 'ok', metadata: { n: 'ok' } })).status, 200);
    });

    const cr2 = await approvalService.createApprovalRequest(db, { org_id: 'ov', target_type: 'workflow', target_id: 'wv2', action_key: 'workflow:execute', requested_by_user_id: 'ur' });
    await test('non-string reason → 400', async () => {
        const r = await agent.post('/approvals/' + cr2.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ reason: 12345 });
        assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'validation_failed');
    });
    await test('oversized metadata → 400', async () => {
        const r = await agent.post('/approvals/' + cr2.approval_request_id + '/approve').set('x-user-id', 'ua').set('x-org-id', 'ov').send({ metadata: { huge: 'x'.repeat(200) } });
        assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'validation_failed');
    });

    console.log('\n--- 10. HTTP: Workflow Validation ---');
    await test('execute valid → 200', async () => { assert.strictEqual((await agent.post('/workflows/wv1/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ payload: { d: 1 }, is_bulk: false })).status, 200); });
    await test('non-bool is_bulk → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv2/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ is_bulk: 'maybe' })).body.error, 'validation_failed'); });
    await test('non-object payload → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv3/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ payload: 'str' })).body.error, 'validation_failed'); });
    await test('empty body → 200', async () => { assert.strictEqual((await agent.post('/workflows/wv4/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({})).status, 200); });
    await test('control chars → 400', async () => { assert.strictEqual((await agent.post('/workflows/wv5/execute').set('x-user-id', 'uv').set('x-org-id', 'ov').send({ action_type: 'e\x00x' })).body.error, 'validation_failed'); });

    console.log('\n--- 11. Guards ---');
    await test('validate.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'common', 'validate.js'))); });
    await test('schemas/approvals.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'schemas', 'approvals.js'))); });
    await test('schemas/workflows.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'schemas', 'workflows.js'))); });

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
