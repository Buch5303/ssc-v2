'use strict';
const assert = require('assert');
const express = require('express');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const { createDatabase } = require('./test-db-helper');
const { authenticate } = require('../src/middleware/auth');
const { extractIdentity } = require('../src/middleware/context');
const createApprovalRoutes = require('../src/routes/approvals');
const approvalService = require('../src/services/approval-service');
const policyRegistry = require('../src/services/approval-policy-registry');
const fs = require('fs'), path = require('path');

let db, passed = 0, failed = 0;
const failures = [];
const SECRET = 'test-secret-d25';

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

function mkApp(mode, secret) {
    process.env.AUTH_MODE = mode;
    if (secret) process.env.JWT_SECRET = secret;
    const app = express(); app.use(express.json()); app.use(authenticate); app.use(extractIdentity);
    app.use('/approvals', createApprovalRoutes(db));
    return app;
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 25: Auth Hardening Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;

    db = await createDatabase();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8');
    for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    policyRegistry.clearOrgPolicies();

    console.log('\n--- 1. Headers Mode ---');
    const ha = supertest(mkApp('headers', null));

    await test('valid headers → 200', async () => {
        const r = await ha.get('/approvals').set('x-user-id', 'u1').set('x-org-id', 'o1');
        assert.strictEqual(r.status, 200);
    });
    await test('missing both → 401', async () => {
        const r = await ha.get('/approvals');
        assert.strictEqual(r.status, 401);
    });
    await test('missing org-id → 401', async () => {
        const r = await ha.get('/approvals').set('x-user-id', 'u1');
        assert.strictEqual(r.status, 401);
    });
    await test('missing user-id → 401', async () => {
        const r = await ha.get('/approvals').set('x-org-id', 'o1');
        assert.strictEqual(r.status, 401);
    });

    console.log('\n--- 2. JWT Mode ---');
    process.env.JWT_SECRET = SECRET;
    const validToken = jwt.sign({ sub: 'u1', org_id: 'o1' }, SECRET, { expiresIn: '1h' });
    const ja = supertest(mkApp('jwt', SECRET));

    await test('valid token → 200', async () => {
        const r = await ja.get('/approvals').set('Authorization', 'Bearer ' + validToken);
        assert.strictEqual(r.status, 200);
    });
    await test('user_id claim accepted', async () => {
        const tok = jwt.sign({ user_id: 'u2', org_id: 'o2' }, SECRET);
        const r = await ja.get('/approvals').set('Authorization', 'Bearer ' + tok);
        assert.strictEqual(r.status, 200);
    });
    await test('no token → 401', async () => {
        const r = await ja.get('/approvals');
        assert.strictEqual(r.status, 401);
    });
    await test('headers instead of token → 401', async () => {
        const r = await ja.get('/approvals').set('x-user-id', 'u1').set('x-org-id', 'o1');
        assert.strictEqual(r.status, 401);
    });
    await test('malformed token → 401', async () => {
        const r = await ja.get('/approvals').set('Authorization', 'Bearer not.a.token');
        assert.strictEqual(r.status, 401);
    });
    await test('wrong secret → 401', async () => {
        const bad = jwt.sign({ sub: 'u1', org_id: 'o1' }, 'wrong-secret');
        const r = await ja.get('/approvals').set('Authorization', 'Bearer ' + bad);
        assert.strictEqual(r.status, 401);
    });
    await test('expired token → 401', async () => {
        const exp = jwt.sign({ sub: 'u1', org_id: 'o1' }, SECRET, { expiresIn: '-1s' });
        const r = await ja.get('/approvals').set('Authorization', 'Bearer ' + exp);
        assert.strictEqual(r.status, 401);
    });
    await test('missing org_id claim → 401', async () => {
        const tok = jwt.sign({ sub: 'u1' }, SECRET);
        const r = await ja.get('/approvals').set('Authorization', 'Bearer ' + tok);
        assert.strictEqual(r.status, 401);
    });

    console.log('\n--- 3. Edge Cases ---');
    await test('unknown AUTH_MODE → 500', async () => {
        process.env.AUTH_MODE = 'magic';
        const app = express(); app.use(express.json()); app.use(authenticate); app.use(extractIdentity);
        app.use('/approvals', createApprovalRoutes(db));
        const r = await supertest(app).get('/approvals').set('x-user-id', 'u1').set('x-org-id', 'o1');
        assert.strictEqual(r.status, 500);
        process.env.AUTH_MODE = 'headers';
    });
    await test('no AUTH_MODE → 500', async () => {
        delete process.env.AUTH_MODE;
        const app = express(); app.use(express.json()); app.use(authenticate);
        app.use('/approvals', createApprovalRoutes(db));
        const r = await supertest(app).get('/approvals');
        assert.strictEqual(r.status, 500);
        process.env.AUTH_MODE = 'headers';
    });

    console.log('\n--- 4. Context ---');
    await test('identity extracted from headers', async () => {
        process.env.AUTH_MODE = 'headers';
        const app = express(); app.use(express.json()); app.use(authenticate); app.use(extractIdentity);
        app.get('/check', (req, res) => res.json({ userId: req.identity.userId, orgId: req.identity.orgId }));
        const r = await supertest(app).get('/check').set('x-user-id', 'uid').set('x-org-id', 'oid');
        assert.strictEqual(r.body.userId, 'uid');
        assert.strictEqual(r.body.orgId, 'oid');
    });
    await test('health → 200 no auth', async () => {
        const app = express(); app.get('/health', (_r, res) => res.json({ ok: true }));
        const r = await supertest(app).get('/health');
        assert.strictEqual(r.status, 200);
    });

    process.env.AUTH_MODE = 'headers';
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 25 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
