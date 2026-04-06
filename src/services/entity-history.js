'use strict';
const logger = require('../common/logger');

/**
 * Day 33: Entity History — Data Lineage Tracking
 *
 * Every supply chain entity change is recorded immutably.
 * DB triggers prevent DELETE/UPDATE on entity_history.
 * Supports full reconstruction of any entity's lifecycle.
 */

function _now() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function _js(o) { try { return JSON.stringify(o || {}); } catch { return '{}'; } }
function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }

async function record(db, event) {
    if (!event || !event.org_id || !event.entity_type || !event.actor_user_id) {
        return { success: false, error: 'incomplete_lineage_event' };
    }
    try {
        await db.prepare(
            'INSERT INTO entity_history (org_id, entity_type, entity_id, action, actor_user_id, source, field_changes_json, previous_values_json, new_values_json, correlation_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        ).run(
            event.org_id, event.entity_type, event.entity_id || 0,
            event.action || 'UPDATE', event.actor_user_id,
            event.source || 'manual',
            _js(event.field_changes), _js(event.previous_values), _js(event.new_values),
            event.correlation_id || null, _now()
        );
        return { success: true };
    } catch (err) {
        logger.error('entity-history', 'record failed', { error: err.message });
        return { success: false, error: err.message };
    }
}

async function getHistory(db, orgId, entityType, entityId, opts = {}) {
    try {
        const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 500);
        const rows = await db.prepare(
            'SELECT * FROM entity_history WHERE org_id = ? AND entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?'
        ).all(orgId, entityType, entityId, limit);
        return {
            success: true,
            history: (rows || []).map(r => ({
                ...r,
                field_changes_json: _jp(r.field_changes_json),
                previous_values_json: _jp(r.previous_values_json),
                new_values_json: _jp(r.new_values_json),
            })),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getEntityTimeline(db, orgId, entityType, opts = {}) {
    try {
        const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 1000);
        const c = []; const p = [];
        c.push('org_id = ?'); p.push(orgId);
        c.push('entity_type = ?'); p.push(entityType);
        if (opts.actor_user_id) { c.push('actor_user_id = ?'); p.push(opts.actor_user_id); }
        if (opts.action) { c.push('action = ?'); p.push(opts.action); }
        if (opts.after) { c.push('created_at >= ?'); p.push(opts.after); }

        const rows = await db.prepare(
            'SELECT * FROM entity_history WHERE ' + c.join(' AND ') + ' ORDER BY created_at DESC LIMIT ?'
        ).all(...p, limit);
        return { success: true, events: rows || [] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { record, getHistory, getEntityTimeline };
