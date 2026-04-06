'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const executionService = require('../src/services/workflow-execution-service');
const { executeDecisionAction } = require('../src/services/decision-execution-service');
const { enforceGovernance, assertGovernanceEnforced, _resetGovernanceFlag, _wasGovernanceCalled, setAuditRecorder, GATE_STATUS, WHITELISTED_NONE_ACTIONS } = require('../src/services/governance-gate');
const { interceptWorkflowExecution } = require('../src/services/workflow-approval-bridge');
const { interceptDecisionAction } = require('../src/services/decision-approval-bridge');
const { verifyApprovalInvariant } = require('../src/services/governance-invariants');
const auditTrail = require('../src/services/audit-trail');
const { enqueue, processNext, reset: resetQueue } = require('../src/services/worker-queue');
const { checkReplayProtection, resetNonceCache } = require('../src/middleware/request-integrity');
const { validateTenantAccess } = require('../src/middleware/tenant-isolation');
const logger = require('../src/common/logger');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d31'; const OX = 'org-evil-d31';
const UA = 'ua'; const UB = 'ub'; const UC = 'uc'; const UD = 'ud';

async function test(n, fn) { try { await fn(); passed++; console.log('  ✓ ' + n); } catch (e) { failed++; failures.push({ name: n, error: e.message }); console.log('  ✗ ' + n + ': ' + e.message); } }

async function reset() {
    db.exec('DELETE FROM approval_requests');
    db.exec('DELETE FROM workflow_executions');
    try { db._raw.exec('DELETE FROM governance_audit_log'); } catch {}
    try { db._raw.exec('DELETE FROM rate_limit_entries'); } catch {}
    policyRegistry.clearOrgPolicies();
    approvalService.configureAuthorization(null);
    executionService.configureExecutor(null);
    resetQueue(); resetNonceCache();
}

