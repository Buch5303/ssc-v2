'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const logger = require('../src/common/logger');
const auditTrail = require('../src/services/audit-trail');
const { checkRateLimit, DEFAULT_LIMITS } = require('../src/middleware/rate-limit');
const approvalService = require('../src/services/approval-service');
const policyRegistry = require('../src/services/approval-policy-registry');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d28';
const UA = 'ua-d28'; const UB = 'ub-d28';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function runTests() {
    console.log('\n========================================');
    console.log('Day 28: Logging, Audit Trail & Rate Limiting');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    const m019 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8');
    db._raw.exec(m019);
    policyRegistry.clearOrgPolicies();

    // ── 1. STRUCTURED LOGGER ───────────────────────────────
    console.log('\n--- 1. Structured Logger ---');

    await test('logger emits JSON with required fields', async () => {
        let captured = null;
        logger.configure({ output: (e) => { captured = e; }, level: 'DEBUG' });
        logger.info('test-component', 'hello world', { org_id: ORG });
        assert.ok(captured);
        assert.ok(captured.ts);
        assert.strictEqual(captured.level, 'INFO');
        assert.strictEqual(captured.component, 'test-component');
        assert.strictEqual(captured.msg, 'hello world');
        assert.strictEqual(captured.org_id, ORG);
    });
    await test('log levels filter correctly', async () => {
        let count = 0;
        logger.configure({ output: () => { count++; }, level: 'WARN' });
        logger.debug('x', 'skip');
        logger.info('x', 'skip');
        logger.warn('x', 'show');
        logger.error('x', 'show');
        assert.strictEqual(count, 2);
    });
    await test('silent mode suppresses all output', async () => {
        let count = 0;
        logger.configure({ output: () => { count++; }, silent: true });
        logger.error('x', 'should not emit');
        assert.strictEqual(count, 0);
        logger.configure({ silent: false });
    });
    await test('forRequest creates scoped logger', async () => {
        let captured = null;
        logger.configure({ output: (e) => { captured = e; }, level: 'DEBUG', silent: false });
        const rl = logger.forRequest({ identity: { orgId: ORG, userId: UA }, headers: {} });
        rl.info('route', 'request started');
        assert.ok(captured.data.request_id);
        assert.strictEqual(captured.data.org_id, ORG);
        assert.strictEqual(captured.data.user_id, UA);
    });
    await test('forRequest handles missing identity', async () => {
        let captured = null;
        logger.configure({ output: (e) => { captured = e; }, level: 'DEBUG' });
        const rl = logger.forRequest({ headers: {} });
        rl.info('route', 'no identity');
        assert.strictEqual(captured.data.org_id, null);
    });

    // ── 2. IMMUTABLE AUDIT TRAIL ───────────────────────────
    console.log('\n--- 2. Immutable Audit Trail ---');

    await test('record audit event', async () => {
        const r = await auditTrail.record(db, {
            event_type: 'APPROVAL_CREATED', org_id: ORG, actor_user_id: UA,
            target_type: 'workflow', target_id: 'wf-1', action_key: 'workflow:execute',
            outcome: 'PENDING', detail: { reason: 'bulk escalation' },
        });
        assert.strictEqual(r.success, true);
    });
    await test('query audit events', async () => {
        const r = await auditTrail.query(db, { org_id: ORG });
        assert.strictEqual(r.success, true);
        assert.ok(r.events.length >= 1);
        assert.strictEqual(r.events[0].org_id, ORG);
    });
    await test('query by event_type', async () => {
        await auditTrail.record(db, { event_type: 'EXECUTION_CLEAR', org_id: ORG, actor_user_id: UA, outcome: 'EXECUTED' });
        const r = await auditTrail.query(db, { org_id: ORG, event_type: 'EXECUTION_CLEAR' });
        assert.ok(r.events.length >= 1);
        assert.ok(r.events.every(e => e.event_type === 'EXECUTION_CLEAR'));
    });
    await test('query by actor', async () => {
        const r = await auditTrail.query(db, { org_id: ORG, actor_user_id: UA });
        assert.ok(r.events.length >= 1);
    });
    await test('audit log is append-only (DELETE blocked)', async () => {
        let error = null;
        try { db.prepare('DELETE FROM governance_audit_log WHERE id = 1').run(); }
        catch (e) { error = e.message; }
        assert.ok(error && error.includes('AUDIT_VIOLATION'));
    });
    await test('audit log is immutable (UPDATE blocked)', async () => {
        let error = null;
        try { db.prepare("UPDATE governance_audit_log SET outcome = 'HACKED' WHERE id = 1").run(); }
        catch (e) { error = e.message; }
        assert.ok(error && error.includes('AUDIT_VIOLATION'));
    });
    await test('incomplete event rejected', async () => {
        const _r64 = await auditTrail.record(db, { event_type: 'X' });
        assert.strictEqual(_r64.success, false);
    });
    await test('null event rejected', async () => {
        const _r65 = await auditTrail.record(db, null);
        assert.strictEqual(_r65.success, false);
    });
    await test('query pagination works', async () => {
        for (let i = 0; i < 5; i++) {
            await auditTrail.record(db, { event_type: 'APPROVAL_CREATED', org_id: ORG, actor_user_id: UA, outcome: 'PENDING' });
        }
        const r = await auditTrail.query(db, { org_id: ORG, limit: 3 });
        assert.ok(r.events.length <= 3);
        assert.ok(r.total >= 5);
    });
    await test('query returns parsed JSON fields', async () => {
        await auditTrail.record(db, { event_type: 'GOVERNANCE_ERROR', org_id: ORG, actor_user_id: UA, outcome: 'ERROR', policy_applied: { mode: 'DUAL' }, detail: { msg: 'test' } });
        const r = await auditTrail.query(db, { org_id: ORG, event_type: 'GOVERNANCE_ERROR' });
        assert.ok(r.events.length >= 1);
        assert.strictEqual(r.events[0].policy_applied.mode, 'DUAL');
        assert.strictEqual(r.events[0].detail_json.msg, 'test');
    });
    await test('audit events have timestamps', async () => {
        const r = await auditTrail.query(db, { org_id: ORG, limit: 1 });
        assert.ok(r.events[0].created_at);
    });

    // ── 3. RATE LIMITING ───────────────────────────────────
    console.log('\n--- 3. Rate Limiting ---');

    await test('first request allowed', async () => {
        const r = await checkRateLimit(db, ORG, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.current, 1);
    });
    await test('second request increments', async () => {
        const r = await checkRateLimit(db, ORG, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
        assert.ok(r.current >= 2);
    });
    await test('different org is independent', async () => {
        const r = await checkRateLimit(db, 'org-other', 'workflow:execute');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.current, 1);
    });
    await test('different action is independent', async () => {
        const r = await checkRateLimit(db, ORG, 'approval:approve');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.current, 1);
    });
    await test('exceeding limit blocks', async () => {
        // Use a very low limit action
        const testKey = 'test:limited';
        // Manually insert at limit
        const windowStart = Math.floor(Date.now() / (60 * 60000)).toString();
        db.prepare('INSERT OR REPLACE INTO rate_limit_entries (key, org_id, window_start, count) VALUES (?, ?, ?, ?)').run(testKey, ORG, windowStart, 300);
        const r = await checkRateLimit(db, ORG, testKey);
        assert.strictEqual(r.allowed, false);
        assert.ok(r.error.includes('rate_limit_exceeded'));
    });
    await test('null db fails open', async () => {
        const r = await checkRateLimit(null, ORG, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
    });
    await test('null org allowed', async () => {
        const r = await checkRateLimit(db, null, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
    });
    await test('default limits are defined', async () => {
        assert.ok(DEFAULT_LIMITS['workflow:execute']);
        assert.ok(DEFAULT_LIMITS['approval:approve']);
        assert.ok(DEFAULT_LIMITS['_default']);
        assert.ok(DEFAULT_LIMITS['_default'].max > 0);
        assert.ok(DEFAULT_LIMITS['_default'].window_minutes > 0);
    });

    // ── 4. FILE GUARDS ─────────────────────────────────────
    console.log('\n--- 4. File Guards ---');

    await test('logger.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'common', 'logger.js'))); });
    await test('audit-trail.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'audit-trail.js'))); });
    await test('rate-limit.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'middleware', 'rate-limit.js'))); });
    await test('migration 019 exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'))); });

    // Cleanup
    logger.configure({ output: (e) => console.log(JSON.stringify(e)), silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 28 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
