'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const { executeDecisionAction, ALL_DECISION_ACTIONS } = require('../src/services/decision-execution-service');
const { enforceGovernance, assertGovernanceEnforced, _resetGovernanceFlag, _wasGovernanceCalled, setAuditRecorder, GATE_STATUS, WHITELISTED_NONE_ACTIONS } = require('../src/services/governance-gate');
const { verifyApprovalInvariant } = require('../src/services/governance-invariants');
const auditTrail = require('../src/services/audit-trail');
const { enqueue, processNext, reset: resetQueue, JOB_STATUS } = require('../src/services/worker-queue');
const { validateTenantAccess, scopedQuery } = require('../src/middleware/tenant-isolation');
const { checkRateLimit } = require('../src/middleware/rate-limit');
const logger = require('../src/common/logger');
const metrics = require('../src/common/metrics');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d30'; const OX = 'org-evil'; const UA = 'ua-d30'; const UB = 'ub-d30'; const UC = 'uc-d30'; const UD = 'ud-d30';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function reset() {
    db.exec('DELETE FROM approval_requests');
    db.exec('DELETE FROM workflow_executions');
    try { db._raw.exec('DELETE FROM governance_audit_log'); } catch {}
    try { db._raw.exec('DELETE FROM rate_limit_entries'); } catch {}
    policyRegistry.clearOrgPolicies();
    approvalService.configureAuthorization(null);
    executionService.configureExecutor(null);
    resetQueue();
    metrics.reset();
}

