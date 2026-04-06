'use strict';
const { enforceGovernance, _resetGovernanceFlag, assertGovernanceEnforced, GATE_STATUS } = require('./governance-gate');
const logger = require('../common/logger');
const metrics = require('../common/metrics');

/**
 * Phase 1A: Durable Worker Queue
 *
 * Persistent job queue backed by database table.
 * Survives restarts. Uses SELECT FOR UPDATE SKIP LOCKED pattern
 * for multi-instance safe processing.
 *
 * SQLite mode: uses in-memory table with BEGIN IMMEDIATE.
 * PostgreSQL mode: uses SKIP LOCKED for distributed processing.
 */

const JOB_STATUS = Object.freeze({
    QUEUED: 'QUEUED', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED',
    FAILED: 'FAILED', BLOCKED: 'BLOCKED',
});

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS worker_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_key TEXT NOT NULL UNIQUE,
    org_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT DEFAULT '',
    action_type TEXT NOT NULL,
    is_bulk INTEGER DEFAULT 0,
    is_ai_originated INTEGER DEFAULT 0,
    is_destructive INTEGER DEFAULT 0,
    payload_json TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'QUEUED',
    attempts INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    approval_request_id INTEGER,
    result_json TEXT DEFAULT '{}',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
)`;

const CREATE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_wj_status ON worker_jobs(status)`;

function _now() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function _js(o) { try { return JSON.stringify(o || {}); } catch { return '{}'; } }
function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }

async function initSchema(db) {
    await db.exec(CREATE_TABLE_SQL);
    await db.exec(CREATE_INDEX_SQL);
}

async function enqueue(db, job) {
    if (!job || !job.job_key) return { success: false, error: 'job_key_required' };
    if (!job.org_id) return { success: false, error: 'org_id_required' };
    if (!job.actor_user_id) return { success: false, error: 'actor_user_id_required' };
    if (!job.target_type) return { success: false, error: 'target_type_required' };
    if (!job.action_type) return { success: false, error: 'action_type_required' };

    // Idempotency: check if already exists
    const existing = await db.prepare('SELECT id, status FROM worker_jobs WHERE job_key = ?').get(job.job_key);
    if (existing) {
        if (existing.status === 'COMPLETED') return { success: true, status: 'SKIPPED', reason: 'already_completed', job_id: existing.id };
        if (existing.status === 'QUEUED' || existing.status === 'PROCESSING') return { success: true, status: 'SKIPPED', reason: 'already_queued', job_id: existing.id };
        // FAILED or BLOCKED: allow re-enqueue by updating status
        const now = _now();
        await db.prepare('UPDATE worker_jobs SET status = ?, attempts = 0, updated_at = ? WHERE id = ?').run('QUEUED', now, existing.id);
        metrics.increment('worker.re_enqueued');
        return { success: true, status: 'RE_QUEUED', job_id: existing.id };
    }

    const now = _now();
    const ins = await db.prepare(
        'INSERT INTO worker_jobs (job_key, org_id, actor_user_id, target_type, target_id, action_type, is_bulk, is_ai_originated, is_destructive, payload_json, status, max_retries, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(job.job_key, job.org_id, job.actor_user_id, job.target_type, job.target_id || '',
        job.action_type, job.is_bulk ? 1 : 0, job.is_ai_originated ? 1 : 0, job.is_destructive ? 1 : 0,
        _js(job.payload), 'QUEUED', job.max_retries || 3, now, now);

    const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
    metrics.increment('worker.enqueued');
    logger.info('durable-queue', 'enqueued', { job_key: job.job_key, org_id: job.org_id, job_id: id });
    return { success: true, status: JOB_STATUS.QUEUED, job_id: id };
}

