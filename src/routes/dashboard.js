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


    // GET /api/dashboard/trend — simulated 30-day trend data for charts
    router.get('/trend', async (req, res) => {
        try {
            // Generate 30-day trend window — mix of real counts + smooth simulation
            const days = 30;
            const now = new Date();
            const trend = [];

            let baseApprovals = 0;
            try {
                const r = await db.prepare('SELECT COUNT(*) as cnt FROM approval_requests').get();
                baseApprovals = parseInt(r?.cnt, 10) || 0;
            } catch { /* empty */ }

            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const label = d.toISOString().slice(5, 10); // MM-DD
                // Smooth simulated growth curve + noise
                const progress = (days - i) / days;
                const base = Math.floor(baseApprovals * progress);
                const noise = Math.floor(Math.random() * 3);
                const requests = Math.max(0, base + noise);
                const approved = Math.floor(requests * (0.72 + Math.random() * 0.15));
                const pending = Math.max(0, requests - approved - Math.floor(Math.random() * 2));
                trend.push({
                    date: label,
                    requests,
                    approved,
                    pending,
                    risk_events: Math.floor(Math.random() * 3),
                    latency_ms: Math.floor(50 + Math.random() * 80),
                });
            }

            res.json({ status: 'ok', timestamp: new Date().toISOString(), days, trend });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/dashboard/seed — seed demo data (pilot only)
    router.post('/seed', async (req, res) => {
        try {
            if (process.env.APP_ENV !== 'pilot' && process.env.NODE_ENV !== 'development') {
                return res.status(403).json({ error: 'seed_only_available_in_pilot' });
            }

            const results = { suppliers: 0, parts: 0, warehouses: 0, approvals: 0, errors: [] };

            const SUPPLIERS = [
                { name: 'Siemens Energy AG', category: 'OEM', status: 'active', country: 'DE' },
                { name: 'GE Vernova', category: 'OEM', status: 'active', country: 'US' },
                { name: 'Sulzer Ltd', category: 'Aftermarket', status: 'active', country: 'CH' },
                { name: 'Chromalloy Gas Turbine', category: 'Repair', status: 'active', country: 'US' },
                { name: 'MTU Maintenance', category: 'MRO', status: 'active', country: 'DE' },
                { name: 'Parker Hannifin', category: 'Components', status: 'active', country: 'US' },
                { name: 'Honeywell Process', category: 'Controls', status: 'active', country: 'US' },
                { name: 'Turbine Truck Engines', category: 'Aftermarket', status: 'watch', country: 'US' },
                { name: 'TransDigm Group', category: 'Components', status: 'active', country: 'US' },
                { name: 'Howmet Aerospace', category: 'Castings', status: 'active', country: 'US' },
                { name: 'API Technologies', category: 'Electronics', status: 'watch', country: 'US' },
                { name: 'Heico Corporation', category: 'Aftermarket', status: 'active', country: 'US' },
            ];

            const PARTS = [
                { part_number: 'W251-HP-BLADE-001', name: 'HP Turbine Blade Stage 1', category: 'Hot Section', unit_cost: 28500, status: 'active' },
                { part_number: 'W251-NOZZLE-001', name: 'First Stage Nozzle Assembly', category: 'Hot Section', unit_cost: 85000, status: 'active' },
                { part_number: 'W251-COMB-001', name: 'Combustion Liner', category: 'Combustor', unit_cost: 42000, status: 'active' },
                { part_number: 'W251-FUEL-NOZZLE', name: 'Fuel Nozzle Assembly', category: 'Combustor', unit_cost: 12800, status: 'active' },
                { part_number: 'W251-COMP-BLADE-R1', name: 'Compressor Blade Row 1', category: 'Cold Section', unit_cost: 8400, status: 'active' },
                { part_number: 'W251-BEARING-1', name: 'Forward Journal Bearing', category: 'Mechanical', unit_cost: 15200, status: 'active' },
                { part_number: 'W251-SEAL-HP', name: 'HP Turbine Seal Pack', category: 'Seals', unit_cost: 6200, status: 'active' },
                { part_number: 'W251-INLET-GUIDE', name: 'Inlet Guide Vane Assembly', category: 'Cold Section', unit_cost: 38000, status: 'active' },
                { part_number: 'GE7FA-BLADE-001', name: 'GE 7FA Stage 1 Bucket', category: 'Hot Section', unit_cost: 52000, status: 'active' },
                { part_number: 'CTRL-PLC-MKVI', name: 'MK VI Control Card', category: 'Controls', unit_cost: 28000, status: 'active' },
                { part_number: 'SENSOR-EGT-001', name: 'EGT Thermocouple Assembly', category: 'Instrumentation', unit_cost: 2400, status: 'active' },
                { part_number: 'W251-CTRL-VALVE', name: 'Fuel Control Valve', category: 'Controls', unit_cost: 9800, status: 'active' },
            ];

            const WAREHOUSES = [
                { name: 'TWP Houston Hub', location: 'Houston, TX', status: 'active', capacity: 50000 },
                { name: 'TWP Newark MRO Center', location: 'Newark, NJ', status: 'active', capacity: 35000 },
                { name: 'TWP Dubai Depot', location: 'Dubai, UAE', status: 'active', capacity: 20000 },
            ];

            // Insert suppliers
            for (const s of SUPPLIERS) {
                try {
                    // Check if already exists
                    const exists = await db.prepare(
                        `SELECT id FROM suppliers WHERE org_id = ? AND name = ? LIMIT 1`
                    ).get('twp', s.name);
                    if (exists) continue;
                    await db.prepare(
                        `INSERT INTO suppliers (org_id, name, category, status, country, metadata_json, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`
                    ).run('twp', s.name, s.category, s.status, s.country, '{}');
                    results.suppliers++;
                } catch (e) { results.errors.push('supplier:' + s.name + ':' + e.message.slice(0,50)); }
            }

            // Insert parts
            for (const p of PARTS) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM parts WHERE org_id = ? AND part_number = ? LIMIT 1`
                    ).get('twp', p.part_number);
                    if (exists) continue;
                    await db.prepare(
                        `INSERT INTO parts (org_id, part_number, name, category, unit_cost, status, metadata_json, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`
                    ).run('twp', p.part_number, p.name, p.category, p.unit_cost, p.status, '{}');
                    results.parts++;
                } catch (e) { results.errors.push('part:' + p.part_number + ':' + e.message.slice(0,50)); }
            }

            // Insert warehouses
            for (const w of WAREHOUSES) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM warehouses WHERE org_id = ? AND name = ? LIMIT 1`
                    ).get('twp', w.name);
                    if (exists) continue;
                    await db.prepare(
                        `INSERT INTO warehouses (org_id, name, location, status, capacity, metadata_json, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`
                    ).run('twp', w.name, w.location, w.status, w.capacity, '{}');
                    results.warehouses++;
                } catch (e) { results.errors.push('warehouse:' + w.name + ':' + e.message.slice(0,50)); }
            }

            // Insert approval requests
            const APPROVALS = [
                { action_key: 'SUPPLIER_QUALIFY', risk_level: 'HIGH', status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'PO_APPROVE_LARGE', risk_level: 'HIGH', status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'PART_QUALIFY_NEW', risk_level: 'MEDIUM', status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'SUPPLIER_QUALIFY', risk_level: 'MEDIUM', status: 'PENDING', user: 'ops-team' },
                { action_key: 'PO_APPROVE_LARGE', risk_level: 'HIGH', status: 'PENDING', user: 'ops-team' },
                { action_key: 'INVENTORY_ADJUST', risk_level: 'LOW', status: 'APPROVED', user: 'warehouse-mgr' },
                { action_key: 'VENDOR_PAYMENT', risk_level: 'MEDIUM', status: 'APPROVED', user: 'finance' },
                { action_key: 'PART_OBSOLETE', risk_level: 'LOW', status: 'REJECTED', user: 'engineering' },
                { action_key: 'EMERGENCY_PO', risk_level: 'HIGH', status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'SUPPLIER_DISQUALIFY', risk_level: 'HIGH', status: 'PENDING', user: 'ops-team' },
                { action_key: 'INVENTORY_ADJUST', risk_level: 'LOW', status: 'APPROVED', user: 'warehouse-mgr' },
                { action_key: 'PART_QUALIFY_NEW', risk_level: 'LOW', status: 'APPROVED', user: 'engineering' },
            ];

            for (const a of APPROVALS) {
                try {
                    // Ensure policy exists
                    const pExists = await db.prepare(
                        `SELECT id FROM approval_policies WHERE org_id = ? AND action_key = ? LIMIT 1`
                    ).get('twp', a.action_key);
                    if (!pExists) {
                        await db.prepare(
                            `INSERT INTO approval_policies (org_id, action_key, approval_mode, risk_level, is_active)
                             VALUES (?, ?, ?, ?, true)`
                        ).run('twp', a.action_key, a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE', a.risk_level);
                    }

                    const daysAgo = Math.floor(Math.random()*30);
                    const r = await db.prepare(
                        `INSERT INTO approval_requests
                         (org_id, target_type, target_id, action_key, request_status, approval_mode,
                          risk_level, requested_by_user_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL '${daysAgo} days', NOW())
                         RETURNING id`
                    ).get('twp', 'supply_chain_entity', 'demo-' + Math.random().toString(36).slice(2,8),
                        a.action_key, a.status, a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE',
                        a.risk_level, a.user);

                    if (a.status === 'APPROVED' && r?.id) {
                        await db.prepare(
                            `UPDATE approval_requests SET approved_by_user_id = ?, resolved_at = NOW() WHERE id = ?`
                        ).run('gbuchanan', r.id);
                    }
                    results.approvals++;
                } catch (e) { results.errors.push('approval:' + a.action_key + ':' + e.message.slice(0,80)); }
            }

            res.json({ status: 'ok', seeded: results, timestamp: new Date().toISOString() });
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
