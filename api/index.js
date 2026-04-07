'use strict';

/**
 * Vercel serverless entry point.
 * Initializes DB + Redis on first cold start, exports Express app.
 */

const { initDatabase } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrate');
const { createApp } = require('../src/app/integration');

let _app = null;

async function getApp() {
    if (_app) return _app;

    const db = await initDatabase();
    const mig = runMigrations(db);
    if (mig.errors && mig.errors.length) {
        console.error('[vercel] Migration errors:', mig.errors);
    }

    let redis = null;
    if (process.env.REDIS_URL) {
        try {
            const { getClient } = require('../src/db/redis-client');
            redis = getClient();
        } catch (err) {
            console.warn('[vercel] Redis unavailable:', err.message);
        }
    }

    _app = createApp(db, { redis });
    return _app;
}

module.exports = async (req, res) => {
    const app = await getApp();
    return app(req, res);
};