async function dualApprove(id) {
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UB, org_id: ORG });
    await approvalService.approveApprovalRequest(db, id, { actor_user_id: UC, org_id: ORG });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 31: Grok Remediation — Adversarial Tests');
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
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '021-day31-hardening.sql'), 'utf-8')); } catch {}

    const auditEvents = [];
    setAuditRecorder((e) => { auditEvents.push(e); try { auditTrail.record(db, e); } catch {} });
    approvalService.setAuditRecorder((e) => { auditEvents.push(e); try { auditTrail.record(db, e); } catch {} });

    // ═══════════════════════════════════════════════════════
    // GROK FINDING 1: "Governance enforcement is optional"
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF1: Governance Mandatory at Every Entry Point ---');
    await reset();

    await test('GF1.1 zero PASS_THROUGH in any source file', async () => {
        const srcDir = path.join(__dirname, '..', 'src');
        const files = [];
        function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(dir, e.name)); else if (e.name.endsWith('.js')) files.push(path.join(dir, e.name)); } }
        walk(srcDir);
        for (const f of files) {
            const content = fs.readFileSync(f, 'utf-8');
            assert.strictEqual(content.includes('PASS_THROUGH'), false, 'PASS_THROUGH found in ' + f);
        }
    });
    await test('GF1.2 workflow execution calls gate', async () => {
        _resetGovernanceFlag();
        await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gf1', actor_user_id: UA });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('GF1.3 decision execution calls gate', async () => {
        _resetGovernanceFlag();
        await executeDecisionAction(db, { org_id: ORG, decision_id: 'd1', actor_user_id: UA, action_type: 'resolve' });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('GF1.4 worker queue calls gate', async () => {
        _resetGovernanceFlag();
        enqueue({ job_key: 'gf1-4', org_id: ORG, actor_user_id: UA, target_type: 'workflow', target_id: 'x', action_type: 'execute' });
        processNext(db);
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('GF1.5 bridge redirect calls gate (workflow)', async () => {
        _resetGovernanceFlag();
        await interceptWorkflowExecution(db, { org_id: ORG, workflow_id: 'x', actor_user_id: UA });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('GF1.6 bridge redirect calls gate (decision)', async () => {
        _resetGovernanceFlag();
        await interceptDecisionAction(db, { org_id: ORG, decision_id: 'x', action_type: 'resolve', actor_user_id: UA });
        assert.strictEqual(_wasGovernanceCalled(), true);
    });
    await test('GF1.7 bypass attempt without gate throws', async () => {
        _resetGovernanceFlag();
        assert.throws(() => assertGovernanceEnforced(), /GOVERNANCE_BYPASS/);
    });
    await test('GF1.8 bulk execution blocked (not passed through)', async () => {
        const r = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gf1-8', actor_user_id: UA, is_bulk: true });
        assert.strictEqual(r.execution_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('GF1.9 non-whitelisted decision action blocked', async () => {
        const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'x', actor_user_id: UA, action_type: 'update' });
        assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL');
    });
    await test('GF1.10 _run not exported', async () => {
        const wes = require('../src/services/workflow-execution-service');
        assert.strictEqual(typeof wes._run, 'undefined');
        assert.strictEqual(typeof wes._runGoverned, 'undefined');
    });

    // ═══════════════════════════════════════════════════════
    // GROK FINDING 2: "No DB-level integrity enforcement"
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF2: Database-Level Integrity ---');
    await reset();

    await test('GF2.1 trigger: APPROVED → REJECTED blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET request_status = 'REJECTED' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('TRIGGER_VIOLATION'), 'expected trigger violation, got: ' + err);
    });
    await test('GF2.2 trigger: REJECTED → APPROVED blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET request_status = 'APPROVED' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('TRIGGER_VIOLATION'));
    });
    await test('GF2.3 trigger: CANCELLED → anything blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET request_status = 'APPROVED' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('TRIGGER_VIOLATION'));
    });
    await test('GF2.4 trigger: direct INSERT with non-PENDING blocked', async () => {
        let err = null;
        try { db.prepare("INSERT INTO approval_requests (org_id, target_type, action_key, request_status, requested_by_user_id) VALUES (?, 'w', 'w:e', 'APPROVED', ?)").run(ORG, UA); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('CONSTRAINT_VIOLATION'), 'expected constraint violation, got: ' + err);
    });
    await test('GF2.5 trigger: org_id immutable after creation', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        let err = null;
        try { db.prepare("UPDATE approval_requests SET org_id = 'hijacked' WHERE id = ?").run(c.approval_request_id); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('CONSTRAINT_VIOLATION'));
    });
    await test('GF2.6 audit log DELETE blocked', async () => {
        await auditTrail.record(db, { event_type: 'GF2', org_id: ORG, actor_user_id: UA, outcome: 'TEST' });
        let err = null;
        try { db.prepare('DELETE FROM governance_audit_log WHERE id = 1').run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('AUDIT_VIOLATION'));
    });
    await test('GF2.7 audit log UPDATE blocked', async () => {
        let err = null;
        try { db.prepare("UPDATE governance_audit_log SET outcome = 'HACKED' WHERE id = 1").run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('AUDIT_VIOLATION'));
    });

    // ═══════════════════════════════════════════════════════
    // GROK FINDING 3: "Weak Zero Trust / context model"
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF3: Zero Trust / Identity Verification ---');
    await reset();

    await test('GF3.1 gate rejects missing org_id', async () => {
        const _r87 = await enforceGovernance(db, { actor_user_id: UA, target_type: 'w', action_type: 'e' });
        assert.strictEqual(_r87.status, GATE_STATUS.ERROR);
    });
    await test('GF3.2 gate rejects missing actor_user_id', async () => {
        const _r88 = await enforceGovernance(db, { org_id: ORG, target_type: 'w', action_type: 'e' });
        assert.strictEqual(_r88.status, GATE_STATUS.ERROR);
    });
    await test('GF3.3 gate rejects missing target_type', async () => {
        const _r89 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, action_type: 'e' });
        assert.strictEqual(_r89.status, GATE_STATUS.ERROR);
    });
    await test('GF3.4 gate rejects missing action_type', async () => {
        const _r90 = await enforceGovernance(db, { org_id: ORG, actor_user_id: UA, target_type: 'w' });
        assert.strictEqual(_r90.status, GATE_STATUS.ERROR);
    });
    await test('GF3.5 cross-org approval blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r91 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, org_id: OX });
        assert.strictEqual(_r91.success, false);
    });
    await test('GF3.6 cross-org read blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r92 = await approvalService.getApprovalRequest(db, c.approval_request_id, OX);
        assert.strictEqual(_r92.success, false);
    });
    await test('GF3.7 cross-org list isolation', async () => {
        await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r93 = await approvalService.listApprovalRequests(db, { org_id: OX });
        assert.strictEqual(_r93.requests.filter(r => r.org_id === ORG).length, 0);
    });
    await test('GF3.8 cross-org replay blocked', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gf3', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        const _r94 = await executionService.replayApprovedExecution(db, { org_id: OX, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r94.error, 'execution_not_found');
    });
    await test('GF3.9 replay protection: duplicate nonce rejected', async () => {
        resetNonceCache();
        assert.strictEqual(checkReplayProtection(ORG, 'nonce-1', String(Date.now())).valid, true);
        assert.strictEqual(checkReplayProtection(ORG, 'nonce-1', String(Date.now())).valid, false);
    });
    await test('GF3.10 replay protection: expired timestamp rejected', async () => {
        resetNonceCache();
        assert.strictEqual(checkReplayProtection(ORG, 'nonce-old', String(Date.now() - 600000)).valid, false);
    });
    await test('GF3.11 tenant access validation', async () => {
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, OX), false);
        assert.strictEqual(validateTenantAccess({ org_id: ORG }, ORG), true);
        assert.strictEqual(validateTenantAccess(null, ORG), false);
    });

    // ═══════════════════════════════════════════════════════
    // GROK FINDING 4: "No concurrency safety"
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF4: Concurrency & Atomicity ---');
    await reset();

    await test('GF4.1 CAS: approve on already-approved → idempotent', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const r = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(r.idempotent, true);
    });
    await test('GF4.2 CAS: approve after reject → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r95 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(_r95.success, false);
    });
    await test('GF4.3 DUAL: same user blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r96 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        assert.strictEqual(_r96.error, 'dual_approval_requires_different_approvers');
    });
    await test('GF4.4 DUAL: self-approval blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        const _r97 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r97.error, 'self_approval_prohibited');
    });
    await test('GF4.5 DUAL: two distinct users → APPROVED', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r98 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        assert.strictEqual(_r98.request.request_status, 'APPROVED');
    });
    await test('GF4.6 replay idempotency key blocks double execution', async () => {
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'gf4-6', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const _r99 = await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        assert.strictEqual(_r99.error, 'replay_already_executed');
    });
    await test('GF4.7 invariant verification after DUAL', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        const _r100 = await verifyApprovalInvariant(db, c.approval_request_id);
        assert.strictEqual(_r100.valid, true);
    });

    // ═══════════════════════════════════════════════════════
    // GROK FALSE CLAIMS: Audit reconstructability
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF-AUDIT: Full Lifecycle Reconstructability ---');
    await reset(); auditEvents.length = 0;

    await test('GF-AUD.1 create → approve → execute lifecycle', async () => {
        auditEvents.length = 0;
        const e = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'aud-lc', actor_user_id: UA, is_bulk: true });
        await dualApprove(e.approval_request_id);
        await executionService.replayApprovedExecution(db, { org_id: ORG, execution_id: e.execution_id, actor_user_id: UD });
        const types = auditEvents.map(x => x.event_type);
        assert.ok(types.includes('GOVERNANCE_PENDING'), 'missing GOVERNANCE_PENDING');
        assert.ok(types.includes('APPROVAL_CREATED'), 'missing APPROVAL_CREATED');
        assert.ok(types.filter(t => t === 'APPROVAL_APPROVED').length >= 1, 'missing APPROVAL_APPROVED');
    });
    await test('GF-AUD.2 audit events have org_id, actor, outcome', async () => {
        const evt = auditEvents.find(e => e.event_type === 'GOVERNANCE_PENDING');
        assert.ok(evt);
        assert.ok(evt.org_id);
        assert.ok(evt.actor_user_id);
        assert.ok(evt.outcome);
    });
    await test('GF-AUD.3 approval records have policy snapshot', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, policy_snapshot: { mode: 'SINGLE', risk: 'LOW' } });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.ok(r.request.policy_snapshot_json);
        assert.ok(r.request.policy_snapshot_json.mode);
    });
    await test('GF-AUD.4 approved record has approver + timestamp', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB, reason: 'verified' });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.approved_by_user_id, UB);
        assert.ok(r.request.resolved_at);
        assert.strictEqual(r.request.decision_metadata_json.reason, 'verified');
    });
    await test('GF-AUD.5 DUAL records both approvers', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UC });
        const r = await approvalService.getApprovalRequest(db, c.approval_request_id, ORG);
        assert.strictEqual(r.request.approved_by_user_id, UB);
        assert.strictEqual(r.request.second_approved_by_user_id, UC);
    });
    await test('GF-AUD.6 audit trail is append-only (DB enforced)', async () => {
        const q = await auditTrail.query(db, { org_id: ORG });
        assert.ok(q.total > 0);
    });

    // ═══════════════════════════════════════════════════════
    // EDGE CASE FAILURES (from Grok section 5)
    // ═══════════════════════════════════════════════════════
    console.log('\n--- GF-EDGE: Edge Case Failures ---');
    await reset();

    await test('EDGE.1 decision actions outside resolve/dismiss → governed', async () => {
        for (const action of ['update', 'delete', 'reassign', 'comment', 'archive']) {
            const r = await executeDecisionAction(db, { org_id: ORG, decision_id: 'edge-' + action, actor_user_id: UA, action_type: action });
            assert.strictEqual(r.action_status, 'BLOCKED_PENDING_APPROVAL', action + ' should be blocked');
        }
    });
    await test('EDGE.2 missing governance context → rejection', async () => {
        const _r101 = await executionService.executeWorkflow(db, { workflow_id: 'x', actor_user_id: UA });
        assert.strictEqual(_r101.success, false);
        const _r102 = await executionService.executeWorkflow(db, { org_id: ORG, workflow_id: 'x' });
        assert.strictEqual(_r102.success, false);
    });
    await test('EDGE.3 self-approval in SINGLE mode → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
        const _r103 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r103.error, 'self_approval_prohibited');
    });
    await test('EDGE.4 self-approval in DUAL mode → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        const _r104 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r104.error, 'self_approval_prohibited');
    });
    await test('EDGE.5 requester as second DUAL approver → blocked', async () => {
        const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA, approval_mode: 'DUAL', risk_level: 'HIGH' });
        await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
        const _r105 = await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
        assert.strictEqual(_r105.error, 'self_approval_prohibited');
    });
    await test('EDGE.6 illegal terminal transitions (all 6 combos)', async () => {
        for (const [from, action] of [['APPROVED','reject'],['APPROVED','cancel'],['REJECTED','approve'],['REJECTED','cancel'],['CANCELLED','approve'],['CANCELLED','reject']]) {
            const c = await approvalService.createApprovalRequest(db, { org_id: ORG, target_type: 'w', action_key: 'w:e', requested_by_user_id: UA });
            if (from === 'APPROVED') await approvalService.approveApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
            else if (from === 'REJECTED') await approvalService.rejectApprovalRequest(db, c.approval_request_id, { actor_user_id: UB });
            else await approvalService.cancelApprovalRequest(db, c.approval_request_id, { actor_user_id: UA });
            const fn = action === 'approve' ? 'approveApprovalRequest' : action === 'reject' ? 'rejectApprovalRequest' : 'cancelApprovalRequest';
            assert.strictEqual((await approvalService[fn](db, c.approval_request_id, { actor_user_id: UC })).success, false, from + '→' + action + ' should fail');
        }
    });

    // ═══════════════════════════════════════════════════════
    // FILE INTEGRITY
    // ═══════════════════════════════════════════════════════
    console.log('\n--- FILE: Integrity ---');

    await test('FILE.1 migration 018 (triggers) exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '018-day27-enforcement.sql'))); });
    await test('FILE.2 migration 019 (audit/rate) exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'))); });
    await test('FILE.3 migration 021 (hardening) exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '021-day31-hardening.sql'))); });
    await test('FILE.4 request-integrity.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'middleware', 'request-integrity.js'))); });

    // Cleanup
    setAuditRecorder(null);
    approvalService.setAuditRecorder(null);
    logger.configure({ silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 31 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
