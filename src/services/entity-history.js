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
function _js(o) {
    try { return JSON.stringify(o || {}); }
    catch { return '{}'; }
}

function recordHistory(db, entry) {
    const stmt = db.prepare(`
        INSERT INTO entity_history (
            org_id, entity_type, entity_id, action, actor_user_id,
            previous_values, new_values, field_changes, correlation_id, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
        entry.orgId,
        entry.entityType,
        String(entry.entityId),
        entry.action,
        entry.actorUserId,
        _js(entry.previousValues),
        _js(entry.newValues),
        _js(entry.fieldChanges),
        entry.correlationId || null,
        entry.source || 'app',
        _now()
    );
    logger.info('entity_history', 'recorded', {
        org_id: entry.orgId,
        entity_type: entry.entityType,
        entity_id: String(entry.entityId),
        action: entry.action,
        actor_user_id: entry.actorUserId,
        history_id: info.lastInsertRowid
    });
    return Number(info.lastInsertRowid);
}

function getHistory(db, orgId, entityType, entityId) {
    const stmt = db.prepare(`
        SELECT * FROM entity_history
        WHERE org_id = ? AND entity_type = ? AND entity_id = ?
        ORDER BY created_at ASC, id ASC
    `);
    return stmt.all(orgId, entityType, String(entityId));
}

function getEntityTimeline(db, orgId, entityType, filters = {}) {
    const clauses = ['org_id = ?', 'entity_type = ?'];
    const params = [orgId, entityType];

    if (filters.entityId) { clauses.push('entity_id = ?'); params.push(String(filters.entityId)); }
    if (filters.action) { clauses.push('action = ?'); params.push(filters.action); }
    if (filters.actorUserId) { clauses.push('actor_user_id = ?'); params.push(filters.actorUserId); }
    if (filters.after) { clauses.push('created_at >= ?'); params.push(filters.after); }
    if (filters.before) { clauses.push('created_at <= ?'); params.push(filters.before); }
    if (filters.source) { clauses.push('source = ?'); params.push(filters.source); }

    const limit = Math.max(1, Math.min(Number(filters.limit) || 100, 200));
    const offset = Math.max(0, Number(filters.offset) || 0);

    const stmt = db.prepare(`
        SELECT * FROM entity_history
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `);
    return stmt.all(...params, limit, offset);
}

module.exports = {
    recordHistory,
    getHistory,
    getEntityTimeline
};
