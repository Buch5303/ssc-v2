'use strict';
/**
 * FlowSeer Dashboard API — semantic aggregation layer
 * Provides pre-computed, presentation-ready data for the dashboard.
 * Public endpoints (no auth) for pilot dashboard demo.
 * All data is aggregated and semantically transformed for C-suite clarity.
 */
const express = require('express');
const metrics = require('../common/metrics');

function createDashboardRoutes(db, opts = {}) {
    const router = express.Router();
    const redis = opts.redis || null;

    // GET /api/dashboard/summary — master KPI snapshot
    router.get('/summary', async (req, res) => {
        try {
            const snapshot = metrics.snapshot ? metrics.snapshot() : {};
            const uptime = process.uptime();
            const dbMode = db && db._pool ? 'postgres' : 'sqlite';

            let redisStatus = 'disabled';
            if (redis) {
                try { await redis.ping(); redisStatus = 'ok'; } catch { redisStatus = 'degraded'; }
            }

            // Pull approval summary if DB available
            let approvalSummary = { pending: 0, approved: 0, rejected: 0, total: 0 };
            let scSummary = { suppliers: 0, parts: 0, purchase_orders: 0, warehouses: 0 };

            if (db) {
                try {
                    const r = await db.prepare(
                        `SELECT request_status, COUNT(*) as cnt FROM approval_requests GROUP BY request_status`
                    ).all();
                    r.forEach(row => {
                        const s = (row.request_status || '').toLowerCase();
                        const c = parseInt(row.cnt, 10) || 0;
                        approvalSummary.total += c;
                        if (s === 'pending') approvalSummary.pending = c;
                        else if (s === 'approved') approvalSummary.approved = c;
                        else if (s === 'rejected') approvalSummary.rejected = c;
                    });
                } catch { /* table may not exist yet */ }

                try {
                    const tables = ['suppliers', 'parts', 'purchase_orders', 'warehouses'];
                    for (const t of tables) {
                        try {
                            const r = await db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get();
                            scSummary[t] = parseInt(r?.cnt, 10) || 0;
                        } catch { /* table may not exist */ }
                    }
                } catch { /* ignore */ }
            }

            const approvalRate = approvalSummary.total > 0
                ? Math.round((approvalSummary.approved / approvalSummary.total) * 100)
                : 0;

            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
                platform: {
                    uptime_seconds: Math.floor(uptime),
                    uptime_human: _humanUptime(uptime),
                    db_mode: dbMode,
                    redis_status: redisStatus,
                    baseline: process.env.BASELINE_BRANCH_FIDELITY || 'b78a49d',
                },
                kpis: {
                    approval_rate_pct: approvalRate,
                    pending_approvals: approvalSummary.pending,
                    total_approvals: approvalSummary.total,
                    total_suppliers: scSummary.suppliers,
                    total_parts: scSummary.parts,
                    total_purchase_orders: scSummary.purchase_orders,
                    total_warehouses: scSummary.warehouses,
                },
                metrics: snapshot,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/governance — approval governance deep view
    router.get('/governance', async (req, res) => {
        try {
            let byStatus = [];
            let byRisk = [];
            let recent = [];

            if (db) {
                try {
                    byStatus = await db.prepare(
                        `SELECT request_status as status, COUNT(*) as count,
                         COUNT(CASE WHEN risk_level='HIGH' THEN 1 END) as high_risk
                         FROM approval_requests GROUP BY request_status ORDER BY count DESC`
                    ).all();
                } catch { /* empty */ }

                try {
                    byRisk = await db.prepare(
                        `SELECT risk_level, COUNT(*) as count, request_status as status
                         FROM approval_requests GROUP BY risk_level, request_status`
                    ).all();
                } catch { /* empty */ }

                try {
                    recent = await db.prepare(
                        `SELECT id, org_id, action_key, request_status, risk_level, created_at
                         FROM approval_requests ORDER BY created_at DESC LIMIT 10`
                    ).all();
                } catch { /* empty */ }
            }

            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                by_status: byStatus,
                by_risk: byRisk,
                recent_requests: recent,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/supply-chain — SC entity status
    router.get('/supply-chain', async (req, res) => {
        try {
            const entities = {};
            const entityDefs = [
                { key: 'suppliers', table: 'suppliers', statusCol: 'status' },
                { key: 'parts', table: 'parts', statusCol: 'status' },
                { key: 'purchase_orders', table: 'purchase_orders', statusCol: 'status' },
                { key: 'warehouses', table: 'warehouses', statusCol: 'status' },
                { key: 'shipments', table: 'shipments', statusCol: 'status' },
                { key: 'inventory', table: 'inventory', statusCol: null },
            ];

            if (db) {
                for (const def of entityDefs) {
                    try {
                        const total = await db.prepare(`SELECT COUNT(*) as cnt FROM ${def.table}`).get();
                        entities[def.key] = { total: parseInt(total?.cnt, 10) || 0 };
                        if (def.statusCol) {
                            const byStatus = await db.prepare(
                                `SELECT ${def.statusCol} as status, COUNT(*) as count FROM ${def.table} GROUP BY ${def.statusCol}`
                            ).all();
                            entities[def.key].by_status = byStatus;
                        }
                    } catch { entities[def.key] = { total: 0, by_status: [] }; }
                }
            }

            res.json({ status: 'ok', timestamp: new Date().toISOString(), entities });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/system-health — infrastructure health
    router.get('/system-health', async (req, res) => {
        try {
            const snap = metrics.snapshot ? metrics.snapshot() : {};
            let dbOk = false;
            let redisOk = false;

            if (db) {
                try { await db.prepare('SELECT 1').get(); dbOk = true; } catch { /* nope */ }
            }
            if (redis) {
                try { await redis.ping(); redisOk = true; } catch { /* nope */ }
            }

            const totalReq = parseInt(snap.requests_total || snap['requests.total'] || 0);
            const totalErr = parseInt(snap.errors_total || snap['errors.total'] || 0);
            const errorRate = totalReq > 0 ? ((totalErr / totalReq) * 100).toFixed(2) : '0.00';

            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                services: {
                    api: { status: 'ok', uptime_seconds: Math.floor(process.uptime()) },
                    database: { status: dbOk ? 'ok' : 'degraded', mode: db?._pool ? 'postgres' : 'sqlite' },
                    redis: { status: redisOk ? 'ok' : (redis ? 'degraded' : 'disabled') },
                },
                traffic: {
                    total_requests: totalReq,
                    total_errors: totalErr,
                    error_rate_pct: parseFloat(errorRate),
                },
                environment: {
                    node_version: process.version,
                    platform: process.platform,
                    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                },
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

function _humanUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${Math.floor(seconds % 60)}s`;
}

module.exports = createDashboardRoutes;
