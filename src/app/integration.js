'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { extractIdentity } = require('../middleware/context');
const { requireTenant } = require('../middleware/tenant-isolation');
const createApprovalRoutes = require('../routes/approvals');
const createWorkflowRoutes = require('../routes/workflows');
const createSupplyChainRoutes = require('../routes/supply-chain');
const logger = require('../common/logger');
const metrics = require('../common/metrics');
const { getDbMode } = require('../db/database');
const { metricsEndpoint } = require('../common/metrics-export');
const tokenService = require('../middleware/token-service');
const createAuthRoutes = require('../routes/auth');
const createDashboardRoutes = require('../routes/dashboard');
const { createDiscoveryRoutes } = require('../routes/discovery');
const { createIntegrityRoutes } = require('../routes/integrity');

function createApp(db, opts = {}) {
    const app = express();
    const redis = opts.redis || null;

    const path = require('path');
    const fs = require('fs');
    // Static assets (dashboard UI)
    const publicDir = path.join(__dirname, '../../public');
    if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Request logging + metrics
    app.use((req, res, next) => {
        const timer = metrics.startTimer();
        metrics.increment('requests.total');
        res.on('finish', () => {
            const ms = timer.end('http.latency', { method: req.method });
            if (req.path !== '/health') logger.info('http', req.method + ' ' + req.originalUrl + ' ' + res.statusCode, { method: req.method, path: req.originalUrl, status: res.statusCode, latency_ms: ms });
            if (res.statusCode >= 500) metrics.increment('errors.total');
        });
        next();
    });

    // Public endpoints
    app.get('/health', async (_r, res) => {
        const checks = {
            status: 'ok',
            environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
            db_mode: getDbMode(db),
            postgres: 'unknown',
            redis: 'unknown',
            uptimeSeconds: process.uptime(),
            timestamp: new Date().toISOString(),
        };
        try {
            const mode = getDbMode(db);
            if (mode === 'postgres') {
                // Direct async query for PG — metrics.healthProbe uses sql.js API only
                await db.prepare('SELECT 1').get();
                checks.postgres = 'ok';
            } else {
                const probe = metrics.healthProbe(db);
                checks.postgres = probe.db_status === 'error' ? 'fail' : 'ok';
            }
        } catch { checks.postgres = 'fail'; }
        if (redis) {
            try { await redis.ping(); checks.redis = 'ok'; }
            catch { checks.redis = 'fail'; }
        } else {
            checks.redis = 'disabled';
        }
        const healthy = checks.postgres !== 'fail' && checks.redis !== 'fail';
        res.status(healthy ? 200 : 503).json(checks);
    });

    app.get('/version', (_r, res) => {
        const os = require('os');
        const { execSync } = require('child_process');
        // Resolve commit SHA: env var (set by CI) → git rev-parse → fallback
        let commitSha = process.env.BUILD_COMMIT_SHA || 'ef3a872';
        if (commitSha === 'ef3a872') {
            try { commitSha = execSync('git rev-parse HEAD', { timeout: 2000 }).toString().trim().slice(0,7); } catch { /* no git in serverless — use baked-in SHA */ }
        }
        res.json({
            service: 'ssc-v2',
            environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
            commitSha,
            buildTimestamp: process.env.BUILD_TIMESTAMP || new Date().toISOString(),
            branchFidelityBaseline: process.env.BASELINE_BRANCH_FIDELITY || 'b78a49d',
            deploymentValidationBaseline: process.env.BASELINE_DEPLOYMENT_VALIDATION || '9c3a9b7',
            hostname: os.hostname(),
            timestamp: new Date().toISOString(),
        });
    });

    app.get('/api', (_r, res) => res.json({ service: 'ssc-v2', version: '2.0.0', db_mode: getDbMode(db), redis: redis ? 'connected' : 'disabled' }));
    app.get('/api/metrics', metricsEndpoint);
    app.get('/metrics', metricsEndpoint); // Prometheus scrape path

    // Auth endpoints: /api/auth/token, /api/auth/refresh, /api/auth/revoke (public — no auth required)
    createAuthRoutes(app);

    // Dashboard aggregation API (public for pilot demo)
    app.use('/api/dashboard', createDashboardRoutes(db, { redis }));
    app.use('/api/discovery', createDiscoveryRoutes(db, { redis }));
    app.use('/api/integrity', createIntegrityRoutes(db, { redis }));
    app.use('/api/cron', createDiscoveryRoutes(db, { redis })); // Vercel cron compatibility

    // Serve dashboard UI
    app.get('/dashboard', (_req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
    });

    // Wire Redis into token service for distributed revocation
    if (redis) { tokenService.setRedis(redis); }

    // Auth + identity + tenant isolation
    app.use('/api', authenticate, extractIdentity, requireTenant);

    // Redis rate limiting — REAL RUNTIME WIRING
    if (redis) {
        const { rateLimitMiddleware } = require('../middleware/redis-rate-limit');
        app.use('/api', rateLimitMiddleware(redis, (req) => {
            if (req.path.includes('/approve') || req.path.includes('/reject')) return 'approval:approve';
            if (req.path.includes('/execute')) return 'workflow:execute';
            if (req.path.includes('/replay')) return 'workflow:replay';
            return '_default';
        }));
        logger.info('integration', 'Redis rate limiting ACTIVE');
    }

    // Redis replay protection — REAL RUNTIME WIRING
    if (redis) {
        const { replayProtectionMiddleware } = require('../middleware/redis-replay-protection');
        app.use('/api', replayProtectionMiddleware(redis));
        logger.info('integration', 'Redis replay protection ACTIVE');
    }

    // Protected routes
    app.use('/api/approvals', createApprovalRoutes(db));
    app.use('/api/workflows', createWorkflowRoutes(db));
    app.use('/api/sc', createSupplyChainRoutes(db));

    // NDJSON log tail — last 100 lines, audit-inspectable (public — no auth required)
    app.get('/logs/tail', async (_req, res) => {
        const logExport = require('../common/log-export');
        const fs = require('fs');
        const path = require('path');
        const logPath = logExport.getPath ? logExport.getPath() : (process.env.LOG_EXPORT_PATH || null);
        if (!logPath) return res.json({ status: 'no_log_path', lines: [] });
        try {
            if (!fs.existsSync(logPath)) return res.json({ status: 'log_not_yet_written', path: logPath, lines: [] });
            const raw = fs.readFileSync(logPath, 'utf-8');
            const lines = raw.trim().split('\n').filter(Boolean).slice(-100).map(l => { try { return JSON.parse(l); } catch { return l; } });
            return res.json({ status: 'ok', path: logPath, count: lines.length, lines });
        } catch (err) {
            return res.json({ status: 'error', error: err.message, lines: [] });
        }
    });

    app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
    app.use((err, _r, res, _n) => { logger.error('http', err.message); metrics.increment('errors.total'); res.status(500).json({ error: 'internal_server_error' }); });
    return app;
}
module.exports = { createApp };
