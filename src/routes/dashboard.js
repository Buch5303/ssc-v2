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
                { part_number: 'TG20-GTU-001', name: 'GT Model TG20B7/8UG - flange to flange turbine', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-002', name: 'Baseplate', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-003', name: 'Transport Tools', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-004', name: 'GT instrumentation (flame scanners, igniters)', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-005', name: 'GT instrumentation (thermocouples disc cavity, rotor cooling, bearing)', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-006', name: 'Turbine Insulation (fixed)', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-007', name: 'Mobile GT Insulation', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-008', name: 'GT Electrical Equipment, Cables and Junction Boxes', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-009', name: 'Foundation accessories for shaft line (Gen excl.)', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-010', name: 'Special Tools', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-011', name: 'Lifting Tools', category: 'Gas Turbine Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTU-012', name: 'Specific to TG20B78UG in case of DLN combustion:', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-013', name: 'Modification for modulating IGV', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-014', name: 'Machining of 8 flanges', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-015', name: 'Modification of 6 holes', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-016', name: 'Flash-back thermocouples', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-017', name: 'Injectors (DLN version)', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-018', name: 'Transition (DLN version)', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GTU-019', name: 'Baskets (DLN version)', category: 'Gas Turbine Unit', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GU-020', name: 'Generator (Air Cooled) with Canopy', category: 'Generator Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GU-021', name: 'Exciter (Brushless)', category: 'Generator Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GU-022', name: 'Exciter Regulator (AVR)', category: 'Generator Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-GU-023', name: 'Neutral Cubicle and Board', category: 'Generator Unit', system: 'STD', status: 'active' },
                { part_number: 'TG20-RG-024', name: 'Reduction Gearbox between Generator and Turbine', category: 'Reduction Gearbox', system: 'STD', status: 'active' },
                { part_number: 'TG20-RG-025', name: 'Thermocouples', category: 'Reduction Gearbox', system: 'STD', status: 'active' },
                { part_number: 'TG20-RG-026', name: 'Overspeed device', category: 'Reduction Gearbox', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-027', name: 'Diesel Engine', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-028', name: 'Control Board with SW', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-029', name: 'Radiator', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-030', name: 'Air and fuel oil Filters', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-031', name: 'Piping', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-032', name: 'Engine baseplate', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-033', name: 'Joint (Diesel-Multiplier)', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-034', name: 'Multiplier', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-035', name: 'Joint (Multiplier-Converter)', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-036', name: 'Torque Converter', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-037', name: 'Brakes', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-038', name: 'Joint (Converter-Turning gear)', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-039', name: 'Turning Gear with motor and clutch', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-040', name: 'SSS Clutch', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-041', name: 'Joint (Turning gear-Generator)', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-042', name: 'Baseplate', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-043', name: 'Platform, Handrails and Access Staircases', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-044', name: 'Package Assembly', category: 'Starting Package (Diesel Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-SP(-045', name: 'Electric motor', category: 'Starting Package (Electric Engine based)', system: 'STD', status: 'active' },
                { part_number: 'TG20-CJ-046', name: 'Generator/Reduction gearbox Joint (incl. tie bolts)', category: 'Coupling joints', system: 'STD', status: 'active' },
                { part_number: 'TG20-CJ-047', name: 'Reduction gearbox/Turbine Joint (incl. tie bolts)', category: 'Coupling joints', system: 'STD', status: 'active' },
                { part_number: 'TG20-CJ-048', name: 'Speed pickup', category: 'Coupling joints', system: 'STD', status: 'active' },
                { part_number: 'TG20-CJ-049', name: 'Covers', category: 'Coupling joints', system: 'STD', status: 'active' },
                { part_number: 'TG20-BAS-050', name: 'By-Pass Valves', category: 'Bleed Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-BAS-051', name: 'Piping (prefabricated)', category: 'Bleed Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-BAS-052', name: 'Orifices', category: 'Bleed Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-BAS-053', name: 'Instruments', category: 'Bleed Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-AAI-054', name: 'Air Compressor and tank (for NG version)', category: 'Atomizing and Instrument Air System', system: 'NG', status: 'active' },
                { part_number: 'TG20-AAI-055', name: 'Air Compressor and tank (for NG+DO / HFO version)', category: 'Atomizing and Instrument Air System', system: 'DO', status: 'active' },
                { part_number: 'TG20-AAI-056', name: 'Drier', category: 'Atomizing and Instrument Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-AAI-057', name: 'Components for sweep air', category: 'Atomizing and Instrument Air System', system: 'DO', status: 'active' },
                { part_number: 'TG20-AAI-058', name: 'Components for continuous atomizing', category: 'Atomizing and Instrument Air System', system: 'DO', status: 'active' },
                { part_number: 'TG20-AAI-059', name: 'Piping for atomizing air', category: 'Atomizing and Instrument Air System', system: 'DO', status: 'active' },
                { part_number: 'TG20-AAI-060', name: 'Additional equipment (solenoids, pressure regulators, tubing) for HFO operation', category: 'Atomizing and Instrument Air System', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AAI-061', name: 'Pneumatic rack for water injection valves control', category: 'Atomizing and Instrument Air System', system: 'DLN WIS', status: 'active' },
                { part_number: 'TG20-CAS-062', name: 'Air to Air Cooler', category: 'Cooling Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-CAS-063', name: 'Water to Air Cooler', category: 'Cooling Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-CAS-064', name: 'Piping', category: 'Cooling Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-CAS-065', name: 'Inertial Filters, supports, miscellanea', category: 'Cooling Air System', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-066', name: 'Auxiliary Skid with:', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-067', name: 'Oil Tank', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-068', name: 'Main Pump (located on gearbox)', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-069', name: 'DC Emergency Pump', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-070', name: 'AC Auxiliary Pump', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-071', name: 'Valves (oil PCV, TCV-cooler bypass and Torque Converter)', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-072', name: 'Duplex Filter', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-073', name: 'Piping', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-074', name: 'Air to Oil Cooler', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-LOS-075', name: 'Water to Oil Cooler', category: 'Lube Oil System  (GT and Generator)', system: 'STD', status: 'active' },
                { part_number: 'TG20-FGS-076', name: 'Skid with:', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-077', name: 'Condensate drainage', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-078', name: 'Instruments', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-079', name: 'Filter', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-080', name: 'Valves (regulation)', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-081', name: 'Final Separator', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-082', name: 'Drain and shut off valves on Final Separator', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-083', name: 'Piping from b.l. to final separator and from final separator to fuel gas skid', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-084', name: 'Piping from fuel gas skid to gas turbine', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-FGS-085', name: 'Gas manifold and spools', category: 'Fuel Gas System', system: 'NG', status: 'active' },
                { part_number: 'TG20-DFG-086', name: 'Skid with:', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-087', name: 'Condensate drainage', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-088', name: 'Instruments', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-089', name: 'Filter', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-090', name: 'Valves', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-091', name: 'Final Separator', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-092', name: 'Piping from final separator to fuel gas skid and from fuel gas skid to gas turbine', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFG-093', name: 'Gas manifolds (n.4) and spools', category: 'DLN Fuel Gas System  (pilot, A, B, C)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-FOS-094', name: 'Injection skid including:', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-095', name: 'LP Filter', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-096', name: 'Pump', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-097', name: 'Safety valve', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-098', name: 'Valves and Instruments', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-099', name: 'Baseplate', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-100', name: 'Regulation skid including:', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-101', name: 'Flow meter', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-102', name: 'Regulation valves', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-103', name: 'Overspeed valve', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-104', name: 'HP Filter and Degassing Filter', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-105', name: 'Drain valve', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-106', name: 'Instruments', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-107', name: 'Baseplate', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-108', name: 'Flow divider skid including:', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-109', name: 'Flow dividers', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-110', name: 'Electromagnetic coupling', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-111', name: 'Hydraulic multiple n.3 block, n.3 drain, n.3 purge valves', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-112', name: 'Instruments', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-113', name: 'Baseplate', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOS-114', name: 'Piping between skids and from Flow divider skid to turbine', category: 'Fuel Oil System', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOD-115', name: 'Drain valve from skid', category: 'Fuel Oil Drain system', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOD-116', name: 'Drain valve from combustors', category: 'Fuel Oil Drain system', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOD-117', name: 'Piping', category: 'Fuel Oil Drain system', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOD-118', name: 'Tank', category: 'Fuel Oil Drain system', system: 'DO', status: 'active' },
                { part_number: 'TG20-FOD-119', name: 'Pump', category: 'Fuel Oil Drain system', system: 'DO', status: 'active' },
                { part_number: 'TG20-DFO-120', name: 'Injection skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-121', name: 'Filter', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-122', name: 'Pump', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-123', name: 'Safety valve', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-124', name: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-125', name: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-126', name: 'Regulation skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-127', name: 'Flow meter', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-128', name: 'Overspeed valve', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-129', name: 'Drain valve', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-130', name: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-131', name: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-132', name: 'Flow divider skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-133', name: 'Flow dividers', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-134', name: 'Hydraulic multiple n.3 block, n.3 drain, n.3 purge valves', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-135', name: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-136', name: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-DFO-137', name: 'Piping between skids and from Flow divider skid to turbine', category: 'DLN Fuel Oil System  (pilot, A, B)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-COS-138', name: 'Control oil and regulation valves for Gas DLN', category: 'Control Oil System (for DLN only)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-COS-139', name: 'Throttle valves for Diesel Oil DLN', category: 'Control Oil System (for DLN only)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-COS-140', name: 'Upgrade of hydraulic rack for Diesel Oil DLN', category: 'Control Oil System (for DLN only)', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-141', name: 'Skid with:', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-142', name: 'Flow meter', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-143', name: 'Regulation valves', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-144', name: 'Isolation valve', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-145', name: 'Purge regulation and stop valves', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-146', name: 'IP converter', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-147', name: 'Solenoids', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-148', name: 'skid with Baseplate', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-149', name: 'Piping from skid to turbine', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-WIS-150', name: 'Piping on turbine: n.3 manifolds and spools', category: 'Water injection System for Fuel Oil DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-MCW-151', name: 'Machinery cooling water equipment (pipes, pumps, valves, air cooler) for Generator cooling system', category: 'Machinery cooling water', system: 'STD', status: 'active' },
                { part_number: 'TG20-COW-152', name: 'Skid with Instruments and Tank, for manual operation', category: 'Compressor Online Washing System', system: 'STD', status: 'active' },
                { part_number: 'TG20-COW-153', name: 'Piping (only turbine assembly)', category: 'Compressor Online Washing System', system: 'STD', status: 'active' },
                { part_number: 'TG20-HFS-154', name: 'upgrade of fuel oil injection pump (centrifugal)', category: 'HFO fuel system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-HFS-155', name: '3-ways valve for return oil', category: 'HFO fuel system', system: 'BOP', status: 'active' },
                { part_number: 'TG20-HFS-156', name: '3-ways valve for supply oil (forwarding)', category: 'HFO fuel system', system: 'BOP', status: 'active' },
                { part_number: 'TG20-AS-157', name: 'Additivation system including:', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-158', name: 'Tank', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-159', name: 'recirculation system with pumps and piping', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-160', name: 'dosing system with pumps and piping', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-161', name: 'Heating, included in Piping Heating system', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-162', name: 'Upgrade of Control system', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-AS-163', name: 'Upgrade of Electrical system', category: 'Additivation system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-164', name: 'Turbine washing system complete with', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-165', name: 'tank with internal steam heater, drains and vents', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-166', name: 'pump', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-167', name: 'instrumentation', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-168', name: 'Heating, included in Piping Heating system', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-TWS-169', name: 'Piping from tank to turbine', category: 'Turbine washing system', system: 'HFO', status: 'active' },
                { part_number: 'TG20-EHF-170', name: 'Panel', category: 'Electrical Heating for DO fuel', system: 'DO', status: 'active' },
                { part_number: 'TG20-EHF-171', name: 'heating cables (from skid to injectors)', category: 'Electrical Heating for DO fuel', system: 'DO', status: 'active' },
                { part_number: 'TG20-EHF-172', name: 'Fuel piping insulation (from skid to injectors)', category: 'Electrical Heating for DO fuel', system: 'DO', status: 'active' },
                { part_number: 'TG20-EHF-173', name: 'Upgrade of Panel for DO heating', category: 'Electrical Heating for HFO fuel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-EHF-174', name: 'heating cables from injection skid to injectors', category: 'Electrical Heating for HFO fuel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-EHF-175', name: 'heating cables of Additive tank piping', category: 'Electrical Heating for HFO fuel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-EHF-176', name: 'Fuel & additive piping insulation', category: 'Electrical Heating for HFO fuel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-EHF-177', name: 'Additive tank electrical heater', category: 'Electrical Heating for HFO fuel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-SHF-178', name: 'Insulation and steam heating (out of package scope) of:', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-SHF-179', name: 'Tank', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-SHF-180', name: 'injection pump skid', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-SHF-181', name: 'HFO return line', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-SHF-182', name: 'HFO drain line', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-SHF-183', name: 'Turbine Washing tank', category: 'Steam Heating for HFO fuel', system: 'BOP', status: 'active' },
                { part_number: 'TG20-HSH-184', name: 'Steam generator for HFO system heating (BOP and inj pump)', category: 'HFO system heating (BOP)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-HSH-185', name: 'upgrade of electrical systems for Steam Generator', category: 'HFO system heating (BOP)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-HSH-186', name: 'HFO piping insulation', category: 'HFO system heating (BOP)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-HSH-187', name: 'steam piping', category: 'HFO system heating (BOP)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-IAF-188', name: 'Filter Room, pulse cleaning type, including', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-189', name: 'Structure', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-190', name: 'Staircases', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-191', name: 'Platforms', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-192', name: 'pulse cleaning compressor system', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-193', name: 'Instruments', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-194', name: 'Transition piece', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAF-195', name: 'Anti icing system', category: 'Inlet Air Filtering System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAD-196', name: 'Horizontal Duct with Silencer', category: 'Inlet Air Duct', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAD-197', name: 'Additional to "Horizontal Duct with Silencer" structure, bend and vertical duct for installation abo', category: 'Inlet Air Duct', system: 'STD', status: 'active' },
                { part_number: 'TG20-IAD-198', name: 'Expansion Joints', category: 'Inlet Air Duct', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-199', name: 'Expansion Joints', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-200', name: 'Exhaust Transition', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-201', name: 'Horizontal Duct with Silencers', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-202', name: 'Bend', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-203', name: 'Stack (10 m, not By-Pass type)', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-204', name: 'Instruments', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-205', name: 'Thermocouples', category: 'Exhaust System', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFS-206', name: 'Fire Fighting Protection (inert gas) for each of this items:', category: 'Fire Fighting System', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFS-207', name: 'Gas Turbine and auxiliareis (including board)', category: 'Fire Fighting System', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFS-208', name: 'filling CO2 bottles', category: 'Fire Fighting System', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFS-209', name: 'Fire Fighting Protection (powder) for GT turbine bearing', category: 'Fire Fighting System', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-210', name: 'Enclosure for each of this items (including ventilation):', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-211', name: 'Turbine', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-212', name: 'Generator', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-213', name: 'Auxiliaries (fuels skids)', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-214', name: 'Auxiliaries (others)', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-215', name: 'Starting Diesel', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-216', name: 'Enclosure for', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-217', name: 'Electrical Room for MV panel, MV generator circuit breaker (with ventilation)', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-218', name: 'Electrical room for MCC, PCC, DC, Batteries, Generator Control Panel, Turbine control panel (with AC', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-E-219', name: 'Air conditioning system', category: 'Enclosures', system: 'STD', status: 'active' },
                { part_number: 'TG20-IP-220', name: 'Local GT Instruments Rack (NG only)', category: 'Instrument Panel', system: 'NG', status: 'active' },
                { part_number: 'TG20-IP-221', name: 'Local GT Instruments Rack (DO only)', category: 'Instrument Panel', system: 'DO', status: 'active' },
                { part_number: 'TG20-IP-222', name: 'Local GT Instruments Rack (upgrade to DO for HFO)', category: 'Instrument Panel', system: 'HFO', status: 'active' },
                { part_number: 'TG20-IP-223', name: 'Piping', category: 'Instrument Panel', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-224', name: 'Insulated Bus Bar Duct 20 m', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-225', name: 'MV panel with CT, PT, circuit breaker', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-226', name: 'Unit transformer (11 kV/380 V)', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-227', name: 'MV cables', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-228', name: 'Auxiliary Transformer 11/0.4 kV 1,3 MVA (50%)', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-229', name: 'Aux Trafo Breaker 11 kV 100 A (50%)', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-MS-230', name: 'steel board (50%)', category: 'MV System', system: 'STD', status: 'active' },
                { part_number: 'TG20-3VS-231', name: 'MCC (Motor Control Center) panels', category: '380 V System', system: 'STD', status: 'active' },
                { part_number: 'TG20-3VS-232', name: 'additional MCC drawers for DO motors', category: '380 V System', system: 'DO', status: 'active' },
                { part_number: 'TG20-3VS-233', name: 'additional MCC drawers for HFO motors', category: '380 V System', system: 'HFO', status: 'active' },
                { part_number: 'TG20-3VS-234', name: 'additional MCC drawers for DO heating', category: '380 V System', system: 'DO', status: 'active' },
                { part_number: 'TG20-3VS-235', name: 'additional MCC drawers for HFO heating', category: '380 V System', system: 'HFO', status: 'active' },
                { part_number: 'TG20-3VS-236', name: 'additional MCC drawers for WIS', category: '380 V System', system: 'DLN', status: 'active' },
                { part_number: 'TG20-3VS-237', name: 'additional MCC drawers for DLN', category: '380 V System', system: 'DLN', status: 'active' },
                { part_number: 'TG20-3VS-238', name: 'PCC (Power Control Center) Boards (Unit)', category: '380 V System', system: 'STD', status: 'active' },
                { part_number: 'TG20-1VD-239', name: 'Inverter 110 V AC', category: '110 V DC System', system: 'STD', status: 'active' },
                { part_number: 'TG20-1VD-240', name: 'Battery Charger', category: '110 V DC System', system: 'STD', status: 'active' },
                { part_number: 'TG20-1VD-241', name: 'Battery container with ventilation', category: '110 V DC System', system: 'STD', status: 'active' },
                { part_number: 'TG20-1VD-242', name: 'Batteries', category: '110 V DC System', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCS-244', name: 'Control Panel T3000, with HMI', category: 'GT Control System DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GCS-245', name: 'upgrade for Fuel Oil DLN', category: 'GT Control System DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GCS-246', name: 'CDPS', category: 'GT Control System DLN', system: 'DLN', status: 'active' },
                { part_number: 'TG20-GCS-247', name: 'S7 400 redundant', category: 'GT Control System standard', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCS-248', name: 'upgrade for DO', category: 'GT Control System standard', system: 'DO', status: 'active' },
                { part_number: 'TG20-GCS-249', name: 'upgrade for HFO', category: 'GT Control System standard', system: 'HFO', status: 'active' },
                { part_number: 'TG20-GCS-250', name: 'remote HMI', category: 'GT Control System standard', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCS-251', name: 'software', category: 'GT Control System standard', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCA-252', name: 'Generator Control Board', category: 'Generator Control and Protection Boards', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCA-253', name: 'Protections', category: 'Generator Control and Protection Boards', system: 'STD', status: 'active' },
                { part_number: 'TG20-GCA-254', name: 'Synchronizing', category: 'Generator Control and Protection Boards', system: 'STD', status: 'active' },
                { part_number: 'TG20-VMS-255', name: 'Board, Sensors and Cables', category: 'Vibration Monitoring System', system: 'STD', status: 'active' },
                { part_number: 'TG20-GDS-256', name: 'Rack for Explosive Mixture Detection', category: 'Gas Detection System', system: 'NG', status: 'active' },
                { part_number: 'TG20-GDS-257', name: 'Detectors etc', category: 'Gas Detection System', system: 'NG', status: 'active' },
                { part_number: 'TG20-LAS-258', name: 'Lamps', category: 'Lighting and sockets (power island)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-LAS-259', name: 'tower', category: 'Lighting and sockets (power island)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-LAS-260', name: 'Sockets', category: 'Lighting and sockets (power island)', system: 'BOP', status: 'active' },
                { part_number: 'TG20-ES-261', name: 'LV Power Cables (power island)', category: 'Electrical Supplies', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-262', name: 'Instrument Cables', category: 'Electrical Supplies', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-263', name: 'Control Cables', category: 'Electrical Supplies', system: 'STD', status: 'active' },
                { part_number: 'TG20-ES-264', name: 'cables additional supplies for DO', category: 'Electrical Supplies', system: 'DO', status: 'active' },
                { part_number: 'TG20-ES-265', name: 'cables additional supplies for HFO', category: 'Electrical Supplies', system: 'HFO', status: 'active' },
                { part_number: 'TG20-ES-266', name: 'Junction Boxes, cable trays, conduits', category: 'Electrical Supplies', system: 'STD', status: 'active' },
                { part_number: 'TG20-BSE-267', name: '800 kVA Emergency diesel generator (one for PSPS)', category: 'Black start equipment', system: 'STD', status: 'active' },
                { part_number: 'TG20-BSE-268', name: 'Other items for Black Start feature', category: 'Black start equipment', system: 'STD', status: 'active' },
                { part_number: 'TG20-SGS-269', name: 'Cables and Accessories', category: 'Secondary Grounding System', system: 'STD', status: 'active' },
                { part_number: 'TG20-IP(-271', name: 'Supports', category: 'Internal piperack (inside GT enclosure)', system: 'STD', status: 'active' },
                { part_number: 'TG20-IP(-272', name: 'Access Platforms', category: 'Internal piperack (inside GT enclosure)', system: 'STD', status: 'active' },
                { part_number: 'TG20-IP(-273', name: 'Handrails', category: 'Internal piperack (inside GT enclosure)', system: 'STD', status: 'active' },
                { part_number: 'TG20-IP(-274', name: 'Staircases', category: 'Internal piperack (inside GT enclosure)', system: 'STD', status: 'active' },
                { part_number: 'TG20-PIA-275', name: 'Painting of Structures, Skids, Handrails, Piping, Equipment (where necessary)', category: 'Painting, Insulation and Accessories', system: 'STD', status: 'active' },
                { part_number: 'TG20-PIA-276', name: 'Insulation (where necessary)', category: 'Painting, Insulation and Accessories', system: 'STD', status: 'active' },
                { part_number: 'TG20-TC-277', name: 'Tool container for site activities', category: 'Tool Container', system: 'STD', status: 'active' },
                { part_number: 'TG20-AFA-278', name: 'Bolts, Nuts, Rods, foundation accessories for Auxiliaries', category: 'Auxiliaries Foundation Accessories', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFO-279', name: 'Lube Oil', category: 'First filling of consumables', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFO-280', name: 'Chemical for Compressor Washing', category: 'First filling of consumables', system: 'STD', status: 'active' },
                { part_number: 'TG20-FFO-281', name: 'Chemical for Turbine Washing', category: 'First filling of consumables', system: 'HFO', status: 'active' },
                { part_number: 'TG20-FFO-282', name: 'Chemical for Additive', category: 'First filling of consumables', system: 'HFO', status: 'active' },
                { part_number: 'TG20-FFO-283', name: 'Oil for Step-Up transformer', category: 'First filling of consumables', system: 'BOP', status: 'active' },
                { part_number: 'TG20-CS-284', name: 'Commissioning spares', category: 'Commissioning spares', system: 'STD', status: 'active' },
                { part_number: 'TG20-WPS-285', name: 'Warranty period spare parts', category: 'Warranty period spare parts', system: 'STD', status: 'active' },
                { part_number: 'TG20-GTS-286', name: 'Gas treatment station sized for n.2 gas turbines', category: 'Gas treatment station', system: 'BOP', status: 'active' },
                { part_number: 'TG20-GTS-287', name: 'additional gas piping from gas treatment station to power islands (assumed ….m)', category: 'Gas treatment station', system: 'BOP', status: 'active' }
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
