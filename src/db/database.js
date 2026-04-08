'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../common/logger');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'ssc-v2.db');

/**
 * initDatabase — runtime switch between sql.js and PostgreSQL.
 *
 * If DATABASE_URL is set → PostgreSQL mode (requires pg package).
 * Otherwise → sql.js mode (in-memory or file-backed).
 *
 * Both modes return the same interface: prepare(sql).run/get/all, exec(sql).
 * PG adapter methods are async; sql.js methods are sync.
 * All callers use `await` — `await syncValue` returns immediately.
 */
async function initDatabase(dbPath) {
    // PostgreSQL mode
    if (process.env.DATABASE_URL) {
        return _initPostgres();
    }

    // sql.js mode (development / tests)
    return _initSqlite(dbPath);
}

async function _initPostgres() {
    const { Pool } = require('pg');
    const { createPgAdapter } = require('./pg-adapter');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.DATABASE_URL?.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
    });

    pool.on('error', (err) => logger.error('database', 'pg pool error', { error: err.message }));

    // Verify connection
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        logger.info('database', 'PostgreSQL connected', { url: process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@') });
    } catch (err) {
        logger.error('database', 'PostgreSQL connection failed', { error: err.message });
        throw err;
    }

    const db = createPgAdapter(pool);
    db._dbMode = 'postgres';
    return db;
}

async function _initSqlite(dbPath) {
    const initSqlJs = require('sql.js');
    const resolved = dbPath === undefined ? DEFAULT_DB_PATH : dbPath;
    const SQL = await initSqlJs();

    let rawDb;
    if (resolved && fs.existsSync(resolved)) {
        rawDb = new SQL.Database(fs.readFileSync(resolved));
        logger.info('database', 'sql.js loaded', { path: resolved });
    } else {
        rawDb = new SQL.Database();
        logger.info('database', 'sql.js new', { path: resolved || 'in-memory' });
    }

    rawDb.run('PRAGMA journal_mode = WAL');
    rawDb.run('PRAGMA foreign_keys = ON');

    const db = {
        _raw: rawDb,
        _dbMode: 'sqlite',
        _dbPath: resolved,

        exec(sql) { rawDb.run(sql); },

        prepare(sql) {
            return {
                run(...params) {
                    rawDb.run(sql, params);
                    const idResult = rawDb.exec('SELECT last_insert_rowid() AS id');
                    const lastId = idResult.length > 0 ? idResult[0].values[0][0] : null;
                    return { lastInsertRowid: lastId, changes: rawDb.getRowsModified() };
                },
                get(...params) {
                    const stmt = rawDb.prepare(sql);
                    stmt.bind(params);
                    if (stmt.step()) {
                        const cols = stmt.getColumnNames();
                        const vals = stmt.get();
                        stmt.free();
                        const row = {};
                        cols.forEach((c, i) => { row[c] = vals[i]; });
                        return row;
                    }
                    stmt.free();
                    return undefined;
                },
                all(...params) {
                    const results = rawDb.exec(sql, params);
                    if (!results || results.length === 0) return [];
                    const cols = results[0].columns;
                    return results[0].values.map(vals => {
                        const row = {};
                        cols.forEach((c, i) => { row[c] = vals[i]; });
                        return row;
                    });
                },
            };
        },

        pragma(str) { try { rawDb.run(`PRAGMA ${str}`); } catch { /* ignore */ } },
        transaction: undefined,

        close() { rawDb.close(); },

        save() {
            if (resolved) {
                const dir = path.dirname(resolved);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(resolved, Buffer.from(rawDb.export()));
            }
        },
    };

    return db;
}

function getDbMode(db) {
    return db && db._dbMode || 'unknown';
}

module.exports = { initDatabase, getDbMode };
