'use strict';

const { buildApp } = require('../src/app/integration');
const { createTestDb } = require('../tests/test-db-helper');

function now() {
  return process.hrtime.bigint();
}

function elapsedMs(start) {
  return Number(now() - start) / 1e6;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function measure(name, iterations, fn) {
  const results = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = now();
    await fn(i);
    results.push(elapsedMs(start));
  }
  return {
    name,
    iterations,
    medianMs: Number(median(results).toFixed(3)),
    minMs: Number(Math.min(...results).toFixed(3)),
    maxMs: Number(Math.max(...results).toFixed(3))
  };
}

async function run() {
  const db = createTestDb();
  const app = await buildApp({ db });

  const authHeaders = {
    'x-user-id': 'bench-user',
    'x-org-id': 'bench-org'
  };

  const bench = [];

  bench.push(await measure('approval_create', 50, async (i) => {
    await app.inject({
      method: 'POST',
      url: '/api/workflows/workflow-' + i + '/execute',
      headers: authHeaders,
      payload: { action: 'delete_record', resourceType: 'decision', resourceId: 'd-' + i }
    });
  }));

  bench.push(await measure('approval_flow', 20, async (i) => {
    const requestId = 'req-' + i;
    const { services } = app.locals;
    await services.approvalService.createRequest({
      requestId,
      orgId: 'bench-org',
      requesterUserId: 'bench-user',
      action: 'bulk_import',
      resourceType: 'supplier',
      resourceId: 'sup-' + i,
      approvalType: 'DUAL',
      reason: 'bench'
    });
    await app.inject({ method: 'POST', url: '/api/approvals/' + requestId + '/approve', headers: { 'x-user-id': 'approver-a', 'x-org-id': 'bench-org' } });
    await app.inject({ method: 'POST', url: '/api/approvals/' + requestId + '/approve', headers: { 'x-user-id': 'approver-b', 'x-org-id': 'bench-org' } });
  }));

  bench.push(await measure('workflow_execute', 30, async (i) => {
    await app.inject({
      method: 'POST',
      url: '/api/workflows/exec-' + i + '/execute',
      headers: authHeaders,
      payload: { action: 'create', resourceType: 'decision', resourceId: 'exec-' + i }
    });
  }));

  bench.push(await measure('replay_reject', 30, async (i) => {
    await app.inject({
      method: 'POST',
      url: '/api/workflows/replay-' + i + '/replay',
      headers: authHeaders,
      payload: { replayKey: 'rk-' + i }
    });
  }));

  bench.push(await measure('queue_process', 20, async (i) => {
    const queue = app.locals.services.durableWorkerQueue;
    const job = await queue.enqueue({
      orgId: 'bench-org',
      workflowId: 'wq-' + i,
      action: 'create',
      resourceType: 'decision',
      resourceId: 'q-' + i,
      requestedBy: 'bench-user'
    });
    await queue.processJob(job.id, async () => ({ ok: true }));
  }));

  bench.push(await measure('persistence_query', 50, async () => {
    await app.inject({
      method: 'GET',
      url: '/api/approvals',
      headers: authHeaders
    });
  }));

  console.log(JSON.stringify({
    benchmarkCount: bench.length,
    results: bench
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
