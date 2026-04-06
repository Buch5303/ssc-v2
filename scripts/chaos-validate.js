#!/usr/bin/env node
'use strict';

/**
 * Day 35: Chaos Validation Script
 *
 * Validates resilience behavior under component failure.
 * Run against local sql.js or docker-compose stack.
 *
 * Usage:
 *   node scripts/chaos-validate.js              # local (sql.js)
 *   BASE_URL=http://localhost:3000 node scripts/chaos-validate.js  # remote
 */

const http = require('http');

const BASE = process.env.BASE_URL || null;
let passed = 0, failed = 0;

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; console.log('  ✗ ' + name + ': ' + err.message); }
}

async function fetch(method, path, body) {
    if (BASE) {
        // Remote mode: real HTTP
        return new Promise((resolve, reject) => {
            const url = new URL(path, BASE);
            const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
            if (body && body.headers) { Object.assign(opts.headers, body.headers); body = body.body; }
            const req = http.request(opts, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
            });
            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }
    // Local mode: use supertest against in-process app
    return _localFetch(method, path, body);
}

let _app = null;
let _agent = null;
async function _localFetch(method, path, body) {
    if (!_app) {
        const { createDatabase } = require('../tests/test-db-helper');
        const { createApp } = require('../src/app/integration');
        const fs = require('fs'), pathMod = require('path');
        const policyRegistry = require('../src/services/approval-policy-registry');
        const logger = require('../src/common/logger');
        logger.configure({ silent: true });
        process.env.AUTH_MODE = 'jwt';
        process.env.JWT_SECRET = 'chaos-test-secret-minimum-32-chars';
        const db = await createDatabase();
        const sql = fs.readFileSync(pathMod.join(__dirname, '..', 'src', 'db', 'migrations', '016-day22-approval-governance.sql'), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
        policyRegistry.clearOrgPolicies();
        _app = createApp(db, { redis: null });
        _agent = require('supertest')(_app);
    }
    const ag = _agent;
    let r;
    if (method === 'GET') {
        const req = ag.get(path);
        if (body && body.headers) { for (const [k, v] of Object.entries(body.headers)) req.set(k, v); }
        r = await req;
    } else if (method === 'POST') {
        const payload = (body && body.headers) ? undefined : body;
        const req = ag.post(path);
        if (body && body.headers) { for (const [k, v] of Object.entries(body.headers)) req.set(k, v); }
        r = await req.send(payload || (body && !body.headers ? body : {}));
    }
    return { status: r.status, body: r.body };
}

async function main() {
    console.log('========================================');
    console.log(' Chaos Validation');
    console.log(' Mode: ' + (BASE ? 'remote (' + BASE + ')' : 'local'));
    console.log('========================================');

    // ── 1. Health baseline ──────────────────────────────────
    console.log('\n--- 1. Health Baseline ---');
    await test('health check returns 200', async () => {
        const r = await fetch('GET', '/health');
        if (r.status !== 200) throw new Error('status: ' + r.status);
    });

    // ── 2. Token lifecycle ──────────────────────────────────
    console.log('\n--- 2. Token Lifecycle ---');
    let accessToken, refreshToken;

    await test('issue token pair', async () => {
        const r = await fetch('POST', '/api/auth/token', { user_id: 'chaos-u', org_id: 'chaos-o' });
        if (!r.body.access_token) throw new Error('no access_token');
        accessToken = r.body.access_token;
        refreshToken = r.body.refresh_token;
    });

    await test('access token authenticates', async () => {
        const r = await fetch('GET', '/api/approvals', { headers: { 'Authorization': 'Bearer ' + accessToken }, body: null });
        if (r.status === 401) throw new Error('token rejected');
    });

    await test('refresh token issues new pair', async () => {
        const r = await fetch('POST', '/api/auth/refresh', { refresh_token: refreshToken });
        if (!r.body.access_token) throw new Error('refresh failed: ' + JSON.stringify(r.body));
        accessToken = r.body.access_token; // use new token
    });

    await test('revoke token', async () => {
        const oldToken = accessToken;
        await fetch('POST', '/api/auth/revoke', { token: oldToken });
        // Revoked token should fail auth
        const r = await fetch('GET', '/api/approvals', { headers: { 'Authorization': 'Bearer ' + oldToken }, body: null });
        if (r.status !== 401) throw new Error('revoked token still accepted: status ' + r.status);
    });

    // ── 3. Resilience: app handles missing Redis ────────────
    console.log('\n--- 3. Redis Resilience ---');
    await test('app functions without Redis', async () => {
        const r = await fetch('GET', '/health');
        if (r.status !== 200) throw new Error('unhealthy');
        // redis field should be 'disabled' or present
    });

    // ── 4. Auth enforcement ─────────────────────────────────
    console.log('\n--- 4. Auth Enforcement ---');
    await test('no token → 401', async () => {
        const r = await fetch('GET', '/api/approvals');
        if (r.status !== 401) throw new Error('expected 401, got ' + r.status);
    });

    await test('garbage token → 401', async () => {
        const r = await fetch('GET', '/api/approvals', { headers: { 'Authorization': 'Bearer garbage.token.here' }, body: null });
        if (r.status !== 401) throw new Error('expected 401, got ' + r.status);
    });

    // ── Summary ─────────────────────────────────────────────
    console.log('\n========================================');
    console.log(' Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    return { passed, failed };
}

main().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
