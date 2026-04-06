'use strict';

const { enforceGovernance, _resetGovernanceFlag, assertGovernanceEnforced, GATE_STATUS } = require('./governance-gate');
const logger = require('../common/logger');
const auditTrail = require('./audit-trail');

/**
 * Day 29: Background Worker Queue
 *
 * All background/async jobs MUST go through governance gate.
 * Jobs are idempotent via unique job_key.
 * Retry-safe: failed jobs can be retried without side effects.
 *
 * Pattern:
 *   enqueue → process → governance gate → execute → record
 *
 * Uses in-memory queue for sql.js mode.
 * PostgreSQL mode: use SKIP LOCKED for distributed processing.
 */

const JOB_STATUS = Object.freeze({
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    BLOCKED: 'BLOCKED',
    SKIPPED: 'SKIPPED',
});

const _queue = [];
const _processed = new Set();
const _results = new Map();

function enqueue(job) {
    if (!job || !job.job_key) return { success: false, error: 'job_key_required' };
    if (!job.org_id) return { success: false, error: 'org_id_required' };
    if (!job.actor_user_id) return { success: false, error: 'actor_user_id_required' };
    if (!job.target_type) return { success: false, error: 'target_type_required' };
    if (!job.action_type) return { success: false, error: 'action_type_required' };

    // Idempotency: skip if already processed
    if (_processed.has(job.job_key)) {
        return { success: true, status: JOB_STATUS.SKIPPED, message: 'already_processed' };
    }

    // Dedup: skip if already in queue
    if (_queue.some(j => j.job_key === job.job_key)) {
        return { success: true, status: JOB_STATUS.SKIPPED, message: 'already_queued' };
    }

    _queue.push({ ...job, status: JOB_STATUS.QUEUED, enqueued_at: new Date().toISOString(), attempts: 0 });
    return { success: true, status: JOB_STATUS.QUEUED };
}

async function processNext(db, executor) {
    if (_queue.length === 0) return { success: true, status: 'EMPTY' };

    const job = _queue.shift();
    job.status = JOB_STATUS.PROCESSING;
    job.attempts = (job.attempts || 0) + 1;

    // Idempotency check (may have been processed between enqueue and now)
    if (_processed.has(job.job_key)) {
        return { success: true, status: JOB_STATUS.SKIPPED, job_key: job.job_key };
    }

    try {
        // MANDATORY: governance gate
        _resetGovernanceFlag();
        const gate = await enforceGovernance(db, {
            org_id: job.org_id,
            target_type: job.target_type,
            target_id: job.target_id || '',
            action_type: job.action_type,
            actor_user_id: job.actor_user_id,
            is_bulk: job.is_bulk,
            is_ai_originated: job.is_ai_originated,
            is_destructive: job.is_destructive,
            payload: job.payload || {},
        });
        assertGovernanceEnforced();

        if (gate.status === GATE_STATUS.CLEAR) {
            // Execute through provided executor
            const result = typeof executor === 'function'
                ? executor(db, job)
                : { success: true, engine: 'default' };

            _processed.add(job.job_key);
            _results.set(job.job_key, { status: JOB_STATUS.COMPLETED, result, completed_at: new Date().toISOString() });

            auditTrail.record(db, {
                event_type: 'EXECUTION_CLEAR', org_id: job.org_id, actor_user_id: job.actor_user_id,
                target_type: job.target_type, target_id: job.target_id,
                action_key: job.target_type + ':' + job.action_type,
                outcome: 'COMPLETED', detail: { job_key: job.job_key, attempts: job.attempts },
            });

            return { success: true, status: JOB_STATUS.COMPLETED, job_key: job.job_key, result };
        }

        if (gate.status === GATE_STATUS.PENDING) {
            _results.set(job.job_key, { status: JOB_STATUS.BLOCKED, approval_request_id: gate.approval_request_id });
            return {
                success: true, status: JOB_STATUS.BLOCKED, job_key: job.job_key,
                approval_request_id: gate.approval_request_id,
            };
        }

        // ERROR or DENIED
        job.status = JOB_STATUS.FAILED;
        _results.set(job.job_key, { status: JOB_STATUS.FAILED, error: gate.error });
        return { success: false, status: JOB_STATUS.FAILED, job_key: job.job_key, error: gate.error };
    } catch (err) {
        job.status = JOB_STATUS.FAILED;
        _results.set(job.job_key, { status: JOB_STATUS.FAILED, error: err.message });

        // Retry: put back in queue if under max attempts
        if (job.attempts < (job.max_retries || 3)) {
            _queue.push(job);
            return { success: false, status: 'RETRY_QUEUED', job_key: job.job_key, attempt: job.attempts, error: err.message };
        }

        return { success: false, status: JOB_STATUS.FAILED, job_key: job.job_key, error: err.message };
    }
}

function getJobResult(jobKey) { return _results.get(jobKey) || null; }
function queueLength() { return _queue.length; }
function processedCount() { return _processed.size; }

function reset() {
    _queue.length = 0;
    _processed.clear();
    _results.clear();
}

module.exports = { enqueue, processNext, getJobResult, queueLength, processedCount, reset, JOB_STATUS };
