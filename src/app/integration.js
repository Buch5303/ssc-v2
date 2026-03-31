'use strict';

const express = require('express');
const createApprovalRoutes = require('../routes/approvals');
const createWorkflowRoutes = require('../routes/workflows');

function createApp(db) {
    const app = express();

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    app.use((req, res, next) => {
        const t0 = Date.now();
        res.on('finish', () => {
            if (req.path !== '/health') {
                console.log('[http] ' + req.method + ' ' + req.originalUrl + ' ' + res.statusCode + ' ' + (Date.now() - t0) + 'ms');
            }
        });
        next();
    });

    app.get('/health', (_req, res) => {
        res.json({
            status: 'healthy', service: 'ssc-v2', version: '2.0.0',
            timestamp: new Date().toISOString(),
            uptime_s: Math.floor(process.uptime()),
        });
    });

    app.get('/api', (_req, res) => {
        res.json({
            service: 'ssc-v2', version: '2.0.0',
            routes: [
                'GET  /health',
                'GET  /api',
                'GET  /api/approvals',
                'GET  /api/approvals/summary',
                'GET  /api/approvals/:id',
                'POST /api/approvals/:id/approve',
                'POST /api/approvals/:id/reject',
                'POST /api/approvals/:id/cancel',
                'POST /api/workflows/:id/execute',
                'POST /api/workflows/:id/replay',
                'GET  /api/workflows/executions',
                'GET  /api/workflows/executions/:id',
            ],
            routes_count: 12,
        });
    });

    app.use('/api/approvals', createApprovalRoutes(db));
    app.use('/api/workflows', createWorkflowRoutes(db));

    app.use((req, res) => {
        res.status(404).json({ error: 'not_found', path: req.path });
    });

    app.use((err, _req, res, _next) => {
        console.error('[error]', err.stack || err.message);
        res.status(500).json({ error: 'internal_server_error' });
    });

    return app;
}

module.exports = { createApp };
