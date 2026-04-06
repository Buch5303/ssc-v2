'use strict';
const { Pool } = require('pg');
const logger = require('../common/logger');

let _pool = null;

function getPool() {
    if (_pool) return _pool;
    const config = {
        connectionString: process.env.DATABASE_URL || null,
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT, 10) || 5432,
        database: process.env.PG_DATABASE || 'ssc_v2',
        user: process.env.PG_USER || 'ssc',
        password: process.env.PG_PASSWORD || '',
        max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };
    if (config.connectionString) {
        _pool = new Pool({ connectionString: config.connectionString, max: config.max });
    } else {
        _pool = new Pool(config);
    }
    _pool.on('error', (err) => logger.error('pg-client', 'pool error', { error: err.message }));
    logger.info('pg-client', 'pool created', { host: config.host, database: config.database, max: config.max });
    return _pool;
}

async function query(sql, params) {
    const pool = getPool();
    return pool.query(sql, params);
}

async function withTransaction(fn) {
    const pool = getPool();
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

async function withRowLock(client, table, id) {
    const result = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    return result.rows[0] || null;
}

async function withAdvisoryLock(client, lockKey) {
    const hash = Math.abs(lockKey.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0));
    await client.query('SELECT pg_advisory_xact_lock($1)', [hash]);
}

async function setTenantContext(client, orgId) {
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);
}

async function healthCheck() {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT 1 AS ok');
        return { healthy: true, rows: result.rows[0] };
    } catch (err) {
        return { healthy: false, error: err.message };
    }
}

async function close() {
    if (_pool) { await _pool.end(); _pool = null; }
}

module.exports = { getPool, query, withTransaction, withRowLock, withAdvisoryLock, setTenantContext, healthCheck, close };
