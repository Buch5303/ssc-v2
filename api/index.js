'use strict';

/**
 * Vercel serverless entry point.
 * Initializes DB + Redis on first cold start, exports Express app.
 * Requires DATABASE_URL (PostgreSQL) — sql.js/WASM not supported on Vercel.
 */

const express = require('express');
const os = require('os');

// Lightweight pre-boot app — handles /health and /version before DB is ready
const preBootApp = express();
preBootApp.use(express.json());
preBootApp.get('/health', (_req, res) => res.status(503).json({
    status: 'booting',
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
    timestamp: new Date().toISOString(),
    error: 'Database not yet initialized'
}));
preBootApp.get('/version', (_req, res) => res.json({
    service: 'ssc-v2',
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
    commitSha: process.env.BUILD_COMMIT_SHA || '7b1f2d0',
    buildTimestamp: process.env.BUILD_TIMESTAMP || 'unknown',
    branchFidelityBaseline: process.env.BASELINE_BRANCH_FIDELITY || 'b78a49d',
    deploymentValidationBaseline: process.env.BASELINE_DEPLOYMENT_VALIDATION || '9c3a9b7',
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
}));

let _app = null;
let _initError = null;

async function initApp() {
    if (_app) return _app;
    if (_initError) throw _initError;

    if (!process.env.DATABASE_URL) {
        _initError = new Error('DATABASE_URL is required on Vercel (sql.js/WASM not supported)');
        throw _initError;
    }

    try {
        const { initDatabase } = require('../src/db/database');
        const { createApp } = require('../src/app/integration');

        const db = await initDatabase();

        // Run PG migrations
        const { runMigrations: runPgMigrations } = require('../src/db/migrate-pg');
        await runPgMigrations(db._pool);

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
        console.log('[vercel] App initialized successfully');
        return _app;
    } catch (err) {
        _initError = err;
        console.error('[vercel] App init failed:', err.message);
        throw err;
    }
}

module.exports = async (req, res) => {
    try {
        const app = await initApp();
        return app(req, res);
    } catch (err) {
        console.error('[vercel] Request failed — app not initialized:', err.message);
        // Serve minimal /version even if init fails
        if (req.url === '/version') return preBootApp(req, res);
        return res.status(503).json({
            status: 'unavailable',
            error: err.message,
            hint: 'Check DATABASE_URL in Vercel environment variables',
            timestamp: new Date().toISOString(),
        });
    }
};
