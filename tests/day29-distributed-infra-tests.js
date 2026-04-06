'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const { withTransaction, withRowLock, withAdvisoryLock, detectMode, DB_MODE } = require('../src/db/adapter');
const { requireTenant, validateTenantAccess, scopedQuery } = require('../src/middleware/tenant-isolation');
const { enqueue, processNext, getJobResult, queueLength, processedCount, reset: resetQueue, JOB_STATUS } = require('../src/services/worker-queue');
const metrics = require('../src/common/metrics');
const approvalService = require('../src/services/approval-service');
const policyRegistry = require('../src/services/approval-policy-registry');
const auditTrail = require('../src/services/audit-trail');
const logger = require('../src/common/logger');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d29'; const OX = 'org-other-d29';
const UA = 'ua-d29'; const UB = 'ub-d29'; const UC = 'uc-d29';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function runTests() {
    console.log('\n========================================');
    console.log('Day 29: Distributed Infrastructure Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true });

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    const m019 = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8');
    db._raw.exec(m019);
    policyRegistry.clearOrgPolicies();
    metrics.reset();

    // ── 1. DATABASE ADAPTER ────────────────────────────────
    console.log('\n--- 1. Database Adapter ---');

    await test('detectMode identifies sql.js', async () => {
        assert.strictEqual(detectMode(db), DB_MODE.SQLITE);
    });
    await test('withTransaction commits on success', async () => {
        const result = await withTransaction(db, async () => {
            await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
            return 'ok';
        });
        assert.strictEqual(result, 'ok');
    });
    await test('withTransaction rolls back on error', async () => {
        const countBefore = await db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE org_id = 'txn-rollback'").get().c;
        try {
            await withTransaction(db, async () => {
                await approvalService.createApprovalRequest(db, { org_id: 'txn-rollback', target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
                throw new Error('deliberate');
            });
        } catch { /* expected */ }
        const countAfter = await db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE org_id = 'txn-rollback'").get().c;
        assert.strictEqual(countAfter, countBefore);
    });
    await test('withRowLock returns null for missing row', async () => {
        const result = await withRowLock(db, 'approval_requests', 999999, async () => 'found');
        assert.strictEqual(result, null);
    });
    await test('withRowLock executes fn with row', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const result = await withRowLock(db, 'approval_requests', c.approval_request_id, async (row) => row.org_id);
        assert.strictEqual(result, ORG);
    });
    await test('withAdvisoryLock executes fn', async () => {
        const result = await withAdvisoryLock(db, 'test-lock-key', async () => 42);
        assert.strictEqual(result, 42);
    });

    // ── 2. TENANT ISOLATION ────────────────────────────────
    console.log('\n--- 2. Tenant Isolation ---');

    await test('requireTenant rejects missing org', async () => {
        let status = null;
        const res = { status(c) { status = c; return this; }, json() {} };
        requireTenant({ identity: {} }, res, () => {});
        assert.strictEqual(status, 403);
    });
    await test('requireTenant passes with org', async () => {
        let passed = false;
        requireTenant({ identity: { orgId: ORG } }, {}, () => { passed = true; });
        assert.strictEqual(passed, true);
    });
    await test('requireTenant sets tenantId', async () => {
        const req = { identity: { orgId: ORG } };
        requireTenant(req, {}, () => {});
        assert.strictEqual(req.tenantId, ORG);
    });
    await test('validateTenantAccess allows matching org', async () => {
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, ORG), true);
    });
    await test('validateTenantAccess denies mismatched org', async () => {
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, OX), false);
    });
    await test('validateTenantAccess denies null row', async () => {
        assert.strictEqual(validateTenantAccess(null, ORG), false);
    });
    await test('validateTenantAccess denies null org', async () => {
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, null), false);
    });
    await test('scopedQuery requires org_id', async () => {
        assert.throws(() => scopedQuery(db, 'SELECT * FROM approval_requests', [], null), /org_id required/);
    });
    await test('scopedQuery rejects queries without org_id filter', async () => {
        assert.throws(() => scopedQuery(db, 'SELECT * FROM approval_requests WHERE id = ?', [1], ORG), /must filter by org_id/);
    });
    await test('scopedQuery allows org_id filtered queries', async () => {
        const rows = scopedQuery(db, 'SELECT * FROM approval_requests WHERE org_id = ?', [ORG], ORG);
        assert.ok(Array.isArray(rows));
    });

    // ── 3. WORKER QUEUE ────────────────────────────────────
    console.log('\n--- 3. Background Worker Queue ---');
    resetQueue();

    await test('enqueue validates required fields', async () => {
        assert.strictEqual(enqueue(null).success, false);
        assert.strictEqual(enqueue({ job_key: 'j1' }).error, 'org_id_required');
        assert.strictEqual(enqueue({ job_key: 'j1', org_id: ORG }).error, 'actor_user_id_required');
    });
    await test('enqueue succeeds with valid job', async () => {
        const r = enqueue({ job_key: 'wq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, JOB_STATUS.QUEUED);
    });
    await test('duplicate enqueue skipped', async () => {
        const r = enqueue({ job_key: 'wq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, JOB_STATUS.SKIPPED);
    });
    await test('processNext executes through governance gate', async () => {
        const r = await processNext(db, () => ({ success: true, data: 'result' }));
        assert.strictEqual(r.status, JOB_STATUS.COMPLETED);
        assert.strictEqual(r.job_key, 'wq-1');
    });
    await test('processed job cannot be re-enqueued', async () => {
        const r = enqueue({ job_key: 'wq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, JOB_STATUS.SKIPPED);
        assert.strictEqual(r.message, 'already_processed');
    });
    await test('getJobResult returns completed result', async () => {
        const r = getJobResult('wq-1');
        assert.ok(r);
        assert.strictEqual(r.status, JOB_STATUS.COMPLETED);
    });
    await test('bulk job blocked by governance', async () => {
        enqueue({ job_key: 'wq-bulk', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf2', action_type: 'execute', is_bulk: true });
        const r = await processNext(db);
        assert.strictEqual(r.status, JOB_STATUS.BLOCKED);
        assert.ok(r.approval_request_id);
    });
    await test('empty queue returns EMPTY', async () => {
        const r = await processNext(db);
        assert.strictEqual(r.status, 'EMPTY');
    });
    await test('processedCount tracks completions', async () => {
        assert.ok(processedCount() >= 1);
    });

    // ── 4. METRICS / OBSERVABILITY ─────────────────────────
    console.log('\n--- 4. Observability ---');
    metrics.reset();

    await test('counter increments', async () => {
        metrics.increment('requests.total');
        metrics.increment('requests.total');
        assert.strictEqual(metrics.getCounter('requests.total'), 2);
    });
    await test('counter with tags is independent', async () => {
        metrics.increment('requests.total', { org: ORG });
        assert.strictEqual(metrics.getCounter('requests.total', { org: ORG }), 1);
        assert.strictEqual(metrics.getCounter('requests.total'), 2);
    });
    await test('recordLatency tracks stats', async () => {
        metrics.recordLatency('approval.latency', 50);
        metrics.recordLatency('approval.latency', 100);
        metrics.recordLatency('approval.latency', 150);
        const h = metrics.getHistogram('approval.latency');
        assert.strictEqual(h.count, 3);
        assert.strictEqual(h.min_ms, 50);
        assert.strictEqual(h.max_ms, 150);
        assert.strictEqual(h.avg_ms, 100);
    });
    await test('gauge sets and reads', async () => {
        metrics.setGauge('queue.depth', 5);
        assert.strictEqual(metrics.getGauge('queue.depth'), 5);
    });
    await test('startTimer measures elapsed', async () => {
        const timer = metrics.startTimer();
        // Simulate some work
        let x = 0; for (let i = 0; i < 100000; i++) x += i;
        const ms = timer.end('test.timer');
        assert.ok(ms >= 0);
        assert.ok(metrics.getHistogram('test.timer'));
    });
    await test('snapshot returns all metrics', async () => {
        const s = metrics.snapshot();
        assert.ok(s.counters);
        assert.ok(s.gauges);
        assert.ok(s.histograms);
        assert.ok(s.timestamp);
    });
    await test('healthProbe returns status', async () => {
        const h = metrics.healthProbe(db);
        assert.strictEqual(h.status, 'healthy');
        assert.ok(h.uptime_s >= 0);
        assert.ok(h.metrics);
    });
    await test('alert hook fires on threshold', async () => {
        let fired = null;
        metrics.onAlert((a) => { fired = a; });
        metrics.checkAlert('errors.total', 100, 50);
        assert.ok(fired);
        assert.strictEqual(fired.name, 'errors.total');
        assert.strictEqual(fired.value, 100);
    });
    await test('alert hook does not fire below threshold', async () => {
        let fired = false;
        metrics.reset();
        metrics.onAlert(() => { fired = true; });
        metrics.checkAlert('errors.total', 10, 50);
        assert.strictEqual(fired, false);
    });

    // ── 5. SIMULATED MULTI-INSTANCE RACES ──────────────────
    console.log('\n--- 5. Multi-Instance Race Simulation ---');
    db.exec('DELETE FROM approval_requests');

    await test('concurrent dual approval — same user blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        // Simulate two nodes trying to be first approver
        const r1 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(r1.request.request_status, 'PENDING'); // first approval
        // Same user on second node
        const r2 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(r2.success, false);
        assert.strictEqual(r2.error, 'dual_approval_requires_different_approvers');
    });
    await test('concurrent dual approval — different users succeed', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r2 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r2.request.request_status, 'APPROVED');
    });
    await test('approve-after-reject race blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, false);
    });
    await test('idempotent approve returns success', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.idempotent, true);
    });

    // ── 6. RETRY STORM SIMULATION ──────────────────────────
    console.log('\n--- 6. Retry Storm Simulation ---');
    resetQueue();

    await test('same job enqueued 10 times only processes once', async () => {
        for (let i = 0; i < 10; i++) {
            enqueue({ job_key: 'storm-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf-storm', action_type: 'execute' });
        }
        assert.strictEqual(queueLength(), 1);
        await processNext(db);
        assert.ok(processedCount() >= 1);
        // Re-enqueue after completion
        const r = enqueue({ job_key: 'storm-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf-storm', action_type: 'execute' });
        assert.strictEqual(r.status, JOB_STATUS.SKIPPED);
        assert.strictEqual(r.message, 'already_processed');
    });
    await test('10 unique jobs all process', async () => {
        resetQueue();
        for (let i = 0; i < 10; i++) {
            enqueue({ job_key: 'batch-' + i, org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf-' + i, action_type: 'execute' });
        }
        assert.strictEqual(queueLength(), 10);
        let completed = 0;
        while (queueLength() > 0) {
            const r = await processNext(db);
            if (r.status === JOB_STATUS.COMPLETED) completed++;
        }
        assert.strictEqual(completed, 10);
    });

    // ── 7. CROSS-TENANT ISOLATION ──────────────────────────
    console.log('\n--- 7. Cross-Tenant Tests ---');
    db.exec('DELETE FROM approval_requests');

    await test('org A cannot read org B approvals', async () => {
        await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const r = await approvalService.listApprovalRequests(db, { org_id: OX });
        assert.strictEqual(r.requests.filter(x => x.org_id === ORG).length, 0);
    });
    await test('org A cannot approve org B request', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, org_id: OX });
        assert.strictEqual(r.success, false);
    });

    // ── 8. FILE GUARDS ─────────────────────────────────────
    console.log('\n--- 8. File Guards ---');

    await test('adapter.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'adapter.js'))); });
    await test('tenant-isolation.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'middleware', 'tenant-isolation.js'))); });
    await test('worker-queue.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'worker-queue.js'))); });
    await test('metrics.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'common', 'metrics.js'))); });
    await test('migration 020 exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '020-day29-postgresql.sql'))); });

    // Cleanup
    logger.configure({ silent: false });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 29 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
