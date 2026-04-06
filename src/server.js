'use strict';

const { initDatabase, getDbMode } = require('./db/database');
const { runMigrations } = require('./db/migrate');
const { createApp } = require('./app/integration');
const logger = require('./common/logger');

const PORT = parseInt(process.env.PORT, 10) || 3000;

async function main() {
    console.log('========================================');
    console.log(' SSC Supply Chain V2');
    console.log('========================================');

    // Database init — real runtime switch
    const db = await initDatabase();
    const mode = getDbMode(db);
    console.log('[boot] Database mode: ' + mode);

    if (mode === 'postgres') {
        // Run PG migrations
        const { runMigrations: runPgMigrations } = require('./db/migrate-pg');
        try {
            const result = await runPgMigrations(db._pool);
            console.log('[boot] PG migrations: ' + result.applied + ' applied');
        } catch (err) {
            console.error('[boot] PG migration FAILED:', err.message);
            process.exit(1);
        }
    } else {
        // sql.js migrations
        const mig = runMigrations(db);
        console.log('[boot] SQLite migrations: ' + mig.applied.length + ' applied, ' + mig.skipped.length + ' skipped');
        if (mig.errors.length) {
            console.error('[boot] Migration errors:', mig.errors);
            process.exit(1);
        }
    }

    // Redis init (optional)
    let redis = null;
    if (process.env.REDIS_URL || process.env.REDIS_HOST) {
        try {
            const { getClient } = require('./db/redis-client');
            redis = getClient();
            console.log('[boot] Redis: connecting...');
        } catch (err) {
            console.warn('[boot] Redis unavailable:', err.message);
        }
    } else {
        console.log('[boot] Redis: not configured (no REDIS_URL)');
    }

    // Durable worker queue schema (sql.js mode)
    if (mode === 'sqlite') {
        try {
            const durableQueue = require('./services/durable-worker-queue');
            durableQueue.initSchema(db);
            console.log('[boot] Durable queue schema: ready');
        } catch (err) {
            console.warn('[boot] Durable queue schema:', err.message);
        }
    }

    const app = createApp(db, { redis });
    app.listen(PORT, () => {
        console.log('[boot] Listening on port ' + PORT);
        console.log('[boot] Auth mode: ' + (process.env.AUTH_MODE || 'not_configured'));
        console.log('[boot] DB mode: ' + mode);
        console.log('[boot] Redis: ' + (redis ? 'connected' : 'disabled'));
        console.log('========================================');
    });
}

main().catch(err => { console.error('[boot] FATAL:', err); process.exit(1); });
