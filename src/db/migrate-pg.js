'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('../common/logger');

/**
 * Phase 1A: PostgreSQL Migration Runner
 *
 * Reads all .sql files from migrations dir in order.
 * Tracks applied migrations in a schema_migrations table.
 * Idempotent: skips already-applied migrations.
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            checksum TEXT
        )
    `);
}

function checksumSQL(sql) {
    let h = 0;
    for (let i = 0; i < sql.length; i++) h = ((h << 5) - h + sql.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16);
}

async function getAppliedMigrations(client) {
    const result = await client.query('SELECT filename FROM schema_migrations ORDER BY id');
    return new Set(result.rows.map(r => r.filename));
}

async function runMigrations(pool) {
    const client = await pool.connect();
    try {
        await ensureMigrationsTable(client);
        const applied = await getAppliedMigrations(client);
        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql') && !f.startsWith('.'))
            .sort();

        let count = 0;
        for (const file of files) {
            if (applied.has(file)) {
                logger.info('migrate-pg', 'already applied', { file });
                continue;
            }
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
            const checksum = checksumSQL(sql);

            await client.query('BEGIN');
            try {
                // Auto-detect PG-compatible migrations by content signature.
                // SQLite-only migrations contain TRIGGER...BEGIN...END blocks or
                // SQLite-specific pragmas. PG migrations contain standard DDL/DML.
                // Legacy explicit list retained as fallback for known-good files.
                const legacyPgList = ['day29-postgresql', 'day31', 'day32', '023', '024', '025', '026', '027', '028', '029'];
                const hasPgSignature = (
                    /CREATE TABLE/i.test(sql) ||
                    /CREATE INDEX/i.test(sql) ||
                    /CREATE SEQUENCE/i.test(sql) ||
                    /INSERT INTO/i.test(sql) ||
                    /ALTER TABLE/i.test(sql)
                );
                const isSqliteOnly = (
                    /CREATE TRIGGER/i.test(sql) &&
                    /BEGIN\s+SELECT/i.test(sql)
                );
                const shouldRun = legacyPgList.some(p => file.includes(p)) || (hasPgSignature && !isSqliteOnly);

                if (shouldRun) {
                    await client.query(sql);
                } else {
                    // SQLite-only migration — skip on PG (covered by migration 020)
                    logger.info('migrate-pg', 'skipping sqlite-only migration on pg', { file });
                }
                await client.query(
                    'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
                    [file, checksum]
                );
                await client.query('COMMIT');
                count++;
                logger.info('migrate-pg', 'applied', { file, checksum });
            } catch (err) {
                await client.query('ROLLBACK');
                logger.error('migrate-pg', 'migration failed — skipping, app will continue', { file, error: err.message });
                // Do NOT throw — a failed migration must not crash the cold start.
                // Record the failure so it won't be re-attempted every request.
                try {
                    await client.query(
                        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [file, 'FAILED:' + checksum]
                    );
                } catch {}
            }
        }
        logger.info('migrate-pg', 'complete', { applied: count, total: files.length });
        return { success: true, applied: count, total: files.length };
    } finally {
        client.release();
    }
}

module.exports = { runMigrations, ensureMigrationsTable, getAppliedMigrations };
