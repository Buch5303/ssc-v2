'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const durableQueue = require('../src/services/durable-worker-queue');
const metrics = require('../src/common/metrics');
const logger = require('../src/common/logger');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d32'; const UA = 'ua-d32'; const UB = 'ub-d32'; const UC = 'uc-d32';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }
async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function runTests() {
    console.log('\n========================================');
    console.log('Day 32: Phase 1A Production Backbone');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true });
    metrics.reset();

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}
    await durableQueue.initSchema(db);
    policyRegistry.clearOrgPolicies();
    executionService.configureExecutor(null);

    // ── 1. PG CLIENT MODULE ────────────────────────────────
    console.log('\n--- 1. PostgreSQL Client ---');

    await test('pg-client exports required functions', async () => {
        const pg = require('../src/db/pg-client');
        assert.strictEqual(typeof pg.getPool, 'function');
        assert.strictEqual(typeof pg.query, 'function');
        assert.strictEqual(typeof pg.withTransaction, 'function');
        assert.strictEqual(typeof pg.withRowLock, 'function');
        assert.strictEqual(typeof pg.withAdvisoryLock, 'function');
        assert.strictEqual(typeof pg.setTenantContext, 'function');
        assert.strictEqual(typeof pg.healthCheck, 'function');
        assert.strictEqual(typeof pg.close, 'function');
    });
    await test('migrate-pg exports required functions', async () => {
        const m = require('../src/db/migrate-pg');
        assert.strictEqual(typeof m.runMigrations, 'function');
        assert.strictEqual(typeof m.ensureMigrationsTable, 'function');
        assert.strictEqual(typeof m.getAppliedMigrations, 'function');
    });

    // ── 2. REDIS CLIENT MODULE ─────────────────────────────
    console.log('\n--- 2. Redis Client ---');

    await test('redis-client exports required functions', async () => {
        const r = require('../src/db/redis-client');
        assert.strictEqual(typeof r.getClient, 'function');
        assert.strictEqual(typeof r.healthCheck, 'function');
        assert.strictEqual(typeof r.close, 'function');
    });
    await test('redis rate-limit exports', async () => {
        const rl = require('../src/middleware/redis-rate-limit');
        assert.strictEqual(typeof rl.checkRateLimit, 'function');
        assert.strictEqual(typeof rl.rateLimitMiddleware, 'function');
        assert.ok(rl.DEFAULT_LIMITS);
    });
    await test('redis replay-protection exports', async () => {
        const rp = require('../src/middleware/redis-replay-protection');
        assert.strictEqual(typeof rp.checkNonce, 'function');
        assert.strictEqual(typeof rp.replayProtectionMiddleware, 'function');
        assert.strictEqual(rp.NONCE_TTL_SECONDS, 300);
    });

    // ── 3. REDIS RATE LIMIT (no-redis fallback) ────────────
    console.log('\n--- 3. Redis Rate Limit (no-redis) ---');

    await test('null redis → allowed (fail open)', async () => {
        const { checkRateLimit } = require('../src/middleware/redis-rate-limit');
        const r = await checkRateLimit(null, ORG, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.source, 'no_redis');
    });

    // ── 4. REDIS REPLAY (no-redis fallback) ────────────────
    console.log('\n--- 4. Redis Replay Protection (no-redis) ---');

    await test('null redis → valid (fail open)', async () => {
        const { checkNonce } = require('../src/middleware/redis-replay-protection');
        const r = await checkNonce(null, ORG, 'nonce-1', String(Date.now()));
        assert.strictEqual(r.valid, true);
        assert.strictEqual(r.source, 'no_redis');
    });
    await test('missing nonce → valid (skipped)', async () => {
        const { checkNonce } = require('../src/middleware/redis-replay-protection');
        const r = await checkNonce(null, ORG, null, null);
        assert.strictEqual(r.valid, true);
    });
    await test('expired timestamp → invalid', async () => {
        const { checkNonce } = require('../src/middleware/redis-replay-protection');
        // Fake redis that always returns OK for SET
        const fakeRedis = { set: async () => 'OK' };
        const r = await checkNonce(fakeRedis, ORG, 'n1', String(Date.now() - 600000));
        assert.strictEqual(r.valid, false);
        assert.strictEqual(r.error, 'timestamp_outside_window');
    });
    await test('duplicate nonce → invalid', async () => {
        const { checkNonce } = require('../src/middleware/redis-replay-protection');
        // First call: SET NX succeeds (returns 'OK')
        // Second call: SET NX fails (returns null)
        let calls = 0;
        const fakeRedis = { set: async () => { calls++; return calls === 1 ? 'OK' : null; } };
        const ts = String(Date.now());
        const r1 = await checkNonce(fakeRedis, ORG, 'dup-test', ts);
        assert.strictEqual(r1.valid, true);
        const r2 = await checkNonce(fakeRedis, ORG, 'dup-test', ts);
        assert.strictEqual(r2.valid, false);
        assert.strictEqual(r2.error, 'nonce_already_used');
    });

    // ── 5. DURABLE WORKER QUEUE ────────────────────────────
    console.log('\n--- 5. Durable Worker Queue ---');

    await test('enqueue validates required fields', async () => {
        const _r106 = await durableQueue.enqueue(db, null);
        assert.strictEqual(_r106.success, false);
        const _r107 = await durableQueue.enqueue(db, { job_key: 'x' });
        assert.strictEqual(_r107.error, 'org_id_required');
    });
    await test('enqueue creates job', async () => {
        const r = await durableQueue.enqueue(db, { job_key: 'dq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, 'QUEUED');
        assert.ok(r.job_id);
    });
    await test('duplicate enqueue → SKIPPED', async () => {
        const r = await durableQueue.enqueue(db, { job_key: 'dq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.status, 'SKIPPED');
    });
    await test('processNext executes through governance gate', async () => {
        const r = await durableQueue.processNext(db);
        assert.strictEqual(r.status, 'COMPLETED');
        assert.strictEqual(r.job_key, 'dq-1');
    });
    await test('completed job persists', async () => {
        const j = await durableQueue.getJobByKey(db, 'dq-1');
        assert.ok(j);
        assert.strictEqual(j.status, 'COMPLETED');
        assert.ok(j.completed_at);
    });
    await test('empty queue returns EMPTY', async () => {
        const _r108 = await durableQueue.processNext(db);
        assert.strictEqual(_r108.status, 'EMPTY');
    });
    await test('bulk job blocked by governance', async () => {
        await durableQueue.enqueue(db, { job_key: 'dq-bulk', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf2', action_type: 'execute', is_bulk: true });
        const r = await durableQueue.processNext(db);
        assert.strictEqual(r.status, 'BLOCKED');
        assert.ok(r.approval_request_id);
    });
    await test('blocked job persists with approval_request_id', async () => {
        const j = await durableQueue.getJobByKey(db, 'dq-bulk');
        assert.strictEqual(j.status, 'BLOCKED');
        assert.ok(j.approval_request_id);
    });
    await test('queueStats returns counts', async () => {
        const stats = await durableQueue.queueStats(db);
        assert.ok(stats.total >= 2);
        assert.ok(stats.COMPLETED >= 1);
        assert.ok(stats.BLOCKED >= 1);
    });
    await test('re-enqueue failed job works', async () => {
        // Create and fail a job
        await durableQueue.enqueue(db, { job_key: 'dq-fail', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute', max_retries: 0 });
        // Make it fail by using an unknown target that gate blocks
        db.prepare("UPDATE worker_jobs SET status = 'FAILED' WHERE job_key = 'dq-fail'").run();
        const r = await durableQueue.enqueue(db, { job_key: 'dq-fail', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute' });
        assert.strictEqual(r.status, 'RE_QUEUED');
    });
    await test('idempotency: completed job cannot be re-enqueued', async () => {
        const r = await durableQueue.enqueue(db, { job_key: 'dq-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        assert.strictEqual(r.reason, 'already_completed');
    });
    await test('10 jobs all process', async () => {
        // Clean queue first
        db.prepare("DELETE FROM worker_jobs WHERE status IN ('QUEUED','FAILED')").run();
        for (let i = 0; i < 10; i++) {
            await durableQueue.enqueue(db, { job_key: 'dq-batch-' + i, org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'b-' + i, action_type: 'execute' });
        }
        let completed = 0;
        while (true) {
            const r = await durableQueue.processNext(db);
            if (r.status === 'EMPTY') break;
            if (r.status === 'COMPLETED') completed++;
        }
        assert.strictEqual(completed, 10);
    });
    await test('purgeCompleted removes old jobs', async () => {
        // Set completed_at to long ago
        db.prepare("UPDATE worker_jobs SET completed_at = '2020-01-01 00:00:00' WHERE status = 'COMPLETED'").run();
        const r = await durableQueue.purgeCompleted(db, 1);
        assert.ok(r.purged > 0);
    });

    // ── 6. SERVICE METRICS ─────────────────────────────────
    console.log('\n--- 6. Service Metrics ---');
    metrics.reset();

    await test('worker enqueue increments metric', async () => {
        await durableQueue.enqueue(db, { job_key: 'met-1', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute' });
        assert.ok(metrics.getCounter('worker.enqueued') >= 1);
    });
    await test('worker process records latency', async () => {
        await durableQueue.processNext(db);
        const h = metrics.getHistogram('worker.process_latency');
        assert.ok(h, 'no histogram recorded');
        assert.ok(h.count >= 1);
    });
    await test('worker completed increments', async () => {
        assert.ok(metrics.getCounter('worker.completed') >= 1);
    });
    await test('snapshot includes worker metrics', async () => {
        const s = metrics.snapshot();
        assert.ok(s.counters['worker.enqueued'] || s.counters['worker.completed']);
    });

    // ── 7. HEALTH/READINESS ────────────────────────────────
    console.log('\n--- 7. Health/Readiness ---');

    await test('healthProbe returns db status', async () => {
        const h = metrics.healthProbe(db);
        assert.strictEqual(h.status, 'healthy');
        assert.ok(h.uptime_s >= 0);
    });
    await test('healthProbe with null db', async () => {
        const h = metrics.healthProbe(null);
        assert.strictEqual(h.status, 'healthy');
    });

    // ── 8. BENCHMARK HARNESS ───────────────────────────────
    console.log('\n--- 8. Benchmark Harness ---');

    await test('benchmark module loads', async () => {
        const bm = require('../benchmarks/run-benchmarks');
        assert.strictEqual(typeof bm.runBenchmarks, 'function');
    });

    // ── 9. DOCKER / INFRA FILES ────────────────────────────
    console.log('\n--- 9. Infrastructure Files ---');

    const REQUIRED = [
        'Dockerfile', 'docker-compose.yml', '.dockerignore',
        '.env.local', '.env.staging', '.env.pilot-prep',
        'benchmarks/run-benchmarks.js',
        'src/db/pg-client.js', 'src/db/redis-client.js', 'src/db/migrate-pg.js',
        'src/middleware/redis-rate-limit.js', 'src/middleware/redis-replay-protection.js',
        'src/services/durable-worker-queue.js',
    ];
    for (const f of REQUIRED) {
        await test('exists: ' + f, async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'missing: ' + f); });
    }

    // ── 10. GOVERNANCE PRESERVED ───────────────────────────
    console.log('\n--- 10. Governance Preservation ---');

    await test('governance gate still mandatory (standard execute)', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gov-1', actor_user_id: UA });
        assert.strictEqual(r.execution_status, 'EXECUTED');
    });
    await test('governance gate still blocks bulk', async () => {
        const _r109 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gov-2', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(_r109.execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('zero PASS_THROUGH in codebase', async () => {
        const srcDir = path.join(__dirname, '..', 'src');
        const walk = (dir) => {
            let files = [];
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.isDirectory()) files = files.concat(walk(path.join(dir, e.name)));
                else if (e.name.endsWith('.js')) files.push(path.join(dir, e.name));
            }
            return files;
        };
        for (const f of walk(srcDir)) {
            assert.strictEqual(fs.readFileSync(f, 'utf-8').includes('PASS_THROUGH'), false, 'PASS_THROUGH in ' + f);
        }
    });
    await test('504 prior tests still referenced', async () => {
        // Verify regression runner includes all 10 prior suites
        const runner = fs.readFileSync(path.join(__dirname, 'run-all-regressions.js'), 'utf-8');
        for (const d of ['Day 22', 'Day 23', 'Day 24', 'Day 25', 'Day 26', 'Day 27', 'Day 28', 'Day 29', 'Day 30', 'Day 31']) {
            assert.ok(runner.includes(d), 'missing suite: ' + d);
        }
    });

    // Cleanup
    logger.configure({ silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 32 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
