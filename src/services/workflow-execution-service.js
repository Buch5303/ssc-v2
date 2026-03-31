'use strict';

const { interceptWorkflowExecution } = require('./workflow-approval-bridge');
const { getApprovalRequest } = require('./approval-service');

function _now() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
function _js(o) { try { return JSON.stringify(o || {}); } catch { return '{}'; } }
function _pr(r) {
    if (!r) return null;
    return {
        ...r,
        request_payload_json:     _jp(r.request_payload_json),
        result_payload_json:      _jp(r.result_payload_json),
        governance_snapshot_json:  _jp(r.governance_snapshot_json),
    };
}
function _lid(db) {
    try { const r = db.prepare('SELECT last_insert_rowid() AS id').get(); return r ? r.id : null; }
    catch { return null; }
}
function _ci(v, mn, mx, fb) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return fb;
    return Math.max(mn, Math.min(mx, n));
}

let _ex = () => ({ success: true, result: { executed: true, engine: 'default' } });

function configureExecutor(fn) {
    if (typeof fn === 'function') _ex = fn;
    else _ex = () => ({ success: true, result: { executed: true, engine: 'default' } });
}

function _run(db, wid, p, ctx) {
    try { return _ex(db, wid, p, ctx); }
    catch (e) { return { success: false, error: 'executor_error: ' + e.message }; }
}

function executeWorkflow(db, params = {}) {
    try {
        if (!params.org_id) return { success: false, error: 'org_id_required' };
        if (!params.workflow_id) return { success: false, error: 'workflow_id_required' };
        if (!params.actor_user_id) return { success: false, error: 'actor_user_id_required' };

        const now = _now();
        const br = interceptWorkflowExecution(db, {
            org_id: params.org_id, workflow_id: params.workflow_id,
            action_type: params.action_type || 'execute',
            actor_user_id: params.actor_user_id,
            is_bulk: params.is_bulk, is_ai_originated: params.is_ai_originated,
            is_destructive: params.is_destructive, payload: params.payload || {},
        });

        if (br.status === 'PASS_THROUGH') {
            const er = _run(db, params.workflow_id, params.payload || {}, {
                org_id: params.org_id, actor_user_id: params.actor_user_id,
            });
            const ins = db.prepare(
                'INSERT INTO workflow_executions (org_id, workflow_id, actor_user_id, execution_status, request_payload_json, result_payload_json, governance_snapshot_json, is_replay, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)'
            ).run(params.org_id, params.workflow_id, params.actor_user_id, 'EXECUTED',
                _js(params.payload), _js(er), _js({ bridge_status: 'PASS_THROUGH' }), now, now);
            return {
                success: true,
                execution_id: ins.lastInsertRowid ? Number(ins.lastInsertRowid) : _lid(db),
                execution_status: 'EXECUTED', result: er,
            };
        }

        if (br.status === 'PENDING_APPROVAL') {
            const ins = db.prepare(
                'INSERT INTO workflow_executions (org_id, workflow_id, actor_user_id, execution_status, approval_request_id, request_payload_json, governance_snapshot_json, is_replay, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)'
            ).run(params.org_id, params.workflow_id, params.actor_user_id,
                'BLOCKED_PENDING_APPROVAL', br.approval_request_id,
                _js(params.payload),
                _js({ bridge_status: 'PENDING_APPROVAL', approval_request_id: br.approval_request_id }),
                now, now);
            return {
                success: true,
                execution_id: ins.lastInsertRowid ? Number(ins.lastInsertRowid) : _lid(db),
                execution_status: 'BLOCKED_PENDING_APPROVAL',
                approval_request_id: br.approval_request_id,
            };
        }

        // ERROR — fail closed
        const ins = db.prepare(
            'INSERT INTO workflow_executions (org_id, workflow_id, actor_user_id, execution_status, request_payload_json, result_payload_json, governance_snapshot_json, is_replay, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)'
        ).run(params.org_id, params.workflow_id, params.actor_user_id, 'BLOCKED_ERROR',
            _js(params.payload), _js({ error: br.error }),
            _js({ bridge_status: 'ERROR', error: br.error }), now, now);
        return {
            success: false,
            execution_id: ins.lastInsertRowid ? Number(ins.lastInsertRowid) : _lid(db),
            execution_status: 'BLOCKED_ERROR', error: br.error,
        };
    } catch (e) {
        return { success: false, error: 'execution_error: ' + e.message };
    }
}

