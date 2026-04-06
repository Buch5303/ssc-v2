'use strict';

const logger = require('../common/logger');

/**
 * Day 28: Immutable Audit Trail
 *
 * Append-only log of every governance event. DB triggers prevent
 * DELETE and UPDATE. Every approval action, execution, and
 * governance gate decision is recorded.
 */

const EVENT_TYPES = Object.freeze({
    APPROVAL_CREATED:  'APPROVAL_CREATED',
    APPROVAL_APPROVED: 'APPROVAL_APPROVED',
    APPROVAL_REJECTED: 'APPROVAL_REJECTED',
    APPROVAL_CANCELLED:'APPROVAL_CANCELLED',
    EXECUTION_CLEAR:   'EXECUTION_CLEAR',
    EXECUTION_BLOCKED: 'EXECUTION_BLOCKED',
    EXECUTION_REPLAYED:'EXECUTION_REPLAYED',
    GOVERNANCE_ERROR:  'GOVERNANCE_ERROR',
    RATE_LIMITED:      'RATE_LIMITED',
});

function _js(o) { try { return JSON.stringify(o || {}); } catch { return '{}'; } }
function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
function _now() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }

async function record(db, event) {
    try {
        if (!event || !event.event_type || !event.org_id || !event.actor_user_id) {
            logger.warn('audit-trail', 'incomplete audit event', event);
            return { success: false, error: 'incomplete_audit_event' };
        }

        await db.prepare(
            'INSERT INTO governance_audit_log (event_type, org_id, actor_user_id, target_type, target_id, action_key, approval_id, execution_id, decision_path, policy_applied, outcome, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(
            event.event_type,
            event.org_id,
            event.actor_user_id,
            event.target_type || null,
            event.target_id || null,
            event.action_key || null,
            event.approval_id || null,
            event.execution_id || null,
            event.decision_path || null,
            _js(event.policy_applied),
            event.outcome || 'UNKNOWN',
            _js(event.detail),
            _now()
        );

        return { success: true };
    } catch (err) {
        logger.error('audit-trail', 'failed to record audit event', { error: err.message });
        return { success: false, error: err.message };
    }
}

async function query(db, filters = {}) {
    try {
        const c = [], p = [];
        if (filters.org_id) { c.push('org_id = ?'); p.push(filters.org_id); }
        if (filters.actor_user_id) { c.push('actor_user_id = ?'); p.push(filters.actor_user_id); }
        if (filters.event_type) { c.push('event_type = ?'); p.push(filters.event_type); }
        if (filters.target_type) { c.push('target_type = ?'); p.push(filters.target_type); }
        if (filters.target_id) { c.push('target_id = ?'); p.push(filters.target_id); }
        if (filters.approval_id) { c.push('approval_id = ?'); p.push(filters.approval_id); }
        if (filters.after) { c.push('created_at >= ?'); p.push(filters.after); }
        if (filters.before) { c.push('created_at <= ?'); p.push(filters.before); }

        const w = c.length > 0 ? 'WHERE ' + c.join(' AND ') : '';
        const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 500);
        const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

        const rows = await db.prepare(
            'SELECT * FROM governance_audit_log ' + w + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(...p, limit, offset);
        const cnt = await db.prepare('SELECT COUNT(*) as total FROM governance_audit_log ' + w).get(...p);

        return {
            success: true,
            events: (rows || []).map(r => ({ ...r, policy_applied: _jp(r.policy_applied), detail_json: _jp(r.detail_json) })),
            total: cnt ? cnt.total : 0,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { record, query, EVENT_TYPES };