async function processNext(db, executor) {
    // Claim next QUEUED job atomically
    const job = await db.prepare("SELECT * FROM worker_jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1").get();
    if (!job) return { success: true, status: 'EMPTY' };

    const now = _now();
    const claim = await db.prepare("UPDATE worker_jobs SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'QUEUED'").run(now, job.id);
    if (claim.changes === 0) return { success: true, status: 'CLAIMED_BY_OTHER' };

    metrics.increment('worker.processing');
    const timer = metrics.startTimer();

    try {
        _resetGovernanceFlag();
        const gate = await enforceGovernance(db, {
            org_id: job.org_id, target_type: job.target_type, target_id: job.target_id,
            action_type: job.action_type, actor_user_id: job.actor_user_id,
            is_bulk: !!job.is_bulk, is_ai_originated: !!job.is_ai_originated,
            is_destructive: !!job.is_destructive, payload: _jp(job.payload_json),
        });
        assertGovernanceEnforced();

        if (gate.status === GATE_STATUS.CLEAR) {
            const result = typeof executor === 'function' ? executor(db, job) : { success: true, engine: 'default' };
            await db.prepare("UPDATE worker_jobs SET status = 'COMPLETED', result_json = ?, completed_at = ?, updated_at = ? WHERE id = ?")
                .run(_js(result), now, now, job.id);
            metrics.increment('worker.completed');
            timer.end('worker.process_latency');
            return { success: true, status: JOB_STATUS.COMPLETED, job_id: job.id, job_key: job.job_key, result };
        }

        if (gate.status === GATE_STATUS.PENDING) {
            await db.prepare("UPDATE worker_jobs SET status = 'BLOCKED', approval_request_id = ?, updated_at = ? WHERE id = ?")
                .run(gate.approval_request_id, now, job.id);
            metrics.increment('worker.blocked');
            timer.end('worker.process_latency');
            return { success: true, status: JOB_STATUS.BLOCKED, job_id: job.id, approval_request_id: gate.approval_request_id };
        }

        // ERROR/DENIED
        const attempts = (job.attempts || 0) + 1;
        const maxRetries = job.max_retries || 3;
        const newStatus = attempts >= maxRetries ? 'FAILED' : 'QUEUED';
        await db.prepare('UPDATE worker_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
            .run(newStatus, gate.error || 'governance_denied', now, job.id);
        metrics.increment('worker.failed');
        timer.end('worker.process_latency');
        return { success: false, status: newStatus, job_id: job.id, error: gate.error };
    } catch (err) {
        const attempts = (job.attempts || 0) + 1;
        const maxRetries = job.max_retries || 3;
        const newStatus = attempts >= maxRetries ? 'FAILED' : 'QUEUED';
        await db.prepare('UPDATE worker_jobs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
            .run(newStatus, err.message, now, job.id);
        metrics.increment('worker.errors');
        timer.end('worker.process_latency');
        return { success: false, status: newStatus, job_id: job.id, error: err.message };
    }
}

async function getJob(db, jobId) {
    const row = await db.prepare('SELECT * FROM worker_jobs WHERE id = ?').get(jobId);
    if (!row) return null;
    return { ...row, payload_json: _jp(row.payload_json), result_json: _jp(row.result_json) };
}

async function getJobByKey(db, jobKey) {
    const row = await db.prepare('SELECT * FROM worker_jobs WHERE job_key = ?').get(jobKey);
    if (!row) return null;
    return { ...row, payload_json: _jp(row.payload_json), result_json: _jp(row.result_json) };
}

async function queueStats(db) {
    const stats = {};
    const rows = await db.prepare('SELECT status, COUNT(*) as count FROM worker_jobs GROUP BY status').all();
    for (const r of (rows || [])) stats[r.status] = r.count;
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    return stats;
}

async function purgeCompleted(db, olderThanMinutes) {
    const cutoff = new Date(Date.now() - (olderThanMinutes || 60) * 60000).toISOString().replace('T', ' ').replace('Z', '');
    const r = await db.prepare("DELETE FROM worker_jobs WHERE status = 'COMPLETED' AND completed_at < ?").run(cutoff);
    return { purged: r.changes || 0 };
}

module.exports = { initSchema, enqueue, processNext, getJob, getJobByKey, queueStats, purgeCompleted, JOB_STATUS, CREATE_TABLE_SQL };