function replayApprovedExecution(db, params = {}) {
    try {
        if (!params.org_id) return { success: false, error: 'org_id_required' };
        if (!params.execution_id) return { success: false, error: 'execution_id_required' };
        if (!params.actor_user_id) return { success: false, error: 'actor_user_id_required' };

        const orig = db.prepare(
            'SELECT * FROM workflow_executions WHERE id = ? AND org_id = ?'
        ).get(params.execution_id, params.org_id);
        if (!orig) return { success: false, error: 'execution_not_found' };
        if (orig.execution_status !== 'BLOCKED_PENDING_APPROVAL') {
            return { success: false, error: 'replay_invalid_status: ' + orig.execution_status };
        }
        if (!orig.approval_request_id) {
            return { success: false, error: 'no_approval_request_linked' };
        }

        const ar = getApprovalRequest(db, orig.approval_request_id, params.org_id);
        if (!ar.success) return { success: false, error: 'approval_lookup_failed: ' + ar.error };
        if (ar.request.request_status !== 'APPROVED') {
            return { success: false, error: 'approval_not_approved: ' + ar.request.request_status };
        }

        // Exact-once via UNIQUE replay_idempotency_key
        const ik = 'replay:' + orig.approval_request_id;
        const existing = db.prepare(
            'SELECT id FROM workflow_executions WHERE replay_idempotency_key = ?'
        ).get(ik);
        if (existing) {
            return { success: false, error: 'replay_already_executed', existing_replay_id: existing.id };
        }

        const payload = _jp(orig.request_payload_json);
        const er = _run(db, orig.workflow_id, payload, {
            org_id: params.org_id, actor_user_id: params.actor_user_id,
            is_replay: true, original_execution_id: orig.id,
        });
        const now = _now();
        const st = er.success !== false ? 'REPLAYED' : 'REPLAY_BLOCKED';

        const ins = db.prepare(
            'INSERT INTO workflow_executions (org_id, workflow_id, actor_user_id, execution_status, approval_request_id, request_payload_json, result_payload_json, governance_snapshot_json, is_replay, replay_idempotency_key, replayed_by_user_id, replayed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?)'
        ).run(params.org_id, orig.workflow_id, orig.actor_user_id, st,
            orig.approval_request_id, orig.request_payload_json, _js(er),
            _js({ replay: true, original_execution_id: orig.id, approval_status: 'APPROVED', replayed_by: params.actor_user_id }),
            ik, params.actor_user_id, now, now, now);

        const rid = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : _lid(db);
        db.prepare('UPDATE workflow_executions SET updated_at = ? WHERE id = ?').run(now, orig.id);

        return {
            success: true, execution_id: rid, execution_status: st,
            original_execution_id: orig.id, result: er,
        };
    } catch (e) {
        return { success: false, error: 'replay_error: ' + e.message };
    }
}

function getExecution(db, id, orgId) {
    try {
        if (!orgId) return { success: false, error: 'org_id_required' };
        const r = db.prepare(
            'SELECT * FROM workflow_executions WHERE id = ? AND org_id = ?'
        ).get(id, orgId);
        if (!r) return { success: false, error: 'execution_not_found' };
        return { success: true, execution: _pr(r) };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function listExecutions(db, filters = {}) {
    try {
        const c = [], p = [];
        if (filters.org_id)           { c.push('org_id = ?');           p.push(filters.org_id); }
        if (filters.workflow_id)      { c.push('workflow_id = ?');      p.push(filters.workflow_id); }
        if (filters.execution_status) { c.push('execution_status = ?'); p.push(filters.execution_status); }
        if (filters.actor_user_id)    { c.push('actor_user_id = ?');    p.push(filters.actor_user_id); }

        const w   = c.length > 0 ? 'WHERE ' + c.join(' AND ') : '';
        const lim = _ci(filters.limit, 1, 200, 50);
        const off = _ci(filters.offset, 0, Number.MAX_SAFE_INTEGER, 0);

        const cnt = db.prepare('SELECT COUNT(*) as total FROM workflow_executions ' + w).get(...p);
        const rows = db.prepare(
            'SELECT * FROM workflow_executions ' + w + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(...p, lim, off);

        return {
            success: true,
            executions: (rows || []).map(_pr),
            total: cnt ? cnt.total : 0,
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = {
    executeWorkflow, replayApprovedExecution,
    getExecution, listExecutions, configureExecutor,
};
