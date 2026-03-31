// ============================================================
// Day 22: Approval Service (v2 — corrected)
//
// CORRECTIONS:
//  - Item 2:  Approver authorization layer. configureAuthorization()
//             allows plugging in role/permission checks. Unauthorized
//             approvers rejected with 'approver_not_authorized'.
//  - Item 3:  Deduplication. createApprovalRequest checks for existing
//             PENDING request with same org+target_type+target_id+action_key.
//             Returns existing request idempotently.
//  - Item 5:  _handleDualApproval inspects rows-changed on second
//             approval UPDATE. Zero rows → deterministic race-lost error.
//  - Item 8:  Pagination hardening. limit clamped 1–200, offset ≥ 0.
//  - Item 9:  Scoped vs unscoped reads. getApprovalRequest() ALWAYS
//             requires orgId. getApprovalRequestInternal() exists
//             for internal/admin jobs (explicitly named).
//
// Pattern: mirrors ai-quarantine-service
// ============================================================

'use strict';

const APPROVAL_STATUS = Object.freeze({
    PENDING:   'PENDING',
    APPROVED:  'APPROVED',
    REJECTED:  'REJECTED',
    CANCELLED: 'CANCELLED',
});

const VALID_TRANSITIONS = Object.freeze({
    PENDING:   new Set(['APPROVED', 'REJECTED', 'CANCELLED']),
    APPROVED:  new Set(),
    REJECTED:  new Set(),
    CANCELLED: new Set(),
});

// ------------------------------------------------------------
// Approver authorization (Item 2)
// Default: allow all same-org actors (open policy).
// Call configureAuthorization() to plug in real role checks.
// ------------------------------------------------------------
let _isAuthorizedApprover = null; // null = no auth configured yet

/**
 * Configure the approver authorization function.
 *
 * @param {function|null} fn - (actorUserId, orgId, approvalRequest) => boolean
 *   Return true if actor is authorized to approve/reject/cancel.
 *   Return false to deny. Null disables authorization checks.
 */
function configureAuthorization(fn) {
    _isAuthorizedApprover = typeof fn === 'function' ? fn : null;
}

function _checkApproverAuthorized(actorUserId, orgId, row) {
    if (!_isAuthorizedApprover) return { authorized: true };
    try {
        const allowed = _isAuthorizedApprover(actorUserId, orgId, row);
        if (!allowed) return { authorized: false, error: 'approver_not_authorized' };
        return { authorized: true };
    } catch (err) {
        return { authorized: false, error: `authorization_check_failed: ${err.message}` };
    }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function _safeJsonParse(str) {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
}
function _safeJsonStringify(obj) {
    try { return JSON.stringify(obj || {}); } catch { return '{}'; }
}
function _parseRow(row) {
    if (!row) return null;
    return {
        ...row,
        request_payload_json: _safeJsonParse(row.request_payload_json),
        policy_snapshot_json: _safeJsonParse(row.policy_snapshot_json),
        decision_metadata_json: _safeJsonParse(row.decision_metadata_json),
    };
}
function _now() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
function _withTransaction(db, fn) {
    if (typeof db.transaction === 'function') return db.transaction(fn)();
    try {
        db.exec('BEGIN IMMEDIATE');
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* */ }
        throw err;
    }
}
function _clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

// ------------------------------------------------------------
// Core API
// ------------------------------------------------------------

/**
 * Create approval request with deduplication (Item 3).
 * If a PENDING request already exists for the same
 * org+target_type+target_id+action_key, return it idempotently.
 */