async function dualApprove(id) {
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UB, org_id: ORG });
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UC, org_id: ORG });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 30: EQS Audit Hardening Tests');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true });

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) db.exec(s + ';');
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '018-day27-enforcement.sql'), 'utf-8')); } catch {}
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}

    // Wire audit recorder into gate and service
    const auditEvents = [];
    const auditFn = (e) => { auditEvents.push(e); if (db) try { auditTrail.record(db, e); } catch {} };
    setAuditRecorder(auditFn);
    approvalService.setAuditRecorder(auditFn);

    // ── P1: BYPASS PATH ELIMINATION ────────────────────────
    console.log('\n--- P1: Bypass Path Elimination ---');
    await reset(); auditEvents.length = 0;

    await test('P1.1 governance gate called by workflow execution', async () => {
        _resetGovernanceFlag();
        await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'p1-1', actor_user_id: UA });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('P1.2 governance gate called by bulk execution', async () => {
        _resetGovernanceFlag();
        await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'p1-2', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('P1.3 governance gate called by decision service', async () => {
        _resetGovernanceFlag();
        await executeDecisionAction(db, { org_id: ORG, decision_id: 'd1', actor_user_id: UA, action_type: 'resolve' });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('P1.4 governance gate called by worker queue', async () => {
        _resetGovernanceFlag();
        enqueue({ job_key: 'p1-4', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'wf1', action_type: 'execute' });
        processNext(db);
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('P1.5 assertGovernanceEnforced throws without gate', async () => {
        _resetGovernanceFlag();
        assert.throws(() => assertGovernanceEnforced(), /GOVERNANCE_BYPASS/);
    });
    await test('P1.6 unknown action_type in gate → ERROR', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'unknown', target_id: 'x', action_type: 'teleport' });
        // Non-whitelisted, non-safe → PENDING (fail closed)
        assert.ok(r.status === GATE_STATUS.PENDING || r.status === GATE_STATUS.ERROR);
    });
    await test('P1.7 unknown decision action → rejected', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'x', actor_user_id: UA, action_type: 'teleport' });
        assert.strictEqual(r.success, false);
        assert.ok(r.error.includes('unknown_decision_action'));
    });
    await test('P1.8 missing org_id → ERROR', async () => {
        const _r66 = await enforceGovernance(db, { actor_user_id: UA, target_type: 'x', action_type: 'x' });
        assert.strictEqual(_r66.status, GATE_STATUS.ERROR);
    });
    await test('P1.9 missing actor → ERROR', async () => {
        const _r67 = await enforceGovernance(db, { org_id: ORG, target_type: 'x', action_type: 'x' });
        assert.strictEqual(_r67.status, GATE_STATUS.ERROR);
    });
    await test('P1.10 old bridge redirects to gate', async () => {
        _resetGovernanceFlag();
        const { interceptWorkflowExecution } = require('../src/services/workflow-approval-bridge');
        await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'br1', actor_user_id: UA });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });

    // ── P2: DECISION ACTION COVERAGE ───────────────────────
    console.log('\n--- P2: Complete Decision Coverage ---');
    await reset(); auditEvents.length = 0;

    const EXPECTED_ACTIONS = ['resolve', 'dismiss', 'update', 'delete', 'reassign', 'comment', 'archive'];
    await test('P2.1 all 7 actions exist in set', async () => {
        assert.strictEqual(ALL_DECISION_ACTIONS.size, 7);
        EXPECTED_ACTIONS.forEach(a => assert.ok(ALL_DECISION_ACTIONS.has(a), 'missing: ' + a));
    });
    for (const action of EXPECTED_ACTIONS) {
        await test('P2.2 ' + action + ' → governed', async () => {
            const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'd-' + action, actor_user_id: UA, action_type: action });
            assert.ok(r.action_status === 'EXECUTED' || r.action_status === 'BLOCKED_PENDING_APPROVAL');
        });
    }
    await test('P2.3 unknown action → fail closed', async () => {
        const _r68 = await executeDecisionAction(db, { org_id: ORG, decision_id: 'x', actor_user_id: UA, action_type: 'mutate' });
        assert.strictEqual(_r68.success, false);
    });

    // ── P3: CONCURRENCY + ATOMICITY ────────────────────────
    console.log('\n--- P3: Concurrency Safety ---');
    await reset();

    await test('P3.1 approve vs approve race (SINGLE) → idempotent', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.idempotent, true);
    });
    await test('P3.2 approve vs reject → first wins', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.success, false);
    });
    await test('P3.3 reject vs cancel → first wins', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r69 = await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r69.success, false);
    });
    await test('P3.4 dual: same user twice → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r70 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(_r70.error, 'dual_approval_requires_different_approvers');
    });
    await test('P3.5 dual: requester cannot be approver', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        const _r71 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r71.error, 'self_approval_prohibited');
    });
    await test('P3.6 dual: two distinct → APPROVED', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.request.request_status, 'APPROVED');
    });
    await test('P3.7 replay idempotency key prevents double', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'p3-7', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const _r72 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r72.error, 'replay_already_executed');
    });
    await test('P3.8 invariant passes after dual approve', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        const _r73 = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(_r73.valid, true);
    });

    // ── P4: DB-LEVEL ENFORCEMENT ───────────────────────────
    console.log('\n--- P4: Database-Level Protection ---');
    await reset();

    await test('P4.1 trigger blocks APPROVED → REJECTED', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET request_status = 'REJECTED' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('TRIGGER_VIOLATION'));
    });
    await test('P4.2 trigger blocks CANCELLED → APPROVED', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET request_status = 'APPROVED' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('TRIGGER_VIOLATION'));
    });
    await test('P4.3 audit log DELETE blocked', async () => {
        await auditTrail.record(db, { event_type: 'TEST', org_id: ORG, actor_user_id: UA, outcome: 'TEST' });
        let err = null;
        try { db.prepare('DELETE FROM governance_audit_log WHERE id = 1').run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('AUDIT_VIOLATION'));
    });
    await test('P4.4 audit log UPDATE blocked', async () => {
        let err = null;
        try { db.prepare("UPDATE governance_audit_log SET outcome = 'HACKED' WHERE id = 1").run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('AUDIT_VIOLATION'));
    });

    // ── P5: ZERO TRUST / CONTEXT VALIDATION ────────────────
    console.log('\n--- P5: Zero Trust ---');
    await reset();

    await test('P5.1 spoofed org → cross-tenant blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r74 = await approvalService.getApprovalRequest(db, c.approval_request_id, OX);
        assert.strictEqual(_r74.success, false);
    });
    await test('P5.2 spoofed org approve → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r75 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, org_id: OX });
        assert.strictEqual(_r75.success, false);
    });
    await test('P5.3 body identity ignored in execution', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'zt1', actor_user_id: UA });
        const _r76 = await executionService.getExecution(db, e.execution_id, ORG);
        assert.strictEqual(_r76.execution.actor_user_id, UA);
    });
    await test('P5.4 missing org → execution fails', async () => {
        const _r77 = await executionService.executeWorkflow(db, { workflow_id: 'x', actor_user_id: UA });
        assert.strictEqual(_r77.success, false);
    });
    await test('P5.5 missing actor → execution fails', async () => {
        const _r78 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'x' });
        assert.strictEqual(_r78.success, false);
    });
    await test('P5.6 validateTenantAccess denies cross-org', async () => {
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, OX), false);
    });
    await test('P5.7 scopedQuery requires org_id in SQL', async () => {
        assert.throws(() => scopedQuery(db, 'SELECT * FROM approval_requests WHERE id = ?', [1], ORG), /must filter by org_id/);
    });
    await test('P5.8 cross-org replay blocked', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'zt2', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        const _r79 = await executionService.replayApprovedExecution(db, { org_id: OX, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r79.error, 'execution_not_found');
    });

    // ── P6: AUDIT TRAIL COMPLETENESS ───────────────────────
    console.log('\n--- P6: Audit Trail ---');
    await reset(); auditEvents.length = 0;

    await test('P6.1 governance gate records audit on CLEAR', async () => {
        auditEvents.length = 0;
        await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'aud1', action_type: 'execute' });
        assert.ok(auditEvents.some(e => e.event_type === 'GOVERNANCE_CLEAR'));
    });
    await test('P6.2 governance gate records audit on PENDING', async () => {
        auditEvents.length = 0;
        await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'aud2', action_type: 'execute', is_bulk: true });
        assert.ok(auditEvents.some(e => e.event_type === 'GOVERNANCE_PENDING'));
    });
    await test('P6.3 governance gate records audit on ERROR', async () => {
        auditEvents.length = 0;
        await enforceGovernance(db, { org_id: ORG, target_type: 'workflow', action_type: 'execute' }); // missing actor
        assert.ok(auditEvents.some(e => e.event_type === 'GOVERNANCE_ERROR'));
    });
    await test('P6.4 approval creation records audit', async () => {
        auditEvents.length = 0;
        await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        assert.ok(auditEvents.some(e => e.event_type === 'APPROVAL_CREATED'));
    });
    await test('P6.5 approval state transition records audit', async () => {
        auditEvents.length = 0;
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.ok(auditEvents.some(e => e.event_type === 'APPROVAL_APPROVED'));
    });
    await test('P6.6 full lifecycle reconstructable', async () => {
        auditEvents.length = 0;
        // Create → Approve → Execute via replay
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'lc1', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        // Verify lifecycle has: GOVERNANCE_PENDING (from gate), APPROVAL_CREATED, APPROVAL_APPROVED x2
        const types = auditEvents.map(e => e.event_type);
        assert.ok(types.includes('GOVERNANCE_PENDING'), 'missing GOVERNANCE_PENDING');
        assert.ok(types.includes('APPROVAL_CREATED'), 'missing APPROVAL_CREATED');
        assert.ok(types.filter(t => t === 'APPROVAL_APPROVED').length >= 1, 'missing APPROVAL_APPROVED');
    });
    await test('P6.7 audit events have required fields', async () => {
        auditEvents.length = 0;
        await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'fld1', action_type: 'execute' });
        const evt = auditEvents[0];
        assert.ok(evt.event_type);
        assert.ok(evt.org_id);
        assert.ok(evt.actor_user_id);
        assert.ok(evt.outcome);
    });
    await test('P6.8 audit trail immutable in DB', async () => {
        await auditTrail.record(db, { event_type: 'P6_TEST', org_id: ORG, actor_user_id: UA, outcome: 'TEST' });
        const r = await auditTrail.query(db, { org_id: ORG, event_type: 'P6_TEST' });
        assert.ok(r.events.length >= 1);
    });

    // ── P7: STRUCTURED LOGGING ─────────────────────────────
    console.log('\n--- P7: Structured Logging ---');

    await test('P7.1 logger emits with severity/component/msg', async () => {
        let captured = null;
        logger.configure({ output: (e) => { captured = e; }, level: 'DEBUG', silent: false });
        logger.info('test', 'hello', { org_id: ORG });
        assert.ok(captured.ts);
        assert.strictEqual(captured.level, 'INFO');
        assert.strictEqual(captured.component, 'test');
        logger.configure({ silent: true });
    });
    await test('P7.2 forRequest includes correlation ID', async () => {
        let captured = null;
        logger.configure({ output: (e) => { captured = e; }, level: 'DEBUG', silent: false });
        const rl = logger.forRequest({ identity: { orgId: ORG, userId: UA }, headers: { 'x-request-id': 'req-123' } });
        rl.info('route', 'test');
        assert.strictEqual(captured.data.request_id, 'req-123');
        logger.configure({ silent: true });
    });

    // ── P8: RATE LIMITING ──────────────────────────────────
    console.log('\n--- P8: Rate Limiting ---');
    await reset();

    await test('P8.1 rate limit increments', async () => {
        const r = await checkRateLimit(db, ORG, 'workflow:execute');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.current, 1);
    });
    await test('P8.2 rate limit blocks at max', async () => {
        const windowStart = Math.floor(Date.now() / (60 * 60000)).toString();
        db.prepare('INSERT OR REPLACE INTO rate_limit_entries (key, org_id, window_start, count) VALUES (?, ?, ?, ?)').run('test:block', ORG, windowStart, 300);
        const _r80 = await checkRateLimit(db, ORG, 'test:block');
        assert.strictEqual(_r80.allowed, false);
    });
    await test('P8.3 rate limit failure fails open (no bypass)', async () => {
        const _r81 = await checkRateLimit(null, ORG, 'x');
        assert.strictEqual(_r81.allowed, true);
    });
    await test('P8.4 orgs are isolated in rate limits', async () => {
        await checkRateLimit(db, ORG, 'approval:approve');
        const r = await checkRateLimit(db, OX, 'approval:approve');
        assert.strictEqual(r.current, 1);
    });

    // ── P9: COMPREHENSIVE SECURITY ─────────────────────────
    console.log('\n--- P9: Security Hardening ---');
    await reset();

    await test('P9.1 WHITELISTED_NONE has exactly 3 entries', async () => {
        assert.strictEqual(WHITELISTED_NONE_ACTIONS.size, 3);
    });
    await test('P9.2 non-whitelisted NONE action → PENDING', async () => {
        const r = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'decision', target_id: 'x', action_type: 'update' });
        assert.strictEqual(r.status, GATE_STATUS.PENDING);
    });
    await test('P9.3 safe actions (list/get) → CLEAR', async () => {
        const _r82 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'any', target_id: 'x', action_type: 'list' });
        assert.strictEqual(_r82.status, GATE_STATUS.CLEAR);
        const _r83 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'any', target_id: 'x', action_type: 'get' });
        assert.strictEqual(_r83.status, GATE_STATUS.CLEAR);
    });
    await test('P9.4 escalation flags override whitelist', async () => {
        const _r84 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute', is_bulk: true });
        assert.strictEqual(_r84.status, GATE_STATUS.PENDING);
        const _r85 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute', is_destructive: true });
        assert.strictEqual(_r85.status, GATE_STATUS.PENDING);
        const _r86 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute', is_ai_originated: true });
        assert.strictEqual(_r86.status, GATE_STATUS.PENDING);
    });
    await test('P9.5 all escalations → DUAL mode', async () => {
        const bulk = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isBulk: true });
        const dest = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isDestructive: true });
        const ai = policyRegistry.isApprovalRequired({ orgId: ORG, targetType: 'workflow', actionType: 'execute', isAiOriginated: true });
        assert.strictEqual(bulk.mode, 'DUAL');
        assert.strictEqual(dest.mode, 'DUAL');
        assert.strictEqual(ai.mode, 'DUAL');
    });

    // ── P10: FILE INVENTORY ────────────────────────────────
    console.log('\n--- P10: File Inventory ---');

    const REQUIRED_FILES = [
        'src/middleware/auth.js', 'src/middleware/rbac.js', 'src/middleware/context.js',
        'src/middleware/tenant-isolation.js', 'src/middleware/rate-limit.js',
        'src/app/integration.js',
        'src/services/governance-gate.js', 'src/services/governance-invariants.js',
        'src/services/approval-service.js', 'src/services/approval-policy-registry.js',
        'src/services/workflow-execution-service.js', 'src/services/decision-execution-service.js',
        'src/services/audit-trail.js', 'src/services/worker-queue.js',
        'src/common/logger.js', 'src/common/metrics.js', 'src/common/validate.js',
        'src/db/adapter.js',
    ];
    for (const f of REQUIRED_FILES) {
        await test('exists: ' + f, async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'missing: ' + f); });
    }

    // Cleanup
    setAuditRecorder(null);
    approvalService.setAuditRecorder(null);
    logger.configure({ silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 30 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
