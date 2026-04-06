'use strict';
const logger = require('../common/logger');

/**
 * PostgreSQL adapter matching the sql.js prepare/exec interface.
 * All methods return Promises. Callers use `await`.
 * sql.js callers also use `await` — `await syncValue` returns immediately.
 */
function createPgAdapter(pool) {
    return {
        _pool: pool,
        _mode: 'postgres',

        prepare(sql) {
            const pgSql = _sqliteToPostgres(sql);
            return {
                async run(...params) {
                    const client = await pool.connect();
                    try {
                        const result = await client.query(pgSql, params);
                        const idResult = await client.query('SELECT lastval() AS id').catch(() => ({ rows: [{ id: null }] }));
                        return { lastInsertRowid: idResult.rows[0] ? idResult.rows[0].id : null, changes: result.rowCount || 0 };
                    } finally { client.release(); }
                },
                async get(...params) {
                    const client = await pool.connect();
                    try {
                        const result = await client.query(pgSql, params);
                        return result.rows[0] || undefined;
                    } finally { client.release(); }
                },
                async all(...params) {
                    const client = await pool.connect();
                    try {
                        const result = await client.query(pgSql, params);
                        return result.rows || [];
                    } finally { client.release(); }
                },
            };
        },

        async exec(sql) {
            const client = await pool.connect();
            try { await client.query(sql); } finally { client.release(); }
        },

        pragma() { /* no-op for PG */ },
        transaction: undefined,
        close() { return pool.end(); },
    };
}

// Convert SQLite ? params to PostgreSQL $1, $2, ...
function _sqliteToPostgres(sql) {
    let idx = 0;
    return sql.replace(/\?/g, () => '$' + (++idx));
}

module.exports = { createPgAdapter };