function createApprovalRequest(db, params) {
    try {
        if (!params) return { success: false, error: 'params_required' };
        if (!params.org_id) return { success: false, error: 'org_id_required' };
        if (!params.target_type) return { success: false, error: 'target_type_required' };
        if (!params.action_key) return { success: false, error: 'action_key_required' };
        if (!params.requested_by_user_id) return { success: false, error: 'requested_by_user_id_required' };

        // Deduplication check
        const targetId = params.target_id || null;
        if (targetId) {
            const existing = db.prepare(`
                SELECT * FROM approval_requests
                WHERE org_id = ? AND target_type = ? AND target_id = ?
                  AND action_key = ? AND request_status = 'PENDING'
                ORDER BY created_at DESC LIMIT 1
            `).get(params.org_id, params.target_type, targetId, params.action_key);

            if (existing) {
                return {
                    success: true,
                    approval_request_id: existing.id,
                    deduplicated: true,
                    message: 'existing_pending_request_reused',
                };
            }
        }

        const now = _now();
        const result = db.prepare(`
            INSERT INTO approval_requests
                (org_id, target_type, target_id, action_key,
                 request_payload_json, request_status, approval_mode,
                 risk_level, requested_by_user_id, policy_snapshot_json,
                 escalation_reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            params.org_id, params.target_type, targetId, params.action_key,
            _safeJsonStringify(params.request_payload),
            APPROVAL_STATUS.PENDING,
            params.approval_mode || 'SINGLE',
            params.risk_level || 'LOW',
            params.requested_by_user_id,
            _safeJsonStringify(params.policy_snapshot),
            params.escalation_reason || null,
            now, now
        );

        const id = result.lastInsertRowid ? Number(result.lastInsertRowid) : _getLastInsertId(db);
        return { success: true, approval_request_id: id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * List with pagination hardening (Item 8).
 * limit: 1–200, default 50. offset: ≥ 0, default 0.
 */
function listApprovalRequests(db, filters = {}) {
    try {
        const conditions = [];
        const params = [];

        if (filters.org_id) { conditions.push('org_id = ?'); params.push(filters.org_id); }
        if (filters.request_status) { conditions.push('request_status = ?'); params.push(filters.request_status); }
        if (filters.target_type) { conditions.push('target_type = ?'); params.push(filters.target_type); }
        if (filters.action_key) { conditions.push('action_key = ?'); params.push(filters.action_key); }
        if (filters.risk_level) { conditions.push('risk_level = ?'); params.push(filters.risk_level); }
        if (filters.requested_by_user_id) { conditions.push('requested_by_user_id = ?'); params.push(filters.requested_by_user_id); }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = _clampInt(filters.limit, 1, 200, 50);
        const offset = _clampInt(filters.offset, 0, Number.MAX_SAFE_INTEGER, 0);

        const countRow = db.prepare(`SELECT COUNT(*) as total FROM approval_requests ${where}`).get(...params);
        const rows = db.prepare(
            `SELECT * FROM approval_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(...params, limit, offset);

        return {
            success: true,
            requests: (rows || []).map(_parseRow),
            total: countRow ? countRow.total : 0,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Get by ID — ALWAYS org-scoped (Item 9).
 * Prevents cross-org reads by design.
 */
function getApprovalRequest(db, id, orgId) {
    try {
        if (!orgId) return { success: false, error: 'org_id_required_for_scoped_read' };
        const row = db.prepare(
            'SELECT * FROM approval_requests WHERE id = ? AND org_id = ?'
        ).get(id, orgId);
        if (!row) return { success: false, error: 'approval_request_not_found' };
        return { success: true, request: _parseRow(row) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Get by ID — UNSCOPED (Item 9).
 * Explicitly named internal method for admin/system jobs only.
 * Never expose via routes.
 */
function getApprovalRequestInternal(db, id) {
    try {
        const row = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
        if (!row) return { success: false, error: 'approval_request_not_found' };
        return { success: true, request: _parseRow(row) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function approveApprovalRequest(db, id, params = {}) {
    return _transitionToTerminal(db, id, APPROVAL_STATUS.APPROVED, params);
}
function rejectApprovalRequest(db, id, params = {}) {
    return _transitionToTerminal(db, id, APPROVAL_STATUS.REJECTED, params);
}
function cancelApprovalRequest(db, id, params = {}) {
    return _transitionToTerminal(db, id, APPROVAL_STATUS.CANCELLED, params);
}

function summarizeApprovalRequests(db, orgId) {
    try {
        const orgFilter = orgId ? 'WHERE org_id = ?' : '';
        const orgPendingFilter = orgId ? 'WHERE request_status = ? AND org_id = ?' : 'WHERE request_status = ?';
        const orgParams = orgId ? [orgId] : [];
        const pendingParams = orgId ? ['PENDING', orgId] : ['PENDING'];

        const statusCounts = db.prepare(
            `SELECT request_status, COUNT(*) as count FROM approval_requests ${orgFilter} GROUP BY request_status`
        ).all(...orgParams);
        const riskCounts = db.prepare(
            `SELECT risk_level, COUNT(*) as count FROM approval_requests ${orgPendingFilter} GROUP BY risk_level`
        ).all(...pendingParams);
        const typeCounts = db.prepare(
            `SELECT target_type, COUNT(*) as count FROM approval_requests ${orgPendingFilter} GROUP BY target_type`
        ).all(...pendingParams);
        const oldestPending = db.prepare(
            `SELECT id, target_type, action_key, created_at FROM approval_requests
             ${orgPendingFilter} ORDER BY created_at ASC LIMIT 1`
        ).get(...pendingParams);

        const totalPending = (statusCounts || []).reduce((sum, r) =>
            r.request_status === 'PENDING' ? sum + r.count : sum, 0);

        return {
            success: true,
            summary: {
                by_status: _toMap(statusCounts, 'request_status', 'count'),
                pending_by_risk: _toMap(riskCounts, 'risk_level', 'count'),
                pending_by_type: _toMap(typeCounts, 'target_type', 'count'),
                oldest_pending: oldestPending || null,
                total_pending: totalPending,
            },
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ------------------------------------------------------------
// Internal: transition with full safety
// ------------------------------------------------------------
function _transitionToTerminal(db, id, newStatus, params = {}) {
    try {
        if (!id) return { success: false, error: 'id_required' };
        if (!params.actor_user_id) return { success: false, error: 'actor_user_id_required' };

        const actorUserId = params.actor_user_id;
        const orgId = params.org_id || null;
        const reason = params.reason || null;
        const metadata = params.metadata || {};
        const now = _now();

        const result = _withTransaction(db, () => {
            // Re-read inside transaction
            let row;
            if (orgId) {
                row = db.prepare(
                    'SELECT * FROM approval_requests WHERE id = ? AND org_id = ?'
                ).get(id, orgId);
            } else {
                row = db.prepare(
                    'SELECT * FROM approval_requests WHERE id = ?'
                ).get(id);
            }
            if (!row) return { success: false, error: 'approval_request_not_found' };

            const currentStatus = row.request_status;

            // Idempotency: already in target state
            if (currentStatus === newStatus) {
                return {
                    success: true, request: _parseRow(row),
                    idempotent: true, message: `already_${newStatus.toLowerCase()}`,
                };
            }

            // Validate transition
            const allowed = VALID_TRANSITIONS[currentStatus];
            if (!allowed || !allowed.has(newStatus)) {
                return { success: false, error: `invalid_transition: ${currentStatus} -> ${newStatus}` };
            }

            // Self-approval prevention
            if (newStatus === APPROVAL_STATUS.APPROVED && row.requested_by_user_id === actorUserId) {
                return { success: false, error: 'self_approval_prohibited' };
            }

            // Approver authorization (Item 2)
            const authCheck = _checkApproverAuthorized(actorUserId, orgId || row.org_id, row);
            if (!authCheck.authorized) {
                return { success: false, error: authCheck.error };
            }

            // DUAL approval
            if (row.approval_mode === 'DUAL' && newStatus === APPROVAL_STATUS.APPROVED) {
                return _handleDualApproval(db, row, actorUserId, reason, metadata, now);
            }

            // SINGLE or reject/cancel
            const decisionMeta = _safeJsonStringify({
                ...metadata, reason, actor: actorUserId,
                action: newStatus.toLowerCase(), timestamp: now,
            });

            let actorField;
            if (newStatus === APPROVAL_STATUS.APPROVED) actorField = 'approved_by_user_id';
            else if (newStatus === APPROVAL_STATUS.REJECTED) actorField = 'rejected_by_user_id';
            else actorField = 'cancelled_by_user_id';

            const updateResult = db.prepare(`
                UPDATE approval_requests
                SET request_status = ?, ${actorField} = ?,
                    decision_metadata_json = ?, resolved_at = ?, updated_at = ?
                WHERE id = ? AND request_status = 'PENDING'
            `).run(newStatus, actorUserId, decisionMeta, now, now, id);

            // Verify write landed (race protection)
            if (updateResult.changes === 0) {
                // Re-read to determine cause
                const reread = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
                if (reread && reread.request_status === newStatus) {
                    return { success: true, request: _parseRow(reread), idempotent: true,
                        message: `already_${newStatus.toLowerCase()}` };
                }
                return { success: false, error: 'transition_race_lost: status changed concurrently' };
            }

            const updated = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
            return { success: true, request: _parseRow(updated) };
        });

        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Item 5: _handleDualApproval checks rows-changed on second
 * approval. Zero rows → deterministic race-lost error.
 */
function _handleDualApproval(db, row, actorUserId, reason, metadata, now) {
    const id = row.id;

    if (!row.approved_by_user_id) {
        // First approval
        const firstResult = db.prepare(`
            UPDATE approval_requests
            SET approved_by_user_id = ?, decision_metadata_json = ?, updated_at = ?
            WHERE id = ? AND request_status = 'PENDING' AND approved_by_user_id IS NULL
        `).run(
            actorUserId,
            _safeJsonStringify({
                ...metadata, reason,
                first_approver: actorUserId, first_approval_at: now,
            }),
            now, id
        );

        if (firstResult.changes === 0) {
            // Another actor already wrote first approval concurrently
            return { success: false, error: 'dual_first_approval_race_lost' };
        }

        const updated = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
        return {
            success: true, request: _parseRow(updated),
            message: 'first_approval_recorded_awaiting_second',
        };
    }

    // Already has first approver
    if (row.approved_by_user_id === actorUserId) {
        return { success: false, error: 'dual_approval_requires_different_approvers' };
    }

    // Second approval
    const secondResult = db.prepare(`
        UPDATE approval_requests
        SET request_status = 'APPROVED', second_approved_by_user_id = ?,
            decision_metadata_json = ?, resolved_at = ?, updated_at = ?
        WHERE id = ? AND request_status = 'PENDING'
    `).run(
        actorUserId,
        _safeJsonStringify({
            ...metadata, reason,
            first_approver: row.approved_by_user_id,
            second_approver: actorUserId, second_approval_at: now,
        }),
        now, now, id
    );

    // Item 5: deterministic race check
    if (secondResult.changes === 0) {
        const reread = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
        if (reread && reread.request_status === 'APPROVED') {
            return { success: true, request: _parseRow(reread),
                idempotent: true, message: 'already_approved' };
        }
        return { success: false, error: 'dual_second_approval_race_lost: status changed concurrently' };
    }

    const updated = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
    return { success: true, request: _parseRow(updated) };
}

// Utility
function _toMap(arr, keyField, valueField) {
    const m = {};
    if (Array.isArray(arr)) arr.forEach(r => { m[r[keyField]] = r[valueField]; });
    return m;
}
function _getLastInsertId(db) {
    try {
        const row = db.prepare('SELECT last_insert_rowid() as id').get();
        return row ? row.id : null;
    } catch { return null; }
}

module.exports = {
    createApprovalRequest, listApprovalRequests,
    getApprovalRequest, getApprovalRequestInternal,
    approveApprovalRequest, rejectApprovalRequest, cancelApprovalRequest,
    summarizeApprovalRequests, configureAuthorization,
    APPROVAL_STATUS, VALID_TRANSITIONS,
};
