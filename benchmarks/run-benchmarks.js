'use strict';

/**
 * Phase 1A: Benchmark Harness
 *
 * Tests against sql.js (local). For PG/Redis benchmarks,
 * run with docker-compose up first, then:
 *   DATABASE_URL=... REDIS_URL=... node benchmarks/run-benchmarks.js
 */

const path = require('path');
const fs = require('fs');

async function runBenchmarks() {
    const { createDatabase } = require('../tests/test-db-helper');
    const approvalService = require('../src/services/approval-service');
    const executionService = require('../src/services/workflow-execution-service');
    const policyRegistry = require('../src/services/approval-policy-registry');
    const durableQueue = require('../src/services/durable-worker-queue');
    const logger = require('../src/common/logger');
    logger.configure({ silent: true });

    console.log('═══════════════════════════════════════');
    console.log(' SSC V2 — Benchmark Suite');
    console.log('═══════════════════════════════════════');
    console.log(' Mode: sql.js (in-memory)');
    console.log(' Time: ' + new Date().toISOString());
    console.log('');

    const db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}
    durableQueue.initSchema(db);
    policyRegistry.clearOrgPolicies();
    executionService.configureExecutor(null);

    const results = {};

    // B1: Approval creation latency
    {
        const N = 100;
        const start = Date.now();
        for (let i = 0; i < N; i++) {
            approvalService.createApprovalRequest(db, {
                org_id: 'bench-org', target_type: 'workflow', action_key: 'workflow:execute',
                requested_by_user_id: 'bench-user-' + i,
            });
        }
        const elapsed = Date.now() - start;
        results['approval_create'] = { ops: N, total_ms: elapsed, avg_ms: (elapsed / N).toFixed(2), ops_per_sec: Math.round(N / (elapsed / 1000)) };
        console.log('B1 Approval Create:  ' + N + ' ops in ' + elapsed + 'ms  (' + results['approval_create'].avg_ms + ' ms/op, ' + results['approval_create'].ops_per_sec + ' ops/s)');
    }

    // B2: Approval flow (create → approve)
    {
        const N = 50;
        const start = Date.now();
        for (let i = 0; i < N; i++) {
            const c = approvalService.createApprovalRequest(db, {
                org_id: 'bench-org', target_type: 'workflow', action_key: 'workflow:execute',
                requested_by_user_id: 'requester-' + i,
            });
            approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: 'approver-' + i });
        }
        const elapsed = Date.now() - start;
        results['approval_flow'] = { ops: N, total_ms: elapsed, avg_ms: (elapsed / N).toFixed(2), ops_per_sec: Math.round(N / (elapsed / 1000)) };
        console.log('B2 Approval Flow:    ' + N + ' ops in ' + elapsed + 'ms  (' + results['approval_flow'].avg_ms + ' ms/op, ' + results['approval_flow'].ops_per_sec + ' ops/s)');
    }

    // B3: Workflow execution latency
    {
        const N = 100;
        const start = Date.now();
        for (let i = 0; i < N; i++) {
            executionService.executeWorkflow(db, { org_id: 'bench-org', workflow_id: 'wf-bench-' + i, actor_user_id: 'user-' + i });
        }
        const elapsed = Date.now() - start;
        results['workflow_execute'] = { ops: N, total_ms: elapsed, avg_ms: (elapsed / N).toFixed(2), ops_per_sec: Math.round(N / (elapsed / 1000)) };
        console.log('B3 Workflow Execute:  ' + N + ' ops in ' + elapsed + 'ms  (' + results['workflow_execute'].avg_ms + ' ms/op, ' + results['workflow_execute'].ops_per_sec + ' ops/s)');
    }

    // B4: Replay rejection latency
    {
        const e = executionService.executeWorkflow(db, { org_id: 'bench-org', workflow_id: 'replay-bench', actor_user_id: 'u1', is_bulk: true });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: 'a1', org_id: 'bench-org' });
        approvalService.approveApprovalRequest(db, e.approval_request_id, { actor_user_id: 'a2', org_id: 'bench-org' });
        executionService.replayApprovedExecution(db, { org_id: 'bench-org', execution_id: e.execution_id, actor_user_id: 'r1' });

        const N = 100;
        const start = Date.now();
        for (let i = 0; i < N; i++) {
            executionService.replayApprovedExecution(db, { org_id: 'bench-org', execution_id: e.execution_id, actor_user_id: 'r' + i });
        }
        const elapsed = Date.now() - start;
        results['replay_reject'] = { ops: N, total_ms: elapsed, avg_ms: (elapsed / N).toFixed(2), ops_per_sec: Math.round(N / (elapsed / 1000)) };
        console.log('B4 Replay Reject:    ' + N + ' ops in ' + elapsed + 'ms  (' + results['replay_reject'].avg_ms + ' ms/op, ' + results['replay_reject'].ops_per_sec + ' ops/s)');
    }

    // B5: Durable queue processing
    {
        const N = 50;
        for (let i = 0; i < N; i++) {
            durableQueue.enqueue(db, { job_key: 'bench-q-' + i, org_id: 'bench-org', actor_user_id: 'u-' + i, target_type: 'workflow', target_id: 'wf-' + i, action_type: 'execute' });
        }
        const start = Date.now();
        let processed = 0;
        while (true) {
            const r = durableQueue.processNext(db);
            if (r.status === 'EMPTY') break;
            if (r.status === 'COMPLETED') processed++;
        }
        const elapsed = Date.now() - start;
        results['queue_process'] = { ops: processed, total_ms: elapsed, avg_ms: processed > 0 ? (elapsed / processed).toFixed(2) : 0, ops_per_sec: processed > 0 ? Math.round(processed / (elapsed / 1000)) : 0 };
        console.log('B5 Queue Process:    ' + processed + ' jobs in ' + elapsed + 'ms  (' + results['queue_process'].avg_ms + ' ms/job, ' + results['queue_process'].ops_per_sec + ' jobs/s)');
    }

    // B6: Persistence check — verify data survives after operations
    {
        const stats = durableQueue.queueStats(db);
        const approvals = approvalService.listApprovalRequests(db, { org_id: 'bench-org' });
        results['persistence'] = { queue_total: stats.total, approvals_total: approvals.total, persisted: stats.total > 0 && approvals.total > 0 };
        console.log('B6 Persistence:      queue=' + stats.total + ' approvals=' + approvals.total + ' persisted=' + results['persistence'].persisted);
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(' Summary');
    console.log('═══════════════════════════════════════');
    for (const [k, v] of Object.entries(results)) {
        console.log('  ' + k + ': ' + JSON.stringify(v));
    }
    console.log('');

    db.close();
    logger.configure({ silent: false });
    return results;
}

if (require.main === module) {
    runBenchmarks().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { runBenchmarks };
