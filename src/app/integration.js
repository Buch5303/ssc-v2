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

function createApp(db, opts = {}) {
    const app = express();
    const redis = opts.redis || null;

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
        const probe = metrics.healthProbe(db);
        probe.db_mode = getDbMode(db);
        probe.redis = redis ? 'connected' : 'disabled';
        if (redis) {
            try { await redis.ping(); probe.redis_healthy = true; }
            catch { probe.redis_healthy = false; }
        }
        res.json(probe);
    });
    app.get('/api', (_r, res) => res.json({ service: 'ssc-v2', version: '2.0.0', db_mode: getDbMode(db), redis: redis ? 'connected' : 'disabled' }));
    app.get('/api/metrics', metricsEndpoint);
    app.get('/metrics', metricsEndpoint); // Prometheus scrape path

    // Token endpoints (public — no auth required)
    app.post('/api/auth/token', async (req, res) => {
        try {
            const { user_id, org_id } = req.body;
            if (!user_id || !org_id) return res.status(400).json({ error: 'user_id_and_org_id_required' });
            const result = tokenService.issueTokenPair(user_id, org_id);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
    app.post('/api/auth/refresh', async (req, res) => {
        try {
            const { refresh_token } = req.body;
            if (!refresh_token) return res.status(400).json({ error: 'refresh_token_required' });
            const result = await tokenService.refreshAccessToken(refresh_token);
            res.status(result.success ? 200 : 401).json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
    app.post('/api/auth/revoke', async (req, res) => {
        try {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: 'token_required' });
            const decoded = require('jsonwebtoken').decode(token);
            if (decoded && decoded.jti) {
                await tokenService.revokeToken(decoded.jti, decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900);
            }
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
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

    app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
    app.use((err, _r, res, _n) => { logger.error('http', err.message); metrics.increment('errors.total'); res.status(500).json({ error: 'internal_server_error' }); });
    return app;
}
module.exports = { createApp };
