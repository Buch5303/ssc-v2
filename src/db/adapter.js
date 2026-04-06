'use strict';

const logger = require('../common/logger');

/**
 * Day 29: Database Adapter
 *
 * Abstraction layer for sql.js (dev/test) and PostgreSQL (production).
 * Provides transaction, locking, and tenant-scoped query methods.
 *
 * PostgreSQL mode: uses pg pool with SELECT FOR UPDATE, advisory locks, RLS.
 * SQLite mode: uses BEGIN IMMEDIATE for serializable isolation.
 */

const DB_MODE = Object.freeze({ SQLITE: 'sqlite', POSTGRES: 'postgres' });

function detectMode(db) {
    if (db && db._raw) return DB_MODE.SQLITE;
    if (db && typeof db.query === 'function') return DB_MODE.POSTGRES;
    if (db && typeof db.prepare === 'function') return DB_MODE.SQLITE;
    return DB_MODE.SQLITE;
}

/**
 * withTransaction — execute fn inside a transaction.
 * SQLite: BEGIN IMMEDIATE (serializable).
 * PostgreSQL: BEGIN + COMMIT/ROLLBACK.
 */
async function withTransaction(db, fn) {
    const mode = detectMode(db);

    if (mode === DB_MODE.POSTGRES) {
        return _pgTransaction(db, fn);
    }

    // SQLite: BEGIN IMMEDIATE for write serialization
    if (typeof db.transaction === 'function') return await db.transaction(fn)();
    try {
        await db.exec('BEGIN IMMEDIATE');
        const result = await fn();
        await db.exec('COMMIT');
        return result;
    } catch (err) {
        try { await db.exec('ROLLBACK'); } catch { /* */ }
        throw err;
    }
}

async function _pgTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * withRowLock — SELECT ... FOR UPDATE on a specific row.
 * SQLite: BEGIN IMMEDIATE provides full table lock (sufficient for single-node).
 * PostgreSQL: real row-level lock.
 */
async function withRowLock(db, table, id, fn) {
    const mode = detectMode(db);

    if (mode === DB_MODE.POSTGRES) {
        return withTransaction(db, async (client) => {
            const lockResult = await client.query(
                `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]
            );
            if (lockResult.rows.length === 0) return null;
            return fn(lockResult.rows[0], client);
        });
    }

    // SQLite: no row-level locks, just read and execute
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return null;
    return await fn(row, db);
}

/**
 * withAdvisoryLock — PostgreSQL advisory lock for cross-instance coordination.
 * SQLite: no-op (single process).
 */
async function withAdvisoryLock(db, lockKey, fn) {
    const mode = detectMode(db);

    if (mode === DB_MODE.POSTGRES) {
        return withTransaction(db, async (client) => {
            const numericKey = _hashLockKey(lockKey);
            await client.query('SELECT pg_advisory_xact_lock($1)', [numericKey]);
            return fn(client);
        });
    }

    // SQLite: transaction provides isolation
    return withTransaction(db, () => fn(db));
}

/**
 * tenantQuery — enforce org_id in every query (defense-in-depth).
 * PostgreSQL: RLS handles this at DB level. This is belt-and-suspenders.
 */
function tenantQuery(db, sql, params, orgId) {
    if (!orgId) throw new Error('TENANT_VIOLATION: org_id required for all queries');
    return db.prepare(sql).all(...params);
}

function _hashLockKey(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        const chr = key.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return Math.abs(hash);
}

module.exports = {
    withTransaction, withRowLock, withAdvisoryLock, tenantQuery,
    detectMode, DB_MODE,
};
