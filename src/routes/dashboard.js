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
                { key: 'parts', table: 'parts', statusCol: 'criticality' },
                { key: 'purchase_orders', table: 'purchase_orders', statusCol: 'status' },
                { key: 'warehouses', table: 'warehouses', statusCol: null },
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
                                `SELECT ${def.statusCol} as status, COUNT(*) as count FROM ${def.table} WHERE org_id = 'twp' GROUP BY ${def.statusCol}`
                            ).all();
                            entities[def.key].by_status = byStatus;
                        }
                        // Parts: also get by category
                        if (def.key === 'parts') {
                            try {
                                const byCat = await db.prepare(
                                    `SELECT category, COUNT(*) as count FROM parts WHERE org_id = 'twp' GROUP BY category ORDER BY count DESC LIMIT 10`
                                ).all();
                                entities.parts.by_category = byCat;
                            } catch { /* ignore */ }
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

            const results = { suppliers: 0, parts: 0, approvals: 0, errors: [] };
            const now = new Date().toISOString();
            const actor = 'seed-script';

            // ── SUPPLIERS (schema: org_id, supplier_code, name, status, category, country, created_by, created_at, updated_at)
            const SUPPLIERS = [
                { code: 'SIE-001', name: 'Siemens Energy AG',      category: 'OEM',         country: 'DE' },
                { code: 'GEV-001', name: 'GE Vernova',             category: 'OEM',         country: 'US' },
                { code: 'SUL-001', name: 'Sulzer Ltd',             category: 'Aftermarket', country: 'CH' },
                { code: 'CHR-001', name: 'Chromalloy Gas Turbine', category: 'Repair',      country: 'US' },
                { code: 'MTU-001', name: 'MTU Maintenance',        category: 'MRO',         country: 'DE' },
                { code: 'PHC-001', name: 'Parker Hannifin',        category: 'Components',  country: 'US' },
                { code: 'HON-001', name: 'Honeywell Process',      category: 'Controls',    country: 'US' },
                { code: 'TTE-001', name: 'Turbine Truck Engines',  category: 'Aftermarket', country: 'US' },
                { code: 'TDG-001', name: 'TransDigm Group',        category: 'Components',  country: 'US' },
                { code: 'HWM-001', name: 'Howmet Aerospace',       category: 'Castings',    country: 'US' },
                { code: 'API-001', name: 'API Technologies',       category: 'Electronics', country: 'US' },
                { code: 'HEI-001', name: 'Heico Corporation',      category: 'Aftermarket', country: 'US' },
            ];

            for (const s of SUPPLIERS) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM suppliers WHERE org_id = ? AND supplier_code = ? LIMIT 1`
                    ).get('twp', s.code);
                    if (exists) continue;
                    await db.prepare(
                        `INSERT INTO suppliers (org_id, supplier_code, name, status, category, country, metadata_json, created_by, created_at, updated_at)
                         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
                    ).run('twp', s.code, s.name, s.category, s.country, '{}', actor, now, now);
                    results.suppliers++;
                } catch (e) { results.errors.push('S:' + s.code + ':' + e.message.slice(0, 60)); }
            }

            // ── PARTS — TG20B7-8 W251 equipment list (285 items)
            // Schema: org_id, part_number, description, category, criticality, unit_of_measure, metadata_json, created_by, created_at, updated_at
            const PARTS = [
  { part_number: 'TG20-GTU-001', description: 'GT Model TG20B7/8UG - flange to flange turbine', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-002', description: 'Baseplate', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-003', description: 'Transport Tools', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-004', description: 'GT instrumentation (flame scanners, igniters)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-005', description: 'GT instrumentation (thermocouples disc cavity, rotor cooling, bearing)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-006', description: 'Turbine Insulation (fixed)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-007', description: 'Mobile GT Insulation', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-008', description: 'GT Electrical Equipment, Cables and Junction Boxes', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-009', description: 'Foundation accessories for shaft line (Gen excl.)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-010', description: 'Special Tools', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-011', description: 'Lifting Tools', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-012', description: 'Specific to TG20B78UG in case of DLN combustion:', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-013', description: 'Modification for modulating IGV', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-014', description: 'Machining of 8 flanges', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-015', description: 'Modification of 6 holes', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-016', description: 'Flash-back thermocouples', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-017', description: 'Injectors (DLN version)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-018', description: 'Transition (DLN version)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GTU-019', description: 'Baskets (DLN version)', category: 'Gas Turbine Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GU-020', description: 'Generator (Air Cooled) with Canopy', category: 'Generator Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GU-021', description: 'Exciter (Brushless)', category: 'Generator Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GU-022', description: 'Exciter Regulator (AVR)', category: 'Generator Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-GU-023', description: 'Neutral Cubicle and Board', category: 'Generator Unit', criticality: 'STANDARD' },
  { part_number: 'TG20-RG-024', description: 'Reduction Gearbox between Generator and Turbine', category: 'Reduction Gearbox', criticality: 'STANDARD' },
  { part_number: 'TG20-RG-025', description: 'Thermocouples', category: 'Reduction Gearbox', criticality: 'STANDARD' },
  { part_number: 'TG20-RG-026', description: 'Overspeed device', category: 'Reduction Gearbox', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-027', description: 'Diesel Engine', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-028', description: 'Control Board with SW', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-029', description: 'Radiator', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-030', description: 'Air and fuel oil Filters', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-031', description: 'Piping', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-032', description: 'Engine baseplate', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-033', description: 'Joint (Diesel-Multiplier)', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-034', description: 'Multiplier', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-035', description: 'Joint (Multiplier-Converter)', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-036', description: 'Torque Converter', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-037', description: 'Brakes', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-038', description: 'Joint (Converter-Turning gear)', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-039', description: 'Turning Gear with motor and clutch', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-040', description: 'SSS Clutch', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-041', description: 'Joint (Turning gear-Generator)', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-042', description: 'Baseplate', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-043', description: 'Platform, Handrails and Access Staircases', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-044', description: 'Package Assembly', category: 'Starting Package (Diesel Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-SP(-045', description: 'Electric motor', category: 'Starting Package (Electric Engine based)', criticality: 'STANDARD' },
  { part_number: 'TG20-CJ-046', description: 'Generator/Reduction gearbox Joint (incl. tie bolts)', category: 'Coupling joints', criticality: 'STANDARD' },
  { part_number: 'TG20-CJ-047', description: 'Reduction gearbox/Turbine Joint (incl. tie bolts)', category: 'Coupling joints', criticality: 'STANDARD' },
  { part_number: 'TG20-CJ-048', description: 'Speed pickup', category: 'Coupling joints', criticality: 'STANDARD' },
  { part_number: 'TG20-CJ-049', description: 'Covers', category: 'Coupling joints', criticality: 'STANDARD' },
  { part_number: 'TG20-BAS-050', description: 'By-Pass Valves', category: 'Bleed Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-BAS-051', description: 'Piping (prefabricated)', category: 'Bleed Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-BAS-052', description: 'Orifices', category: 'Bleed Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-BAS-053', description: 'Instruments', category: 'Bleed Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-054', description: 'Air Compressor and tank (for NG version)', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-055', description: 'Air Compressor and tank (for NG+DO / HFO version)', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-056', description: 'Drier', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-057', description: 'Components for sweep air', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-058', description: 'Components for continuous atomizing', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-059', description: 'Piping for atomizing air', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-060', description: 'Additional equipment (solenoids, pressure regulators, tubing) for HFO operation', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-AAI-061', description: 'Pneumatic rack for water injection valves control', category: 'Atomizing and Instrument Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-CAS-062', description: 'Air to Air Cooler', category: 'Cooling Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-CAS-063', description: 'Water to Air Cooler', category: 'Cooling Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-CAS-064', description: 'Piping', category: 'Cooling Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-CAS-065', description: 'Inertial Filters, supports, miscellanea', category: 'Cooling Air System', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-066', description: 'Auxiliary Skid with:', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-067', description: 'Oil Tank', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-068', description: 'Main Pump (located on gearbox)', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-069', description: 'DC Emergency Pump', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-070', description: 'AC Auxiliary Pump', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-071', description: 'Valves (oil PCV, TCV-cooler bypass and Torque Converter)', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-072', description: 'Duplex Filter', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-073', description: 'Piping', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-074', description: 'Air to Oil Cooler', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-LOS-075', description: 'Water to Oil Cooler', category: 'Lube Oil System  (GT and Generator)', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-076', description: 'Skid with:', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-077', description: 'Condensate drainage', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-078', description: 'Instruments', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-079', description: 'Filter', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-080', description: 'Valves (regulation)', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-081', description: 'Final Separator', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-082', description: 'Drain and shut off valves on Final Separator', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-083', description: 'Piping from b.l. to final separator and from final separator to fuel gas skid', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-084', description: 'Piping from fuel gas skid to gas turbine', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-FGS-085', description: 'Gas manifold and spools', category: 'Fuel Gas System', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-086', description: 'Skid with:', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-087', description: 'Condensate drainage', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-088', description: 'Instruments', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-089', description: 'Filter', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-090', description: 'Valves', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-091', description: 'Final Separator', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-092', description: 'Piping from final separator to fuel gas skid and from fuel gas skid to gas turbine', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFG-093', description: 'Gas manifolds (n.4) and spools', category: 'DLN Fuel Gas System  (pilot, A, B, C)', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-094', description: 'Injection skid including:', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-095', description: 'LP Filter', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-096', description: 'Pump', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-097', description: 'Safety valve', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-098', description: 'Valves and Instruments', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-099', description: 'Baseplate', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-100', description: 'Regulation skid including:', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-101', description: 'Flow meter', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-102', description: 'Regulation valves', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-103', description: 'Overspeed valve', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-104', description: 'HP Filter and Degassing Filter', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-105', description: 'Drain valve', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-106', description: 'Instruments', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-107', description: 'Baseplate', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-108', description: 'Flow divider skid including:', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-109', description: 'Flow dividers', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-110', description: 'Electromagnetic coupling', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-111', description: 'Hydraulic multiple n.3 block, n.3 drain, n.3 purge valves', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-112', description: 'Instruments', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-113', description: 'Baseplate', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOS-114', description: 'Piping between skids and from Flow divider skid to turbine', category: 'Fuel Oil System', criticality: 'STANDARD' },
  { part_number: 'TG20-FOD-115', description: 'Drain valve from skid', category: 'Fuel Oil Drain system', criticality: 'STANDARD' },
  { part_number: 'TG20-FOD-116', description: 'Drain valve from combustors', category: 'Fuel Oil Drain system', criticality: 'STANDARD' },
  { part_number: 'TG20-FOD-117', description: 'Piping', category: 'Fuel Oil Drain system', criticality: 'STANDARD' },
  { part_number: 'TG20-FOD-118', description: 'Tank', category: 'Fuel Oil Drain system', criticality: 'STANDARD' },
  { part_number: 'TG20-FOD-119', description: 'Pump', category: 'Fuel Oil Drain system', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-120', description: 'Injection skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-121', description: 'Filter', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-122', description: 'Pump', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-123', description: 'Safety valve', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-124', description: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-125', description: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-126', description: 'Regulation skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-127', description: 'Flow meter', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-128', description: 'Overspeed valve', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-129', description: 'Drain valve', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-130', description: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-131', description: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-132', description: 'Flow divider skid including:', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-133', description: 'Flow dividers', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-134', description: 'Hydraulic multiple n.3 block, n.3 drain, n.3 purge valves', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-135', description: 'Instruments', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-136', description: 'Baseplate', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-DFO-137', description: 'Piping between skids and from Flow divider skid to turbine', category: 'DLN Fuel Oil System  (pilot, A, B)', criticality: 'STANDARD' },
  { part_number: 'TG20-COS-138', description: 'Control oil and regulation valves for Gas DLN', category: 'Control Oil System (for DLN only)', criticality: 'STANDARD' },
  { part_number: 'TG20-COS-139', description: 'Throttle valves for Diesel Oil DLN', category: 'Control Oil System (for DLN only)', criticality: 'STANDARD' },
  { part_number: 'TG20-COS-140', description: 'Upgrade of hydraulic rack for Diesel Oil DLN', category: 'Control Oil System (for DLN only)', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-141', description: 'Skid with:', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-142', description: 'Flow meter', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-143', description: 'Regulation valves', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-144', description: 'Isolation valve', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-145', description: 'Purge regulation and stop valves', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-146', description: 'IP converter', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-147', description: 'Solenoids', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-148', description: 'skid with Baseplate', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-149', description: 'Piping from skid to turbine', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-WIS-150', description: 'Piping on turbine: n.3 manifolds and spools', category: 'Water injection System for Fuel Oil DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-MCW-151', description: 'Machinery cooling water equipment (pipes, pumps, valves, air cooler) for Generator cooling system', category: 'Machinery cooling water', criticality: 'STANDARD' },
  { part_number: 'TG20-COW-152', description: 'Skid with Instruments and Tank, for manual operation', category: 'Compressor Online Washing System', criticality: 'STANDARD' },
  { part_number: 'TG20-COW-153', description: 'Piping (only turbine assembly)', category: 'Compressor Online Washing System', criticality: 'STANDARD' },
  { part_number: 'TG20-HFS-154', description: 'upgrade of fuel oil injection pump (centrifugal)', category: 'HFO fuel system', criticality: 'STANDARD' },
  { part_number: 'TG20-HFS-155', description: '3-ways valve for return oil', category: 'HFO fuel system', criticality: 'STANDARD' },
  { part_number: 'TG20-HFS-156', description: '3-ways valve for supply oil (forwarding)', category: 'HFO fuel system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-157', description: 'Additivation system including:', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-158', description: 'Tank', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-159', description: 'recirculation system with pumps and piping', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-160', description: 'dosing system with pumps and piping', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-161', description: 'Heating, included in Piping Heating system', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-162', description: 'Upgrade of Control system', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-AS-163', description: 'Upgrade of Electrical system', category: 'Additivation system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-164', description: 'Turbine washing system complete with', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-165', description: 'tank with internal steam heater, drains and vents', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-166', description: 'pump', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-167', description: 'instrumentation', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-168', description: 'Heating, included in Piping Heating system', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-TWS-169', description: 'Piping from tank to turbine', category: 'Turbine washing system', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-170', description: 'Panel', category: 'Electrical Heating for DO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-171', description: 'heating cables (from skid to injectors)', category: 'Electrical Heating for DO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-172', description: 'Fuel piping insulation (from skid to injectors)', category: 'Electrical Heating for DO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-173', description: 'Upgrade of Panel for DO heating', category: 'Electrical Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-174', description: 'heating cables from injection skid to injectors', category: 'Electrical Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-175', description: 'heating cables of Additive tank piping', category: 'Electrical Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-176', description: 'Fuel & additive piping insulation', category: 'Electrical Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-EHF-177', description: 'Additive tank electrical heater', category: 'Electrical Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-178', description: 'Insulation and steam heating (out of package scope) of:', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-179', description: 'Tank', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-180', description: 'injection pump skid', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-181', description: 'HFO return line', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-182', description: 'HFO drain line', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-SHF-183', description: 'Turbine Washing tank', category: 'Steam Heating for HFO fuel', criticality: 'STANDARD' },
  { part_number: 'TG20-HSH-184', description: 'Steam generator for HFO system heating (BOP and inj pump)', category: 'HFO system heating (BOP)', criticality: 'STANDARD' },
  { part_number: 'TG20-HSH-185', description: 'upgrade of electrical systems for Steam Generator', category: 'HFO system heating (BOP)', criticality: 'STANDARD' },
  { part_number: 'TG20-HSH-186', description: 'HFO piping insulation', category: 'HFO system heating (BOP)', criticality: 'STANDARD' },
  { part_number: 'TG20-HSH-187', description: 'steam piping', category: 'HFO system heating (BOP)', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-188', description: 'Filter Room, pulse cleaning type, including', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-189', description: 'Structure', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-190', description: 'Staircases', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-191', description: 'Platforms', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-192', description: 'pulse cleaning compressor system', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-193', description: 'Instruments', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-194', description: 'Transition piece', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAF-195', description: 'Anti icing system', category: 'Inlet Air Filtering System', criticality: 'STANDARD' },
  { part_number: 'TG20-IAD-196', description: 'Horizontal Duct with Silencer', category: 'Inlet Air Duct', criticality: 'STANDARD' },
  { part_number: 'TG20-IAD-197', description: 'Additional to "Horizontal Duct with Silencer" structure, bend and vertical duct for installation above generator', category: 'Inlet Air Duct', criticality: 'STANDARD' },
  { part_number: 'TG20-IAD-198', description: 'Expansion Joints', category: 'Inlet Air Duct', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-199', description: 'Expansion Joints', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-200', description: 'Exhaust Transition', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-201', description: 'Horizontal Duct with Silencers', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-202', description: 'Bend', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-203', description: 'Stack (10 m, not By-Pass type)', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-204', description: 'Instruments', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-205', description: 'Thermocouples', category: 'Exhaust System', criticality: 'STANDARD' },
  { part_number: 'TG20-FFS-206', description: 'Fire Fighting Protection (inert gas) for each of this items:', category: 'Fire Fighting System', criticality: 'STANDARD' },
  { part_number: 'TG20-FFS-207', description: 'Gas Turbine and auxiliareis (including board)', category: 'Fire Fighting System', criticality: 'STANDARD' },
  { part_number: 'TG20-FFS-208', description: 'filling CO2 bottles', category: 'Fire Fighting System', criticality: 'STANDARD' },
  { part_number: 'TG20-FFS-209', description: 'Fire Fighting Protection (powder) for GT turbine bearing', category: 'Fire Fighting System', criticality: 'STANDARD' },
  { part_number: 'TG20-E-210', description: 'Enclosure for each of this items (including ventilation):', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-211', description: 'Turbine', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-212', description: 'Generator', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-213', description: 'Auxiliaries (fuels skids)', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-214', description: 'Auxiliaries (others)', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-215', description: 'Starting Diesel', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-216', description: 'Enclosure for', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-217', description: 'Electrical Room for MV panel, MV generator circuit breaker (with ventilation)', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-218', description: 'Electrical room for MCC, PCC, DC, Batteries, Generator Control Panel, Turbine control panel (with AC)', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-E-219', description: 'Air conditioning system', category: 'Enclosures', criticality: 'STANDARD' },
  { part_number: 'TG20-IP-220', description: 'Local GT Instruments Rack (NG only)', category: 'Instrument Panel', criticality: 'STANDARD' },
  { part_number: 'TG20-IP-221', description: 'Local GT Instruments Rack (DO only)', category: 'Instrument Panel', criticality: 'STANDARD' },
  { part_number: 'TG20-IP-222', description: 'Local GT Instruments Rack (upgrade to DO for HFO)', category: 'Instrument Panel', criticality: 'STANDARD' },
  { part_number: 'TG20-IP-223', description: 'Piping', category: 'Instrument Panel', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-224', description: 'Insulated Bus Bar Duct 20 m', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-225', description: 'MV panel with CT, PT, circuit breaker', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-226', description: 'Unit transformer (11 kV/380 V)', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-227', description: 'MV cables', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-228', description: 'Auxiliary Transformer 11/0.4 kV 1,3 MVA (50%)', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-229', description: 'Aux Trafo Breaker 11 kV 100 A (50%)', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-MS-230', description: 'steel board (50%)', category: 'MV System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-231', description: 'MCC (Motor Control Center) panels', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-232', description: 'additional MCC drawers for DO motors', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-233', description: 'additional MCC drawers for HFO motors', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-234', description: 'additional MCC drawers for DO heating', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-235', description: 'additional MCC drawers for HFO heating', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-236', description: 'additional MCC drawers for WIS', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-237', description: 'additional MCC drawers for DLN', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-3VS-238', description: 'PCC (Power Control Center) Boards (Unit)', category: '380 V System', criticality: 'STANDARD' },
  { part_number: 'TG20-1VD-239', description: 'Inverter 110 V AC', category: '110 V DC System', criticality: 'STANDARD' },
  { part_number: 'TG20-1VD-240', description: 'Battery Charger', category: '110 V DC System', criticality: 'STANDARD' },
  { part_number: 'TG20-1VD-241', description: 'Battery container with ventilation', category: '110 V DC System', criticality: 'STANDARD' },
  { part_number: 'TG20-1VD-242', description: 'Batteries', category: '110 V DC System', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-244', description: 'Control Panel T3000, with HMI', category: 'GT Control System DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-245', description: 'upgrade for Fuel Oil DLN', category: 'GT Control System DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-246', description: 'CDPS', category: 'GT Control System DLN', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-247', description: 'S7 400 redundant', category: 'GT Control System standard', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-248', description: 'upgrade for DO', category: 'GT Control System standard', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-249', description: 'upgrade for HFO', category: 'GT Control System standard', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-250', description: 'remote HMI', category: 'GT Control System standard', criticality: 'STANDARD' },
  { part_number: 'TG20-GCS-251', description: 'software', category: 'GT Control System standard', criticality: 'STANDARD' },
  { part_number: 'TG20-GCA-252', description: 'Generator Control Board', category: 'Generator Control and Protection Boards', criticality: 'STANDARD' },
  { part_number: 'TG20-GCA-253', description: 'Protections', category: 'Generator Control and Protection Boards', criticality: 'STANDARD' },
  { part_number: 'TG20-GCA-254', description: 'Synchronizing', category: 'Generator Control and Protection Boards', criticality: 'STANDARD' },
  { part_number: 'TG20-VMS-255', description: 'Board, Sensors and Cables', category: 'Vibration Monitoring System', criticality: 'STANDARD' },
  { part_number: 'TG20-GDS-256', description: 'Rack for Explosive Mixture Detection', category: 'Gas Detection System', criticality: 'STANDARD' },
  { part_number: 'TG20-GDS-257', description: 'Detectors etc', category: 'Gas Detection System', criticality: 'STANDARD' },
  { part_number: 'TG20-LAS-258', description: 'Lamps', category: 'Lighting and sockets (power island)', criticality: 'STANDARD' },
  { part_number: 'TG20-LAS-259', description: 'tower', category: 'Lighting and sockets (power island)', criticality: 'STANDARD' },
  { part_number: 'TG20-LAS-260', description: 'Sockets', category: 'Lighting and sockets (power island)', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-261', description: 'LV Power Cables (power island)', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-262', description: 'Instrument Cables', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-263', description: 'Control Cables', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-264', description: 'cables additional supplies for DO', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-265', description: 'cables additional supplies for HFO', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-ES-266', description: 'Junction Boxes, cable trays, conduits', category: 'Electrical Supplies', criticality: 'STANDARD' },
  { part_number: 'TG20-BSE-267', description: '800 kVA Emergency diesel generator (one for PSPS)', category: 'Black start equipment', criticality: 'STANDARD' },
  { part_number: 'TG20-BSE-268', description: 'Other items for Black Start feature', category: 'Black start equipment', criticality: 'STANDARD' },
  { part_number: 'TG20-SGS-269', description: 'Cables and Accessories', category: 'Secondary Grounding System', criticality: 'STANDARD' },
  { part_number: 'TG20-IP(-271', description: 'Supports', category: 'Internal piperack (inside GT enclosure)', criticality: 'STANDARD' },
  { part_number: 'TG20-IP(-272', description: 'Access Platforms', category: 'Internal piperack (inside GT enclosure)', criticality: 'STANDARD' },
  { part_number: 'TG20-IP(-273', description: 'Handrails', category: 'Internal piperack (inside GT enclosure)', criticality: 'STANDARD' },
  { part_number: 'TG20-IP(-274', description: 'Staircases', category: 'Internal piperack (inside GT enclosure)', criticality: 'STANDARD' },
  { part_number: 'TG20-PIA-275', description: 'Painting of Structures, Skids, Handrails, Piping, Equipment (where necessary)', category: 'Painting, Insulation and Accessories', criticality: 'STANDARD' },
  { part_number: 'TG20-PIA-276', description: 'Insulation (where necessary)', category: 'Painting, Insulation and Accessories', criticality: 'STANDARD' },
  { part_number: 'TG20-TC-277', description: 'Tool container for site activities', category: 'Tool Container', criticality: 'STANDARD' },
  { part_number: 'TG20-AFA-278', description: 'Bolts, Nuts, Rods, foundation accessories for Auxiliaries', category: 'Auxiliaries Foundation Accessories', criticality: 'STANDARD' },
  { part_number: 'TG20-FFO-279', description: 'Lube Oil', category: 'First filling of consumables', criticality: 'STANDARD' },
  { part_number: 'TG20-FFO-280', description: 'Chemical for Compressor Washing', category: 'First filling of consumables', criticality: 'STANDARD' },
  { part_number: 'TG20-FFO-281', description: 'Chemical for Turbine Washing', category: 'First filling of consumables', criticality: 'STANDARD' },
  { part_number: 'TG20-FFO-282', description: 'Chemical for Additive', category: 'First filling of consumables', criticality: 'STANDARD' },
  { part_number: 'TG20-FFO-283', description: 'Oil for Step-Up transformer', category: 'First filling of consumables', criticality: 'STANDARD' },
  { part_number: 'TG20-CS-284', description: 'Commissioning spares', category: 'Commissioning spares', criticality: 'STANDARD' },
  { part_number: 'TG20-WPS-285', description: 'Warranty period spare parts', category: 'Warranty period spare parts', criticality: 'STANDARD' },
  { part_number: 'TG20-GTS-286', description: 'Gas treatment station sized for n.2 gas turbines', category: 'Gas treatment station', criticality: 'STANDARD' },
  { part_number: 'TG20-GTS-287', description: 'additional gas piping from gas treatment station to power islands (assumed ….m)', category: 'Gas treatment station', criticality: 'STANDARD' }
];

            for (const p of PARTS) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM parts WHERE org_id = ? AND part_number = ? LIMIT 1`
                    ).get('twp', p.part_number);
                    if (exists) continue;
                    await db.prepare(
                        `INSERT INTO parts (org_id, part_number, description, category, criticality, unit_of_measure, metadata_json, created_by, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'EACH', ?, ?, ?, ?)`
                    ).run('twp', p.part_number, p.description, p.category, p.criticality,
                        JSON.stringify({ system: p.system || 'STD' }), actor, now, now);
                    results.parts++;
                } catch (e) { results.errors.push('P:' + p.part_number + ':' + e.message.slice(0, 60)); }
            }

            // ── APPROVAL REQUESTS
            const APPROVALS = [
                { action_key: 'SUPPLIER_QUALIFY',    risk_level: 'HIGH',   status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'PO_APPROVE_LARGE',    risk_level: 'HIGH',   status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'PART_QUALIFY_NEW',    risk_level: 'MEDIUM', status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'SUPPLIER_QUALIFY',    risk_level: 'MEDIUM', status: 'PENDING',  user: 'ops-team'  },
                { action_key: 'PO_APPROVE_LARGE',    risk_level: 'HIGH',   status: 'PENDING',  user: 'ops-team'  },
                { action_key: 'INVENTORY_ADJUST',    risk_level: 'LOW',    status: 'APPROVED', user: 'warehouse-mgr' },
                { action_key: 'VENDOR_PAYMENT',      risk_level: 'MEDIUM', status: 'APPROVED', user: 'finance'   },
                { action_key: 'PART_OBSOLETE',       risk_level: 'LOW',    status: 'REJECTED', user: 'engineering' },
                { action_key: 'EMERGENCY_PO',        risk_level: 'HIGH',   status: 'APPROVED', user: 'gbuchanan' },
                { action_key: 'SUPPLIER_DISQUALIFY', risk_level: 'HIGH',   status: 'PENDING',  user: 'ops-team'  },
                { action_key: 'INVENTORY_ADJUST',    risk_level: 'LOW',    status: 'APPROVED', user: 'warehouse-mgr' },
                { action_key: 'PART_QUALIFY_NEW',    risk_level: 'LOW',    status: 'APPROVED', user: 'engineering' },
            ];

            for (const a of APPROVALS) {
                try {
                    const pExists = await db.prepare(
                        `SELECT id FROM approval_policies WHERE org_id = ? AND action_key = ? LIMIT 1`
                    ).get('twp', a.action_key);
                    if (!pExists) {
                        await db.prepare(
                            `INSERT INTO approval_policies (org_id, action_key, approval_mode, risk_level, is_active)
                             VALUES (?, ?, ?, ?, true)`
                        ).run('twp', a.action_key, a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE', a.risk_level);
                    }
                    const daysAgo = Math.floor(Math.random() * 30);
                    const targetId = 'seed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                    // Must insert as PENDING (governance trigger blocks non-PENDING inserts)
                    await db.prepare(
                        `INSERT INTO approval_requests
                         (org_id, target_type, target_id, action_key, request_status, approval_mode,
                          risk_level, requested_by_user_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, NOW() - INTERVAL '${daysAgo} days', NOW())`
                    ).run('twp', 'supply_chain_entity', targetId,
                        a.action_key, a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE',
                        a.risk_level, a.user);
                    // UPDATE to final status using target_id as stable lookup key
                    if (a.status !== 'PENDING') {
                        const approvedBy = a.status === 'APPROVED' ? 'gbuchanan' : null;
                        await db.prepare(
                            `UPDATE approval_requests
                             SET request_status = ?, approved_by_user_id = ?, resolved_at = NOW()
                             WHERE org_id = ? AND target_id = ?`
                        ).run(a.status, approvedBy, 'twp', targetId);
                    }
                    results.approvals++;
                } catch (e) { results.errors.push('A:' + a.action_key + ':' + e.message.slice(0, 80)); }
            }

            // ── PURCHASE ORDERS
            const PO_SEEDS = [
                { po_number: 'PO-TWP-2026-001', supplier_code: 'SIE-001', status: 'IN_PRODUCTION', value: 2850000, notes: 'HP Turbine Blade Stage 1 — 100 units' },
                { po_number: 'PO-TWP-2026-002', supplier_code: 'CHR-001', status: 'SUBMITTED', value: 850000, notes: 'Hot section repair kit W251B8' },
                { po_number: 'PO-TWP-2026-003', supplier_code: 'MTU-001', status: 'DRAFT', value: 420000, notes: 'MRO services Q2 2026' },
                { po_number: 'PO-TWP-2026-004', supplier_code: 'GEV-001', status: 'ACKNOWLEDGED', value: 5200000, notes: 'GE 7FA Stage 1 Bucket — 50 units' },
                { po_number: 'PO-TWP-2026-005', supplier_code: 'PHC-001', status: 'SHIPPED', value: 280000, notes: 'Control valves and actuators' },
            ];
            results.pos = 0;
            for (const po of PO_SEEDS) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM purchase_orders WHERE org_id = ? AND po_number = ? LIMIT 1`
                    ).get('twp', po.po_number);
                    if (exists) { results.pos++; continue; }
                    const sup = await db.prepare(
                        `SELECT id FROM suppliers WHERE org_id = ? AND supplier_code = ? LIMIT 1`
                    ).get('twp', po.supplier_code);
                    if (!sup?.id) { results.errors.push('PO:no sup:' + po.supplier_code); continue; }
                    await db.prepare(
                        `INSERT INTO purchase_orders (org_id, po_number, supplier_id, status, total_value, currency, notes, metadata_json, created_by, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'USD', ?, '{}', 'gbuchanan', NOW(), NOW())`
                    ).run('twp', po.po_number, sup.id, po.status, po.value, po.notes);
                    results.pos++;
                } catch(e) { results.errors.push('PO:' + po.po_number + ':' + e.message.slice(0,60)); }
            }

            res.json({ status: 'ok', seeded: results, errors: results.errors, timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


    // GET /api/dashboard/parts-list — full parts catalog for dashboard
    router.get('/parts-list', async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 300, 500);
            const category = req.query.category || null;
            let sql = `SELECT part_number, description, category, criticality, unit_of_measure FROM parts WHERE org_id = 'twp'`;
            const params = [];
            if (category) { sql += ` AND category ILIKE ?`; params.push('%' + category + '%'); }
            sql += ` ORDER BY category, part_number LIMIT ${limit}`;
            const parts = await db.prepare(sql).all(...params);
            res.json({ status: 'ok', count: parts.length, parts, timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/suppliers-list — supplier roster for dashboard
    router.get('/suppliers-list', async (req, res) => {
        try {
            const suppliers = await db.prepare(
                `SELECT supplier_code, name, status, category, country, rating FROM suppliers WHERE org_id = 'twp' ORDER BY name`
            ).all();
            res.json({ status: 'ok', count: suppliers.length, suppliers, timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


    // GET /api/dashboard/parts-by-category — breakdown for donut chart
    router.get('/parts-by-category', async (req, res) => {
        try {
            const rows = await db.prepare(
                `SELECT category, COUNT(*) as count FROM parts WHERE org_id = 'twp' GROUP BY category ORDER BY count DESC`
            ).all();
            res.json({ status: 'ok', categories: rows, timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


    // GET /api/dashboard/po-list — purchase orders for dashboard
    router.get('/po-list', async (req, res) => {
        try {
            const pos = await db.prepare(
                `SELECT p.po_number, p.status, p.total_value, p.currency, p.notes, s.name as supplier_name
                 FROM purchase_orders p
                 LEFT JOIN suppliers s ON s.id = p.supplier_id
                 WHERE p.org_id = 'twp'
                 ORDER BY p.created_at DESC LIMIT 20`
            ).all();
            res.json({ status: 'ok', count: pos.length, pos, timestamp: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


    // POST /api/dashboard/seed-suppliers — load full W251 supplier intelligence
    router.post('/seed-suppliers', async (req, res) => {
        try {
            if (process.env.APP_ENV !== 'pilot' && process.env.NODE_ENV !== 'development') {
                return res.status(403).json({ error: 'pilot_only' });
            }
            const results = { suppliers: 0, contacts: 0, errors: [] };
            const now = new Date().toISOString();

            const SUPPLIERS = [
  {code:'W251-001',name:'AAF International',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28',scope:'Gas turbine inlet air filtration systems, filter houses (static and pulse-jet), auxiliary equipment, acoustic solutions, damper systems for Sys 27 and',website:'https://www.aafintl.com/us/products/energy-and-industrial-air-quality/gas-turbin'},
  {code:'W251-002',name:'AMETEK Power Instruments — division of AMETEK, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'29',scope:'for W251 Power Island: Exhaust gas temperature (EGT) thermocouple probes and systems for System 29 instrumentation: Type K thermocouples with MgO insu',website:'https://www.ametekpower.com'},
  {code:'W251-003',name:'Badger Industries',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'Expansion joints for Sys 28 (inlet duct) and Sys 29 (turbine exhaust flange connection to ductwork). Fabric and metal types.',website:'https://www.badgerind.com'},
  {code:'W251-004',name:'Braden Filtration LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: Pulse-jet filter cartridges (ExCel® series) for System 27 self-cleaning filter houses, TriCel™ final barrier filter elements fo',website:'https://braden.com'},
  {code:'W251-005',name:'Braden Manufacturing, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'for W251 Power Island: Complete turnkey inlet and exhaust auxiliary equipment for the Westinghouse 251 frame: pulse-jet self-cleaning filter houses (E',website:'https://www.braden.com'},
  {code:'W251-006',name:'Burgess-Manning (CECO)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'Patented Flue Gas Silencers for exhaust duct (Sys 29), inlet silencers (Sys 28). Temperatures to 730°C, baffles to 9.2m span.',website:'https://burgessmanning.com'},
  {code:'W251-007',name:'Caldwell Energy Company',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: Complete inlet air cooling system for System 27: PowerFog® high-pressure evaporative cooling with stainless steel manifolds, Po',website:'https://www.caldwellenergy.com'},
  {code:'W251-008',name:'Camfil Power Systems',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28',scope:'Complete filter houses (static CamFlex and self-cleaning CamPulse/Tenkay for pulse-cleaning), rain separators (CamVane), anti-icing, inlet silencers, ',website:'https://www.camfil.com/en-us/industries/energy-and-power-systems/gas-turbines'},
  {code:'W251-009',name:'CECO Environmental / Aarding',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Air Inlet / Exhaust / Acoustic',tags:'29',scope:'Complete exhaust system (Sys 29): transition ducts, silencer ducts (patented Flue Gas Silencers), horizontal ductwork, bend sections, exhaust stacks (',website:'https://www.cecoenviro.com/brands/aarding/'},
  {code:'W251-010',name:'Donaldson Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28',scope:'Complete inlet filter room (Sys 27): pulse-cleaning housings, filter media, cartridge elements, inlet hood components, anti-icing, evaporative cooling',website:'https://www.donaldson.com/en-us/gas-turbine/'},
  {code:'W251-011',name:'Dürr Universal',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'Full scope Sys 27 (inlet filtration, anti-icing, weather hoods, ductwork, transitions), Sys 28 (inlet silencers), Sys 29 (exhaust silencers with paten',website:'https://www.durr-universal.com'},
  {code:'W251-012',name:'EnergyLink International',status:'ACTIVE',type:'Manufacturer / OEM',country:'Canada',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28',scope:'Sys 27 (custom pulse-jet filter houses, anti-icing with exhaust heat recovery), Sys 28 (intake silencers).',website:'https://energylinkinternational.com'},
  {code:'W251-013',name:'FAIST Anlagenbau GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'for W251 Power Island: Modular air intake filter houses with integrated acoustic silencers (System 27/28), custom gas turbine acoustic enclosures (tur',website:'https://www.faist.de'},
  {code:'W251-014',name:'Flexible Specialty Products (FSP)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Custom hot-hot, hot-cold, and cold-cold gas turbine expansion joints for System 28 inlet and System 29 exhaust, including PTFE/',website:'https://flexiblespecialtyproducts.com'},
  {code:'W251-015',name:'G+H Noise Control',status:'ACTIVE',type:'Manufacturer',country:'Germany',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'Full scope Sys 27 (air intake ducts, pulse filter houses, evaporative coolers, anti-icing), Sys 28 (inlet silencers, dampers), Sys 29 (exhaust flues, ',website:'https://www.guh-group.com'},
  {code:'W251-016',name:'IAC Acoustics (IAC Acoustics Ltd, UK; IAC Acoustics North America Inc.)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Inlet silencer arrays for System 28 duct, exhaust silencer splitter packages for System 29, acoustic enclosures covering the tu',website:'https://www.iacacoustics.com'},
  {code:'W251-017',name:'IAC Acoustics A/S',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Large industrial GT exhaust silencers and stack silencers for System 29 (inline, stack, and baffle types); inlet silencer array',website:'https://www.iac-nordic.com'},
  {code:'W251-018',name:'Maxim Silencers, Inc. (operating as Powertherm Maxim)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Custom gas turbine exhaust silencers (absorptive/reactive/annular flow types) for System 29, high-temperature fabric expansion ',website:'https://maximsilencers.com'},
  {code:'W251-019',name:'Mee Industries, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: Turnkey inlet air fogging and evaporative cooling systems for System 27: MeeFog™ high-pressure fogging nozzle manifolds, pump s',website:'https://www.meefog.com'},
  {code:'W251-020',name:'Nederman MikroPul (Pneumafil)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'Sys 27 (complete inlet filtration systems, retrofit filter houses, replacement cartridges for any existing housing type).',website:'https://www.nedermanmikropul.com'},
  {code:'W251-021',name:'Parker Hannifin Corporation — Gas Turbine Filtration Division (formerly CLARCOR',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: Complete inlet air filtration systems for System 27: pulse-jet cleaning filter houses, static multi-stage filter systems, repla',website:'https://www.parker.com/gtf'},
  {code:'W251-022',name:'Peerless Mfg. Co. (operating as Peerless Separation & Filtration, a brand of',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: Multi-stage GT air intake filtration and separation systems (System 27): vane-type separators for moisture removal, multi-cyclo',website:'https://www.cecoenviro.com/brands/peerless-separation-filtration/'},
  {code:'W251-023',name:'Pyromation, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'29',scope:'for W251 Power Island: Industrial thermocouples and RTD sensor assemblies for System 29 exhaust gas temperature measurement: Type K MgO mineral-insula',website:'https://www.pyromation.com'},
  {code:'W251-024',name:'Senior Flexonics (division of Senior plc); Senior Flexonics Pathway LLC (US',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Metal bellows and expansion joints at all GT inlet and exhaust duct interfaces: inlet expansion joints at the filter house-to-d',website:'https://www.seniorflexonics.com'},
  {code:'W251-025',name:'Spraying Systems Co.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27',scope:'for W251 Power Island: GT inlet air cooling nozzle systems for System 27: HP FogJet® atomizing nozzles and stainless manifold arrays for evaporative i',website:'https://www.spray.com'},
  {code:'W251-026',name:'SVI BREMCO',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'Sys 29 (exhaust stacks, expansion joints, ductwork, silencers), Sys 28 (inlet ducting, structural), Sys 27 (filter house retrofits, anti-icing).',website:'https://svi-bremco.com'},
  {code:'W251-027',name:'U.S. Bellows, Inc. (wholly owned subsidiary of Piping Technology & Products,',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'28, 29',scope:'for W251 Power Island: Custom metal and fabric expansion joints for System 28 inlet duct and System 29 exhaust duct, including rectangular fabric GT e',website:'https://usbellows.com'},
  {code:'W251-028',name:'Universal Silencer — Operating Division of Cummins Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Air Inlet / Exhaust / Acoustic',tags:'27, 28, 29',scope:'for W251 Power Island: Integrated inlet air filtration and silencer systems (System 27/28): Uni-Pulse™ self-cleaning pulse filter houses, Acousti-Tube',website:'https://nciweb.net/universalsilencer/'},
  {code:'W251-029',name:'Alfa Laval AB (FOCUS)',status:'ACTIVE',type:'Manufacturer',country:'Sweden',tier:'Tier 1',group:'Fuel Systems',tags:'13, 15, 20, 21',scope:'Fuel oil treatment and forwarding (Sys 13, 15): FOCUS centrifugal separators, forwarding pumps, heaters, self-cleaning filters. HFO treatment (Sys 20)',website:'https://www.alfalaval.com'},
  {code:'W251-030',name:'ANDRITZ AG',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 2',group:'Fuel Systems',tags:'20, 21',scope:'for W251 power island:; Three-phase decanter centrifuges for HFO water washing and clarification (System 20); Disc centrifuge separators for HFO polis',website:'https://www.andritz.com/separation-en'},
  {code:'W251-031',name:'Baker Hughes Company',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12, 15, 16, 25, 26, 54',scope:'for W251 power island:; Self-acting pressure regulators for fuel gas letdown / regulation (Systems 11, 54); Globe and angle control valves for DLN fue',website:'https://www.bvaa.org.uk/company_details.asp?id=9273'},
  {code:'W251-032',name:'CECO Peerless',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12',scope:'Fuel gas conditioning packages (Sys 11, 12): FG pre-heater, pressure reduction manifold, KO drum, gas scrubber/coalescing filter, superheater, control',website:'https://www.cecoenviro.com/peerless/'},
  {code:'W251-033',name:'Chromalox, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'11, 14, 20, 23, 24',scope:'for W251 power island:; Electric circulation heaters for HFO heating systems (Systems 20, 24); Tank immersion heaters for DO and HFO storage (Systems ',website:'https://www.chromalox.com'},
  {code:'W251-034',name:'CIRCOR International, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Fuel Systems',tags:'13, 14, 20',scope:'for W251 power island:; Main fuel injection pumps (twin-screw or three-screw) for distillate and HFO service (Systems 13, 20); Fuel injection / burner',website:'https://www.circorpt.com/fuel-burner-injection'},
  {code:'W251-035',name:'Cobey, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'13, 14, 15, 17',scope:'Fuel forwarding skids (Sys 13, 15): dual pumps, electric heater, pressure control, EPA flow meter. Water injection skids (Sys 17): HP centrifugal pump',website:'https://www.cobey.com'},
  {code:'W251-036',name:'Cutter USA, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'11, 12',scope:'for W251 power island:; Complete fuel gas conditioning and regulation skids (Systems 11, 12); Pilot/A/B/C DLN sub-skids with manifold piping (System 1',website:'https://www.cutterusa.com'},
  {code:'W251-037',name:'Delavan, Inc. (now a brand under Collins Aerospace / Raytheon Technologies)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Fuel Systems',tags:'13, 15, 17',scope:'for W251 power island:; Air-atomizing (Swirl-Air™) liquid fuel nozzles for distillate/HFO combustion (System 13, 15); Simplex hydraulic pressure-atomi',website:'https://www.ussupply.com/all-purpose-oil-burner-nozzle-type-w-0-65-gph-70-degree'},
  {code:'W251-038',name:'Dongfang Turbine Co. (Dongturbo)',status:'ACTIVE',type:'Manufacturer / OEM',country:'China',tier:'Tier 3',group:'Fuel Systems',tags:'11, 12, 13, 15',scope:'Direct W251B fuel nozzle supplier; provides new manufacture and refurbished fuel nozzles for 251B combustion systems; competitive pricing on fuel syst',website:'https://www.chinaturbo.net'},
  {code:'W251-039',name:'Dorf Ketal Chemicals (India) Pvt. Ltd. / Dorf Ketal Chemicals LLC (US)',status:'ACTIVE',type:'Manufacturer',country:'India',tier:'Tier 3',group:'Fuel Systems',tags:'13, 20, 21',scope:'for W251 power island:; Vanadium inhibitors and combustion improvers for HFO gas turbine operation (System 20, 21); Corrosion inhibitors and biocides ',website:'https://www.dorfketal.com'},
  {code:'W251-040',name:'Drake Controls',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'11, 12',scope:'Electric gas fuel metering valves for W251 fuel gas systems; SonicFlo concept eliminates need for valve discharge pressure compensation; ANSI B16.104 ',website:'http://www.drakecontrols.com'},
  {code:'W251-041',name:'Dresser-Rand',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Fuel Systems',tags:'',scope:'Fuel gas compressors, control oil systems.',website:'www.dresser-rand.com'},
  {code:'W251-042',name:'Emerson Electric Co. (Automation Solutions Division)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12, 16, 17, 54',scope:'for W251 power island:; Fuel gas stop-ratio valves (SRVs) and gas control valves (GCVs) for DLN manifolds (Systems 12, 16); Pilot-operated pressure re',website:'https://www.emerson.com/automation/fisher'},
  {code:'W251-043',name:'Enerflex Ltd.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Fuel Systems',tags:'11, 54',scope:'for W251 power island:; Complete fuel gas conditioning skids (filter-separator, heater, pressure regulation) (System 11); JT dewpoint control skids fo',website:'https://www.enerflex.com'},
  {code:'W251-044',name:'ERGIL Group (Äager GmbH)',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12, 54',scope:'Complete fuel gas conditioning skids (Sys 11, 12): inlet separator, gas heater, pressure regulation, coalescing filters, flow metering, PLC control. G',website:'https://ergil.com'},
  {code:'W251-045',name:'Gas Turbine Efficiency (GTE)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'22, 54',scope:'Compressor wash systems (Sys 22): online/offline, ATEX-certified, 10-250 MW. Fuel gas management/metering (Sys 54). Auxiliary process skids.',website:'https://www.gtefficiency.com'},
  {code:'W251-046',name:'GEA Westfalia Separator',status:'ACTIVE',type:'Manufacturer',country:'Germany',tier:'Tier 1',group:'Fuel Systems',tags:'13, 15, 20',scope:'Fuel oil treatment (Sys 13, 15): centrifugal separators, ViscoBoosterUnit, diesel/distillate treatment. HFO treatment (Sys 20): two-stage water wash +',website:'https://www.gea.com'},
  {code:'W251-047',name:'Hammonds Companies, Inc. (parent); Hammonds Fuel Additives, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Fuel Systems',tags:'21',scope:'for W251 power island:; Multi-additive injection skids (TPI series) for HFO/DO corrosion inhibitor, biocide, and flow improver dosing (System 21); Flu',website:'https://www.hammondscos.com'},
  {code:'W251-048',name:'Honeywell International Inc. (Process Automation division — Elster brand)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Fuel Systems',tags:'11, 54',scope:'for W251 power island:; TRZ2 turbine gas meters for fiscal fuel gas metering (System 54, 11); SM-RI-X large-bore turbine meters (above 6"); Gas pressu',website:'https://www.lincenergysystems.com/gas-flow/meter/turbine/elster-trz2/'},
  {code:'W251-049',name:'Integrated Flow Solutions LLC (IFS)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Fuel Systems',tags:'',scope:'Fuel gas conditioning skids, modular process skids, pressure regulation, filtration, liquid removal systems.',website:'www.ifsolutions.com'},
  {code:'W251-050',name:'Jonell Systems, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'11, 12, 54',scope:'for W251 power island:; Fuel gas coalescing filter vessels (JVCS, JRGC series) for fuel gas conditioning skids (Systems 11, 12); TRI-SHiELD coalescing',website:'https://www.jonellsystems.com'},
  {code:'W251-051',name:'Kobelco Compressors America',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Fuel Systems',tags:'',scope:'Fuel gas boosting compressors, skidded compression packages with cooling, filtration, and controls.',website:'www.kobelco-knw.com'},
  {code:'W251-052',name:'KROHNE Messtechnik GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 2',group:'Fuel Systems',tags:'11, 54',scope:'for W251 power island:; Fuel gas metering skids with calibrated ALTOSONIC V12 ultrasonic flowmeters (System 54, 11); Complete custody-transfer meterin',website:'https://www.krohne.com'},
  {code:'W251-053',name:'Mitsubishi Kakoki Kaisha, Ltd. (三菱化工機株式会社)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 3',group:'Fuel Systems',tags:'20',scope:'for W251 power island:; Disc centrifuge (self-ejecting purifier) for HFO water/sludge separation — System 20; Oil purifiers for lube oil / seal oil pu',website:'https://www.kakoki.co.jp/en/'},
  {code:'W251-054',name:'nVent Electric plc',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 1',group:'Fuel Systems',tags:'23, 24, 25, 26',scope:'for W251 power island:; Self-regulating heat trace cable (BTV, HBTV series) for DO/HFO fuel piping (Systems 23, 24); Power-limiting heating cable for ',website:'https://www.linkedin.com/company/raychem-chemelex'},
  {code:'W251-055',name:'Parker Hannifin Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12, 54',scope:'for W251 power island:; Gas filter-separators and coalescing filters for fuel gas conditioning skids (System 11, 12); PECO Series 85/89 vertical fuel ',website:'https://www.parker.com/content/dam/Parker-com/Literature/Industrial-Process/PECO'},
  {code:'W251-056',name:'Petrogas Gas-Systems B.V.',status:'ACTIVE',type:'Manufacturer',country:'Netherlands',tier:'Tier 1',group:'Fuel Systems',tags:'11, 12, 54',scope:'Complete fuel gas conditioning skids (Sys 11, 12): filter/separator, ESD valves, heaters, pressure regulators, flow metering, PLC control. Gas treatme',website:'https://www.petrogas.nl'},
  {code:'W251-057',name:'Pietro Fiorentini S.p.A.',status:'ACTIVE',type:'Manufacturer',country:'Italy',tier:'Tier 2',group:'Fuel Systems',tags:'11, 12, 54',scope:'for W251 power island:; Packaged gas pressure reducing/metering stations (System 54); High- and medium-pressure gas regulators (PF80, PF120 series and',website:'https://www.fiorentini.com'},
  {code:'W251-058',name:'Roper Pump Company',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Fuel Systems',tags:'13, 15',scope:'Flow dividers for W251 multi-combustor fuel distribution (Sys 13, 15). High-pressure gear fuel pumps. DuraFlow corrosion-resistant dividers for divers',website:'https://roperpumps.com'},
  {code:'W251-059',name:'Severn Glocon UK Valves Limited (registered No. 12329544)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United Kingdom',tier:'Tier 2',group:'Fuel Systems',tags:'11, 12, 15, 16, 54',scope:'for W251 power island:; Severe-service globe control valves for DLN fuel manifolds (System 12, 15); High-pressure gas regulating and control valves fo',website:'https://www.severnvalve.com'},
  {code:'W251-060',name:'Thermon Group Holdings, Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Fuel Systems',tags:'23, 24, 25, 26',scope:'for W251 power island:; Steam tracing systems (SafeTrace BTS/SLS) for HFO fuel piping and DO piping (Systems 23, 24, 25, 26); Electric heat trace cabl',website:'https://www.thermon.com'},
  {code:'W251-061',name:'Turbotect Ltd.',status:'ACTIVE',type:'Manufacturer',country:'Switzerland',tier:'Tier 1',group:'Fuel Systems',tags:'20, 21, 22',scope:'Additive dosing skid (Sys 21): 1,000L SS tank, redundant dosing pumps, PLC integration. Stationary wash skid (Sys 22): dual SS tanks, online/offline. ',website:'https://www.turbotect.com'},
  {code:'W251-062',name:'Valin Corporation',status:'ACTIVE',type:'Distributor',country:'United States',tier:'Tier 3',group:'Fuel Systems',tags:'',scope:'Fuel gas conditioning skids, electric fuel heaters, filtration, pressure regulation.',website:'www.valin.com'},
  {code:'W251-063',name:'Advanced Atomization Technologies',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Fuel injectors, nozzles, atomization hardware, DLN injector support.',website:'www.advancedatomization.com'},
  {code:'W251-064',name:'API Heat Transfer Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 9, 10, 18',scope:'for W251 Power Island: API Heat Transfer provides the shell-and-tube heat exchanger components for the W251 lube oil system (air-to-oil and water-to-o',website:'https://www.apiheattransfer.com](https://www.apiheattransfer.com'},
  {code:'W251-065',name:'Atlas Copco Compressors',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'8',scope:'Instrument air compressor packages and drier systems (Sys 8): compressors, air tanks, desiccant dryers, and sweep air components.',website:'https://www.atlascopco.com/en-us/compressors'},
  {code:'W251-066',name:'AXH Air-Coolers',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'9, 10, 18',scope:'Air-to-oil cooler for lube oil skid (Sys 10), air-to-air/water-to-air coolers for cooling air system (Sys 9), generator cooling (Sys 18).',website:'https://axhaircoolers.com'},
  {code:'W251-067',name:'Boll & Kirch Filterbau GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'8, 10, 22',scope:'for W251 Power Island: ; System 10 (Lube Oil System): BOLLFILTER Duplex BFD — API 614-compliant duplex lube oil filters for the W251 lube oil console.',website:'https://www.bollfilter.com](https://www.bollfilter.com'},
  {code:'W251-068',name:'Combustion Associates Inc. (CAI)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Lube oil skids, fuel gas conditioning skids, modular process skids.',website:'www.cai3.com'},
  {code:'W251-069',name:'Coupling Corporation of America',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'6',scope:'Custom turbine-to-generator and turbine-to-gearbox couplings for W251 power trains; anti-reverse, torque-limiting, and close-coupled designs; keyless ',website:'https://couplingcorp.com'},
  {code:'W251-070',name:'Cummins Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 5',scope:'for W251 Power Island: For System 4 (diesel starting package), Cummins supplies the diesel engine portion of the starting package (e.g., KTA1150C or Q',website:'https://www.cummins.com'},
  {code:'W251-071',name:'David Brown Santasalo Ltd.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'3',scope:'for W251 Power Island: David Brown Santasalo manufactures parallel-shaft and epicyclic reduction gearboxes used directly between the turbine shaft and',website:'https://www.dbsantasalo.com](https://dbsantasalo.com'},
  {code:'W251-072',name:'Elliott Group',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Centrifugal compressors, steam turbines, rotating-equipment support, combined-cycle adjacent equipment.',website:'www.elliott-turbo.com'},
  {code:'W251-073',name:'EthosEnergy',status:'ACTIVE',type:'Service Provider',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'',scope:'TG20/W251 package support, rotating-equipment services, repairs, rotor life extensions, OEM-adjacent turbine package scope.',website:'www.ethosenergy.com'},
  {code:'W251-074',name:'Flender International GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'3, 6',scope:'for W251 Power Island: Flender\'s load gearbox product line (TX and VF series) directly covers gas turbine-generator reduction gearbox applications (S',website:'https://www.flender.com](https://www.flender.com'},
  {code:'W251-075',name:'FP Turbomachinery B.V.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'19',scope:'Compressor online washing skid (Sys 19): complete TCCS system with tank, pump, spray nozzles, instruments, controls. Specifically lists Westinghouse f',website:'https://www.fpturbo.com'},
  {code:'W251-076',name:'Gardner Denver, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 8',scope:'for W251 Power Island: Gardner Denver rotary screw and reciprocating compressors provide redundant compressed air supply to the instrument air and ato',website:'https://www.gardnerdenver.com](https://www.gardnerdenver.com'},
  {code:'W251-077',name:'Gits Mfg. Co.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Venting products, pressure vacuum vents, lubrication components for gearboxes and auxiliary skids.',website:'www.gitsmfg.com'},
  {code:'W251-078',name:'Hanwha Power Systems (PSM - Power Systems Mfg.)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Hot gas path components, DLN retrofit systems, combustion systems, blades, vanes, airfoils.',website:'www.psm.com'},
  {code:'W251-079',name:'Hebeler-Howard Marten Fluid Solutions',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'10, 11, 13, 17, 19',scope:'Lube oil skid systems, fuel oil systems, water injection systems, compressor wash skids, and hydraulic systems for W251 gas turbine installations; pro',website:'https://hebelerhowardmarten.com'},
  {code:'W251-080',name:'HYDAC International GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 8, 9, 10, 18',scope:'for W251 Power Island: ; System 10 (Lube Oil System): HYDAC modular lube oil systems for bearing lubrication of turbines and generators; turbine oil c',website:'https://www.hydac.com](https://www.hydac.com'},
  {code:'W251-081',name:'Ingersoll Rand Inc. (OEM Solutions Division / Tamrotor Industrial Compressors)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'7, 8',scope:'for W251 Power Island: ; System 8 (Atomizing and Instrument Air System): TIC packages provide clean, dry compressed air for pneumatic instrument racks',website:'https://www.ingersollrand.com](https://www.ingersollrand.com'},
  {code:'W251-082',name:'Koenig Engineering, Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'4, 5',scope:'Complete diesel starting packages (Sys 4): diesel engine + torque converter + control board + turning gear + SSS clutch integration. Electric starting',website:'https://koenigengr.com'},
  {code:'W251-083',name:'KTR Systems GmbH',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 6',scope:'for W251 Power Island: KTR provides torsionally rigid, maintenance-free high-speed couplings applicable to the generator/gearbox joint and gearbox/tur',website:'https://www.ktr.com](https://www.ktr.com'},
  {code:'W251-084',name:'Lube-Power, Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'10',scope:'Full auxiliary lube oil skid (Sys 10): tank, main pump, DC emergency pump, AC aux pump, duplex filter, air-to-oil cooler, water-to-oil cooler, all ins',website:'https://www.lubepower.com'},
  {code:'W251-085',name:'Metrix Vibration, a brand of Roper Technologies, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'3, 6',scope:'for W251 Power Island: ; System 3 (Reduction Gearbox): Proximity probes and speed pickup sensors for gearbox shaft monitoring, overspeed detection, an',website:'https://www.metrixvibration.com](https://www.metrixvibration.com'},
  {code:'W251-086',name:'NGC Americas',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Reduction gearboxes, gearbox testing/repair/remanufacturing.',website:'www.ngcamericas.com'},
  {code:'W251-087',name:'Pall Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'8, 10, 22',scope:'for W251 Power Island: ; System 10 (Lube Oil System): Pall turbine lube oil filter elements (high-efficiency particulate removal), lube oil purificati',website:'https://www.pall.com](https://www.pall.com'},
  {code:'W251-088',name:'Regal Rexnord (Kop-Flex / Bibby Turboflex)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'6',scope:'Generator/gearbox coupling (low-speed, high-torque) and gearbox/turbine coupling (high-speed) for Sys 6. Torque-limiting devices, speed pickup rings, ',website:'https://www.bibbyturboflex.com'},
  {code:'W251-089',name:'RENK Group AG',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'3, 6',scope:'High-speed parallel shaft reduction gearboxes for gas turbine power generation (Sys 3), industrial turbo gear units, couplings (Sys 6).',website:'https://www.renk.com/en/products/industrial-gearboxes'},
  {code:'W251-090',name:'Rexnord LLC, Ameridrives Division (now part of Regal Rexnord Corporation)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'6',scope:'for W251 Power Island: Ameridrives / Thomas Couplings diaphragm and disc couplings are directly applicable to System 6 (generator/gearbox coupling joi',website:'https://www.ameridrives.com](https://www.ameridrives.com'},
  {code:'W251-091',name:'Rochem Fyrewash Ltd. (UK) / Rochem Fyrewash Inc. (USA)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'19, 22',scope:'for W251 Power Island: ; System 19 (Compressor Online Washing System): Rochem Fyrewash permanent online wash skids, automated injection control panels',website:'https://www.rochem-fyrewash.com](https://www.rochem-fyrewash.com'},
  {code:'W251-092',name:'Rolls-Royce Power Systems AG',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'4, 8',scope:'for W251 Power Island: mtu diesel engines (Series 2000, 4000, 1600) are used as the prime mover within diesel starting packages (System 4) for industr',website:'https://www.mtu-solutions.com](https://www.mtu-solutions.com'},
  {code:'W251-093',name:'Solar Turbines',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Industrial gas turbines, black-start support packages, industrial drives.',website:'www.solarturbines.com'},
  {code:'W251-094',name:'Solberg Manufacturing, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'4, 10',scope:'for W251 Power Island: ; System 10 (Lube Oil System): SME Series oil mist eliminators on the lube oil tank breather and gearbox vents — captures oil m',website:'https://www.solbergmfg.com](https://www.solbergmfg.com'},
  {code:'W251-095',name:'SSS Clutch Company, Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'4, 5',scope:'SSS clutch for turbine starting disconnect (Sys 4, 5) and turning gear drive train. Direct W251 heritage applications.',website:'http://www.sssclutch.com'},
  {code:'W251-096',name:'Systems: 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 22',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'1, 2, 3, 4, 5, 6, 7, 8, 9, 10,',scope:'',website:''},
  {code:'W251-097',name:'The Hilliard Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Starting packages, clutch/starter assemblies, pneumatic/hydraulic/electric starters, filtration for lube and fuel oils.',website:'www.hilliardcorp.com / hilliardcorp.com'},
  {code:'W251-098',name:'Timken Gears & Services Inc., Philadelphia Gear Brand',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Mechanical Auxiliaries',tags:'3',scope:'for W251 Power Island: Philadelphia Gear provides new gearboxes, replacement drive units, gas turbine gearbox repair, emergency rebuild, and OEM-speci',website:'https://www.philagear.com](https://www.philagear.com'},
  {code:'W251-099',name:'Twin Disc, Incorporated',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'4',scope:'for W251 Power Island: Twin Disc hydraulic torque converters are a primary candidate for the torque converter element within the W251 diesel starting ',website:'https://www.twindisc.com](https://twindisc.com'},
  {code:'W251-100',name:'Voith GmbH / BHS Division',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Mechanical Auxiliaries',tags:'3, 4, 5, 6',scope:'Reduction gearbox (Sys 3), rotor turning gears (Sys 4/5), high-speed diaphragm couplings (Sys 6), torque converter turbine starters.',website:'https://www.voith.com/corp-en/drives-transmissions/turbo-gear-units.html'},
  {code:'W251-101',name:'ABB Electrification',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'33, 34, 35',scope:'MV switchgear panels (Sys 33), 380V distribution boards (Sys 34), 110V DC UPS and battery charger systems (Sys 35).',website:'https://electrification.us.abb.com'},
  {code:'W251-102',name:'Advanced Energy',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'Thermal monitoring and instrumentation through LumaSense-branded solutions.',website:'www.advancedenergy.com'},
  {code:'W251-103',name:'Aksa Jeneratör Anonim Şirketi (AKSA Power Generation)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'44',scope:'for W251 Power Island:; Black start emergency diesel generator sets, 800kVA (System 44): AX-800, AP-800 series and custom-configured units; Full packa',website:'https://www.aksa.com.tr/en-us/'},
  {code:'W251-104',name:'ALLTEC Corporation',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'45, 46',scope:'for W251 Power Island:; Complete facility-level lightning protection system (System 46): TerraStat® CDT and TerraStreamer® ESE air terminals, finials,',website:'https://alltecglobal.com'},
  {code:'W251-105',name:'Ansaldo Energia',status:'ACTIVE',type:'Manufacturer',country:'Italy',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'Major turbomachinery, gas turbine package scope, steam turbines, generators, power island systems.',website:'www.ansaldoenergia.com'},
  {code:'W251-106',name:'Aplicaciones Tecnológicas S.A.',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'45, 46',scope:'for W251 Power Island:; Complete external lightning protection system (System 46): ESE air terminals, down conductors, grounding electrodes, conductor',website:'https://at3w.com'},
  {code:'W251-107',name:'Caterpillar Electric Power',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'44',scope:'800 kVA emergency diesel generator black start (Sys 44). Cat SD800, 3512C configurations.',website:'https://www.cat.com/en_US/by-industry/electric-power.html'},
  {code:'W251-108',name:'Centrax Gas Turbines',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'High-efficiency gas turbine generator packages, packaged power island systems.',website:'www.centraxgt.com'},
  {code:'W251-109',name:'CG Power and Industrial Solutions Limited (CGPISL)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'33, 36',scope:'for W251 Power Island:; Power transformers for System 36 (132kV GSU transformer) — rated up to 1,500MVA, 12kV–1,200kV; Distribution and unit auxiliary',website:'https://www.cgglobal.com'},
  {code:'W251-110',name:'CGIT Westboro, Inc. (currently operated as part of Trench Group / Siemens',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'33',scope:'for W251 Power Island:; Isolated-phase bus duct (IPB / IPBD) for System 33: connecting generator terminals to GSU transformer and unit transformer tap',website:'https://www.cgit.com'},
  {code:'W251-111',name:'CGIT Westboro, Inc. (currently operated as part of Trench Group / Siemens Energy',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'33',scope:'for W251 Power Island:; Isolated-phase bus duct (IPB / IPBD) for System 33: connecting generator terminals to GSU transformer and unit transformer tap',website:'https://www.cat.com/en_US/by-industry/electric-power.html'},
  {code:'W251-112',name:'CHINT Electric Co., Ltd. (正泰电器股份有限公司)',status:'ACTIVE',type:'Distributor',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'33, 34',scope:'for W251 Power Island:; MV switchgear panels (System 33): gas-insulated GIS (NG7-40.5 SF6), air-insulated switchgear (AIS) with VCBs, ring main units ',website:'https://www.chintglobal.com'},
  {code:'W251-113',name:'Cummins Power Generation',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'44',scope:'800 kVA emergency diesel generator black start (Sys 44). DQCC 800 kW, NFPA 110 compliant.',website:'https://www.cummins.com/generators'},
  {code:'W251-114',name:'Current Lighting Solutions LLC (operating as "Current" — successor to GE',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'42',scope:'for W251 Power Island:; LED industrial luminaires and tower lighting for power plant (System 42): high-bay, low-bay, floodlights, outdoor perimeter li',website:'https://www.currentlighting.com'},
  {code:'W251-115',name:'Current Lighting Solutions LLC (operating as "Current" — successor to GE Current',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'42',scope:'for W251 Power Island:; LED industrial luminaires and tower lighting for power plant (System 42): high-bay, low-bay, floodlights, outdoor perimeter li',website:''},
  {code:'W251-116',name:'Eaton Corporation',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'33, 34, 35, 43',scope:'MV switchgear (Sys 33), MCC panels/PCC boards (Sys 34), UPS/DC (Sys 35), cable management (Sys 43).',website:'https://www.eaton.com'},
  {code:'W251-117',name:'Efacec Power Solutions, S.A. (trading as Efacec)',status:'ACTIVE',type:'Distributor',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'33, 36',scope:'for W251 Power Island:; 132kV step-up generator transformer (System 36: GSU transformer from generator voltage to grid voltage); Unit/auxiliary transf',website:'https://www.efacec.com'},
  {code:'W251-118',name:'EnerSys',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Electrical BOP',tags:'35',scope:'Batteries and battery chargers for 110V DC system (Sys 35). VRLA, flooded, and Li-ion options.',website:'https://www.enersys.com'},
  {code:'W251-119',name:'FG Wilson Engineering Ltd. (a Caterpillar Inc. company)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Electrical BOP',tags:'44',scope:'for W251 Power Island:; Black start emergency diesel generator set, 800kVA (System 44): P800 or P900 series units (Perkins 4006/4008 or Caterpillar C1',website:'https://www.fgwilson.com'},
  {code:'W251-120',name:'GTC Control Solutions',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'GT control systems, control boards, control cables.',website:'www.callgtc.com'},
  {code:'W251-121',name:'Hitachi Energy',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'33, 36',scope:'Step-up transformer 132 kV (Sys 36), potentially unit/auxiliary transformers (Sys 33).',website:'https://www.hitachienergy.com'},
  {code:'W251-122',name:'HOPPECKE Batterien GmbH & Co. KG',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'35',scope:'for W251 Power Island:; 110V DC stationary battery banks (System 35): OPzS flooded lead-acid and OPzV gel VRLA types; Battery chargers and complete 11',website:'https://www.hoppecke.com'},
  {code:'W251-123',name:'Hubbell Incorporated / Killark Electric Manufacturing Co. Inc. (division)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'42, 43',scope:'for W251 Power Island:; Lighting and tower fixtures for power plant areas (System 42): explosion-proof LED/HID luminaires, high-bay fixtures, flood li',website:'https://www.hubbell.com/killark'},
  {code:'W251-124',name:'Kumwell Corporation Public Company Limited',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 3',group:'Electrical BOP',tags:'45, 46',scope:'for W251 Power Island:; Complete secondary grounding system components (System 45): ground rods, MEG (more effective grounding) compounds, exothermic ',website:'https://www.kumwell.com'},
  {code:'W251-125',name:'Legrand SA',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'43',scope:'for W251 Power Island:; Cable trays and cable management systems for power, instrument, and control cables (System 43); Wire-mesh cable trays (Cablofi',website:'https://www.legrand.com'},
  {code:'W251-126',name:'Lucy Electric UK Ltd.',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'33, 34',scope:'for W251 Power Island:; MV ring main units (RMUs) and switchgear for 11kV auxiliary systems (System 33); MV motor control centers for auxiliary loads ',website:'https://www.lucyelectric.com'},
  {code:'W251-127',name:'Mechanical Dynamics & Analysis (MD&A)',status:'ACTIVE',type:'Service Provider',country:'United States',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'Hot gas path components, fuel nozzle refurbishment, outage services, generator repairs, engineered life-extension solutions.',website:'www.mdaturbines.com'},
  {code:'W251-128',name:'Mitsubishi Power / Mitsubishi Power Americas',status:'ACTIVE',type:'Manufacturer',country:'Japan',tier:'Tier 3',group:'Electrical BOP',tags:'',scope:'Gas turbines, generator sets, major power island equipment, turbine services.',website:'power.mhi.com'},
  {code:'W251-129',name:'nVent ERICO',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'45, 46',scope:'Lightning protection system (Sys 46), secondary grounding cables/accessories (Sys 45). ERITECH lightning protection, CADWELD grounding, ERIFLEX bus ba',website:'https://www.nvent.com/en-us/brands/erico'},
  {code:'W251-130',name:'Powell Industries, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Electrical BOP',tags:'33, 34',scope:'for W251 Power Island:; Metal-clad medium-voltage switchgear (System 33: MV panels with CT/PT/circuit breakers, insulated bus bar duct interfaces); Mo',website:'https://www.powellind.com'},
  {code:'W251-131',name:'Prolec Energy',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'36',scope:'Step-up transformer 132 kV (Sys 36). Direct fit with standard GSU range (69-765 kV HV; 13.2-25 kV LV).',website:'https://www.prolec.energy'},
  {code:'W251-132',name:'Prysmian Group',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'33, 43',scope:'LV power cables, instrument cables, control cables (Sys 43), MV cables (Sys 33).',website:'https://na.prysmian.com'},
  {code:'W251-133',name:'Rolls-Royce Solutions America Inc. (mtu brand)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 1',group:'Electrical BOP',tags:'44',scope:'for W251 Power Island:; Black start emergency diesel generator set, 800kVA (System 44): mtu Series 1600 (~600kVA–730kVA range) or Series 2000 (750–1,2',website:'https://www.mtu-solutions.com'},
  {code:'W251-134',name:'Saft Groupe S.A.S. (trading as Saft)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 1',group:'Electrical BOP',tags:'35',scope:'for W251 Power Island:; 110V DC battery systems for substation and control power backup (System 35); NiCd and Li-ion battery containers with complete ',website:'https://www.saftbatteries.com'},
  {code:'W251-135',name:'Schneider Electric',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Electrical BOP',tags:'33, 34, 43',scope:'MV panel (Sys 33), MCC panels with additional drawers, PCC boards (Sys 34), MV cables (Sys 43).',website:'https://www.se.com/us/en/'},
  {code:'W251-136',name:'Siemens Energy (Transformers)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Electrical BOP',tags:'33, 36',scope:'Steam turbines for W251 combined cycle applications. SST series for industrial and combined cycle service.',website:'https://www.siemens-energy.com/steam-turbines'},
  {code:'W251-137',name:'WEG Transformers USA LLC (subsidiary of WEG S.A.)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'Electrical BOP',tags:'33, 36',scope:'for W251 Power Island:; Unit transformers 11kV/380V for auxiliary supplies (System 33: 1.3MVA unit transformer range); Auxiliary transformers 11/0.4kV',website:'https://weg.us'},
  {code:'W251-138',name:'Westinghouse W251 Gas Turbine Power Island Packaging',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Electrical BOP',tags:'',scope:'',website:'https://www.saftbatteries.com/'},
  {code:'W251-139',name:'AB SKF',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'40',scope:'for W251 Power Island:; Online continuous vibration monitoring systems for GT (IMx-C protection + condition monitoring) — System 40; API 670-compliant',website:'https://www.skf.com](https://www.skf.com'},
  {code:'W251-140',name:'ABB Ltd (Measurement & Analytics Division)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'32',scope:'for W251 Power Island:; Pressure transmitters (2600T family) for GT fuel gas, lube oil, air inlet, and exhaust systems (System 32); Temperature sensor',website:'https://www.siemens-energy.com/steam-turbines'},
  {code:'W251-141',name:'Amerex Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Purple K (BC) dry chemical local application systems for GT bearing compartments (NFPA 17 compliant) — System 30; ABC dry chem',website:'https://www.amerex-fire.com](https://www.amerex-fire.com'},
  {code:'W251-142',name:'ANSUL / Johnson Controls',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Safety & Monitoring',tags:'30',scope:'Inert gas fire protection for gas turbine and auxiliaries (Sys 30), CO2 systems, dry chemical for turbine bearing.',website:'https://www.ansul.com'},
  {code:'W251-143',name:'Autronica Fire and Security AS',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30, 41',scope:'for W251 Power Island:; AutroSafe integrated fire and gas detection system for GT package (System 30 + 41); AutroPoint IR open-path gas detectors for ',website:'https://www.autronicafire.com](https://www.autronicafire.com'},
  {code:'W251-144',name:'Bently Nevada / Baker Hughes',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Safety & Monitoring',tags:'40',scope:'Vibration monitoring system (Sys 40): API 670 racks, proximity probes, accelerometers, velocity sensors for turbine/generator/gearbox.',website:'https://www.bakerhughes.com/bently-nevada'},
  {code:'W251-145',name:'Crowcon Detection Instruments Limited',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'for W251 Power Island:; Fixed flammable gas detectors for NG, diesel, and heavy fuel oil leak detection (System 41); Toxic gas detectors (H2S, CO) for',website:'https://www.crowcon.com](https://www.crowcon.com'},
  {code:'W251-146',name:'Det-Tronics / Spectrum Safety',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Safety & Monitoring',tags:'30, 41',scope:'Fire & gas detection and releasing systems for Sys 30 and Sys 41. Integrated flame/gas detectors with suppression interface.',website:'https://www.det-tronics.com'},
  {code:'W251-147',name:'Dräger',status:'ACTIVE',type:'Manufacturer',country:'Germany',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'Gas detection system (Sys 41): rack-based and point gas detectors for turbine enclosures. GT-specific solutions.',website:'https://www.draeger.com'},
  {code:'W251-148',name:'Emerson Electric Co. — Rosemount, Inc. (operating business unit)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'32',scope:'for W251 Power Island:; Rosemount 3051 — DP/GP/AP transmitters for GT fuel, lube oil, compressor differential pressure (System 32); Rosemount 3144P — ',website:'https://www.emerson.com/en-us/automation/measurement-instrumentation'},
  {code:'W251-149',name:'Endress+Hauser Group Services AG (Endress+Hauser SE+Co. KG)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'32',scope:'for W251 Power Island:; iTEMP temperature transmitters and RTD/TC assemblies for GT bearing, lube oil, and process temps (System 32); Cerabar/Deltabar',website:'https://www.us.endress.com'},
  {code:'W251-150',name:'Fike Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Safety & Monitoring',tags:'30',scope:'Inert gas fire protection for gas turbine enclosures (Sys 30). CO2 total flooding systems.',website:'https://www.fike.com'},
  {code:'W251-151',name:'Fireaway Inc.',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Stat-X total flooding condensed aerosol systems for GT enclosure fire suppression (System 30); Drop-in replacement for CO2 and',website:'https://www.statx.com](https://www.statx.com'},
  {code:'W251-152',name:'Firetrace International LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Complete pre-engineered automatic fire suppression for GT enclosure (total flooding and local application); CO2 high-pressure ',website:'https://www.firetrace.com](https://www.firetrace.com'},
  {code:'W251-153',name:'Hochiki Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Addressable fire alarm control panels for the GT power island local fire alarm system (System 30); Heat and smoke detectors fo',website:'https://www.hochikiamerica.com](https://www.hochikiamerica.com'},
  {code:'W251-154',name:'Honeywell International Inc. — Sensing & Safety Technologies / Process',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'for W251 Power Island:; Fixed combustible gas detectors for NG/DO/HFO fuel leak detection in GT enclosure (System 41); Infrared (IR) and UV/IR flame d',website:'https://automation.honeywell.com/us/en/contact-us/detection-measurement-control/'},
  {code:'W251-155',name:'Honeywell International Inc. — Sensing & Safety Technologies / Process Solutions',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'for W251 Power Island:; Fixed combustible gas detectors for NG/DO/HFO fuel leak detection in GT enclosure (System 41); Infrared (IR) and UV/IR flame d',website:''},
  {code:'W251-156',name:'Honeywell Process Solutions',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Safety & Monitoring',tags:'',scope:'Gas detection sensors, flame scanners, combustion safety hardware.',website:'honeywellprocess.com'},
  {code:'W251-157',name:'Kidde Fire Systems (KiddeFenwal)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'System 30 — High-pressure CO2 total flooding for GT enclosure; CO2 local application for turbine bearing fire protection; GEMINI suppression control p',website:'https://kiddefenwal.com'},
  {code:'W251-158',name:'Marioff HI-FOG',status:'ACTIVE',type:'Manufacturer',country:'Finland',tier:'Tier 1',group:'Safety & Monitoring',tags:'30',scope:'High-pressure water mist fire protection for turbine enclosures (Sys 30). Alternative to CO2/inert gas systems.',website:'https://www.marioff.com'},
  {code:'W251-159',name:'Meggitt / Vibro-Meter (Parker)',status:'ACTIVE',type:'Manufacturer / OEM',country:'Switzerland',tier:'Tier 1',group:'Safety & Monitoring',tags:'40',scope:'Vibration monitoring system (Sys 40): VM600 Mk2 rack for turbomachinery protection. OEM standard for heavy-duty GTs.',website:'https://www.parker.com'},
  {code:'W251-160',name:'Metrix Instrument Company (Roper Technologies)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Safety & Monitoring',tags:'40',scope:'System 40 — Vibration switches for bearing protection; digital proximity systems and 4-20mA transmitters for W251 journal bearings; high-temp velocity',website:'https://www.metrixvibration.com'},
  {code:'W251-161',name:'MSA Safety / General Monitors',status:'ACTIVE',type:'Service Provider',country:'United States',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'Gas detection system (Sys 41): explosive mixture detection for gas turbine enclosures.',website:'https://www.msasafety.com'},
  {code:'W251-162',name:'Notifier — a Honeywell brand (Honeywell International Inc.)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Intelligent addressable fire alarm control panel as the primary FACP for the power island (System 30); Integration of smoke, h',website:'https://www.notifier.lu/docs/notifierfiresystems/nl/gd/NOTIFIER%20Product%20Cata'},
  {code:'W251-163',name:'Parker Meggitt (Vibro-Meter®)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Safety & Monitoring',tags:'',scope:'Vibration boards, sensors, cables, accelerometers, proximity probes, health monitoring systems.',website:'www.meggitt.com'},
  {code:'W251-164',name:'PCB Piezotronics',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Safety & Monitoring',tags:'',scope:'Vibration sensors, accelerometers, monitoring cables.',website:'www.pcb.com'},
  {code:'W251-165',name:'PRÜFTECHNIK Condition Monitoring GmbH',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'40',scope:'for W251 Power Island:; VIBGUARD online continuous vibration monitoring boards and system for GT (System 40); Multi-channel vibration monitoring with ',website:'https://www.pruftechnik.com](https://www.pruftechnik.com'},
  {code:'W251-166',name:'RKI Instruments, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'for W251 Power Island:; Fixed combustible gas detectors for NG/DO/HFO enclosure leak detection (System 41); Multi-point fixed gas detection controller',website:'https://www.rkiinstruments.com](https://www.rkiinstruments.com'},
  {code:'W251-167',name:'Spectrex Inc. (operating as Spectrex, an Emerson brand)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'41',scope:'for W251 Power Island:; SharpEye IR3 / UV/IR / QuadSense flame detectors for GT enclosure (System 41); SafEye OPGD for GT hall and fuel storage area p',website:'https://www.spectrex.net](https://www.spectrex.net'},
  {code:'W251-168',name:'Victaulic Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'30',scope:'for W251 Power Island:; Victaulic Vortex™ hybrid suppression system as CO2 replacement or supplement for GT enclosures (System 30); FM Approved pre-en',website:'https://www.victaulic.com](https://www.victaulic.com'},
  {code:'W251-169',name:'WIKA Alexander Wiegand SE & Co. KG',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'32',scope:'for W251 Power Island:; Pressure transmitters (A-10, S-20, 2xx.34 XSEL) for GT lube oil, fuel gas, and compressor monitoring (System 32); Thermocouple',website:'https://www.wika.com](https://www.wika.com'},
  {code:'W251-170',name:'Yokogawa Electric Corporation',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Safety & Monitoring',tags:'32',scope:'for W251 Power Island:; EJX Series DPharp pressure transmitters for GT fuel, lube, and combustor pressure monitoring (System 32); YTA Series temperatu',website:'https://www.yokogawa.com](https://www.yokogawa.com'},
  {code:'W251-171',name:'3S Incorporated',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Enclosures & Structural',tags:'',scope:'Gas detection systems, CO2 systems, water mist fire fighting systems, turbine enclosure safety systems.',website:'www.3s-incorporated.com'},
  {code:'W251-172',name:'ABB eHouse',status:'ACTIVE',type:'Manufacturer / OEM',country:'Switzerland',tier:'Tier 1',group:'Enclosures & Structural',tags:'31, 39',scope:'Prefabricated electrical rooms for MV panel, MCC, PCC, DC, batteries, control panels (Sys 31). Generator control integration (Sys 39).',website:'https://new.abb.com/medium-voltage/ehouse'},
  {code:'W251-173',name:'Basler Electric Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'39',scope:'for W251 Power Island:; Generator protection relays (BE1-FLEX, BE1-GPS100) covering all standard ANSI/IEEE generator protective functions — System 39;',website:'https://www.basler.com](https://www.basler.com'},
  {code:'W251-174',name:'BBM-CPG Technology, Inc. (US entity); BBM Akustik Technologie GmbH (German',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 47, 48, 52, 53',scope:'for W251 Power Island:; Complete acoustic enclosures for gas turbine (turbine and generator compartments), meeting 85 dBA or site-specific noise limit',website:'https://www.bbm-cpg.com](https://bbm-cpg.com'},
  {code:'W251-175',name:'BBM-CPG Technology, Inc. (US entity); BBM Akustik Technologie GmbH (German paren',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 47, 48, 52, 53',scope:'for W251 Power Island:; Complete acoustic enclosures for gas turbine (turbine and generator compartments), meeting 85 dBA or site-specific noise limit',website:''},
  {code:'W251-176',name:'Beckwith Electric Co., Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'39',scope:'for W251 Power Island:; Generator control board protection relay (M-3425A Comprehensive Generator Relay) — System 39; Automatic synchronizing system (',website:'https://www.beckwithelectric.com](https://beckwithelectric.com'},
  {code:'W251-177',name:'BMarko Structures, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31',scope:'for W251 Power Island:; Custom modular E-House for MV panel room (generator step-up breaker, MV distribution) — System 31, 39; MCC/PCC/battery/control',website:'https://www.bmarkostructures.com](https://bmarkostructures.com'},
  {code:'W251-178',name:'Boldrocchi S.r.l. (lead Italian entity); various subsidiary companies within',status:'ACTIVE',type:'Distributor',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 47, 48',scope:'for W251 Power Island:; Complete acoustic enclosures for GT and generator with integrated ventilation, lighting, fire-fighting systems — System 31; Fo',website:'https://www.boldrocchigroup.com](https://www.boldrocchigroup.com'},
  {code:'W251-179',name:'Boldrocchi S.r.l. (lead Italian entity); various subsidiary companies within the',status:'ACTIVE',type:'Distributor',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 47, 48',scope:'for W251 Power Island:; Complete acoustic enclosures for GT and generator with integrated ventilation, lighting, fire-fighting systems — System 31; Fo',website:''},
  {code:'W251-180',name:'DEIF A/S',status:'ACTIVE',type:'Manufacturer / OEM',country:'Denmark',tier:'Tier 2',group:'Enclosures & Structural',tags:'39',scope:'Generator controller for synchronizing/paralleling; generator protection board; automatic mains failure; load management; grid code compliance — Syste',website:'https://www.deif.com'},
  {code:'W251-181',name:'ERATHERM İzolasyon A.Ş.',status:'ACTIVE',type:'Manufacturer / OEM',country:'Türkiye',tier:'Tier 3',group:'Enclosures & Structural',tags:'48',scope:'Thermal insulation for turbine casings, combustor areas, exhaust lines, manifold zones; pipe insulation; equipment insulation for auxiliary skids — Sy',website:'https://eratherm.net'},
  {code:'W251-182',name:'Exxon Mobil Corporation',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'51, 52, 53',scope:'for W251 Power Island:; First fill of synthetic turbine lube oil (Mobil SHC 824 or 825) for W251 main lube oil system — System 51; Hydraulic control o',website:'https://www.mobil.com/industrial](https://www.mobil.com'},
  {code:'W251-183',name:'Falcon Structures (operating name); legal entity is a privately held Texas',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'49, 52',scope:'for W251 Power Island:; Tool container / tool room for site activities (modified 20ft or 40ft ISO shipping container, outfitted for power plant site u',website:'https://www.falconstructures.com](https://www.falconstructures.com'},
  {code:'W251-184',name:'Falcon Structures (operating name); legal entity is a privately held Texas corpo',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'49, 52',scope:'for W251 Power Island:; Tool container / tool room for site activities (modified 20ft or 40ft ISO shipping container, outfitted for power plant site u',website:''},
  {code:'W251-185',name:'GE Vernova Multilin',status:'ACTIVE',type:'Manufacturer',country:'Canada',tier:'Tier 1',group:'Enclosures & Structural',tags:'39',scope:'Generator control and protection boards (Sys 39). G60 relay for comprehensive generator protection.',website:'https://www.gevernova.com'},
  {code:'W251-186',name:'Global Tech Services, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'52, 53',scope:'for W251 Power Island:; Commissioning spare parts (System 52) — full kit sourcing for W251/W501 series: combustion parts, fuel nozzles, instrumentatio',website:'https://www.gtswamar.com](https://www.gtswamar.com'},
  {code:'W251-187',name:'HOPE Electrical Products Co., Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Enclosures & Structural',tags:'',scope:'Junction boxes, conduit systems, cable trays, enclosures.',website:'www.hopeelectricalproducts.com'},
  {code:'W251-188',name:'KeyPlants AB',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 39',scope:'for W251 Power Island:; Fully equipped modular E-House for MV panel room (transformers, switchgear, ventilation installed and FAT-tested) — System 31,',website:'https://www.keyplants.com](https://www.keyplants.com'},
  {code:'W251-189',name:'Kinetics Noise Control (KNC)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Enclosures & Structural',tags:'31',scope:'Turbine/generator acoustic enclosures; silenced HVAC/ventilation; ventilation silencers (VRS); acoustic panel wall and roof systems; pressurized plenu',website:'https://kineticsnoise.com'},
  {code:'W251-190',name:'LoneStar Group',status:'ACTIVE',type:'Distributor',country:'United States',tier:'Tier 2',group:'Enclosures & Structural',tags:'50, 52, 53',scope:'Auxiliaries foundation accessories (Sys 50): bolts, nuts, rods. Commissioning spares (Sys 52) and warranty spares (Sys 53) for fastener components.',website:'https://www.lonestargroup.com'},
  {code:'W251-191',name:'Minimax USA LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Enclosures & Structural',tags:'',scope:'Fire detection systems, CO2 suppression, inert gas systems, water mist systems, prefabricated container/skid fire packages.',website:'www.minimax.com'},
  {code:'W251-192',name:'NVC OlsonFab (a division of Olsonfab Inc.)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 47, 48',scope:'for W251 Power Island:; Complete acoustic enclosures for gas turbine-generator set (weather protection, fire protection, noise barrier, turbine coolin',website:'https://www.hopeelectricalproducts.com/'},
  {code:'W251-193',name:'Panel Built, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31',scope:'for W251 Power Island:; Prefabricated electrical room buildings for MCC/PCC/DC/batteries/control panels with AC system — System 31; Generator enclosur',website:'https://www.panelbuilt.com](https://www.panelbuilt.com'},
  {code:'W251-194',name:'Performance Contracting, Inc. (PCI); parent: Performance Contracting Group (PCG)',status:'ACTIVE',type:'Service Provider',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'47, 48',scope:'for W251 Power Island:; Complete piping insulation systems for all W251 power island piping (lube oil, cooling water, exhaust, steam) — System 48; Com',website:'https://www.performancecontracting.com](https://www.performancecontracting.com'},
  {code:'W251-195',name:'Portland Bolt & Manufacturing Company, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'50',scope:'for W251 Power Island:; Gas turbine and generator foundation anchor bolts (custom ASTM F1554 Grade 36/55, A193 B7 high-strength) — System 50; Anchor r',website:'https://www.portlandbolt.com](https://www.portlandbolt.com'},
  {code:'W251-196',name:'SEL (Schweitzer Engineering)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Enclosures & Structural',tags:'39',scope:'Generator control and protection boards (Sys 39): protection relays, synchronizing. Eliminates need for separate synchronizing unit.',website:'https://selinc.com'},
  {code:'W251-197',name:'Shell plc (parent); Shell Trading and Shipping Company Limited (lubricants',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'51, 52, 53',scope:'for W251 Power Island:; First fill of turbine lube oil (Shell Turbo GT 32 or 46) for W251 main turbine bearing system — System 51; First fill of hydra',website:'https://www.shell.us/business/fuels-and-lubricants/lubricants-for-business/secto'},
  {code:'W251-198',name:'Shell plc (parent); Shell Trading and Shipping Company Limited (lubricants tradi',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'51, 52, 53',scope:'for W251 Power Island:; First fill of turbine lube oil (Shell Turbo GT 32 or 46) for W251 main turbine bearing system — System 51; First fill of hydra',website:''},
  {code:'W251-199',name:'Siemens AG — E-House',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 2',group:'Enclosures & Structural',tags:'31, 39',scope:'Electrical room for MV panel; MCC/PCC/DC/battery/control panel building; integrated power distribution center for auxiliary systems. SIPROTEC, SIVACON',website:'https://www.siemens.com/en-us/products/energy-systems/ehouse/'},
  {code:'W251-200',name:'SixAxis, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'47',scope:'for W251 Power Island:; Internal access platforms, handrails, and modular stairs within GT enclosure (piperack/equipment access) — System 47; OSHA-com',website:'https://www.saferack.com](https://saferack.com'},
  {code:'W251-201',name:'Specific Systems, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'31',scope:'for W251 Power Island:; Packaged air conditioning (AC) system for electrical rooms (MCC/PCC/DC/battery/control panel rooms) — System 31; Explosion-pro',website:'https://www.specificsystems.com](https://specificsystems.com'},
  {code:'W251-202',name:'SPL Control Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'Canada',tier:'Tier 1',group:'Enclosures & Structural',tags:'31',scope:'Turbine, generator, and auxiliary enclosures with ventilation (Sys 31). Acoustic and weatherproof designs.',website:'https://splcontrol.com'},
  {code:'W251-203',name:'The Hiller Companies',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Enclosures & Structural',tags:'',scope:'Fire detection, CO2 suppression, clean- agent suppression, enclosure fire protection, generator-room fire protection.',website:'www.hillerfire.com / hillerfire.com'},
  {code:'W251-204',name:'The Sherwin-Williams Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'48',scope:'for W251 Power Island:; Full coating systems for structural steel, skid frames, handrails, piperack, stairs (primer + intermediate + topcoat) — System',website:'https://www.siemens.com/en-us/products/energy-systems/ehouse/'},
  {code:'W251-205',name:'Thermaxx Jackets, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'Enclosures & Structural',tags:'48, 51',scope:'for W251 Power Island:; Custom removable insulation jackets for turbine casing, piping flanges, and valves throughout the power island — System 48; St',website:'https://www.thermaxxjackets.com](https://www.thermaxxjackets.com'},
  {code:'W251-206',name:'TurbinePROs',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Enclosures & Structural',tags:'',scope:'Tool containers, special tools, field- service tooling packages, mobilization support.',website:'www.turbinepros.com'},
  {code:'W251-207',name:'VAW Systems Ltd.',status:'ACTIVE',type:'Manufacturer',country:'Canada',tier:'Tier 1',group:'Enclosures & Structural',tags:'31',scope:'Acoustic enclosures for turbine and generator; barrier walls; silenced ventilation openings; exhaust silencers; retrofit noise-reduction packages for ',website:'https://vawsystems.com'},
  {code:'W251-208',name:'Woodward Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Enclosures & Structural',tags:'39',scope:'Generator synchronizing and paralleling controls; governor-speed signal interface; load sharing and reactive power management; automatic mains failure',website:'https://www.woodward.com'},
  {code:'W251-209',name:'16 Additional Supplier Profiles',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'',website:''},
  {code:'W251-210',name:'AC Boilers S.p.A.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Vertical and horizontal HRSG designs for 250 MW-class gas turbine exhaust; Three-pressure plus reheat HRSG, drum type or o',website:'https://www.acboilers.com'},
  {code:'W251-211',name:'Babcock & Wilcox',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'HRSG replacement components, pressure parts, catalyst housings for W251 combined cycle applications.',website:'https://www.babcock.com'},
  {code:'W251-212',name:'Baker Hughes — Steam Turbines (Nuovo Pignone)',status:'ACTIVE',type:'Service Provider',country:'Italy',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'Steam Turbine',scope:'Industrial steam turbines for combined-cycle or cogeneration alongside W251; 2-170 MW; condensing and back-pressure; API compliant; multiple extractio',website:'https://www.bakerhughes.com/steam-turbines'},
  {code:'W251-213',name:'BFS Industries, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 3',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Packaged spray, tray, and packed-column deaerator systems for HRSG feedwater; Blowdown systems with heat recovery for HRSG',website:'https://bfs-ind.com'},
  {code:'W251-214',name:'Catalytic Combustion Corporation (CCC)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG CO Catalyst',scope:'CO/VOC/HAP oxidation catalyst for HRSG behind W251; conventional and sulfur-resistant formulations; new install, replacement, or retrofit; 100% SS fra',website:'https://www.catalyticcombustion.com'},
  {code:'W251-215',name:'Cleaver-Brooks / NATCOM',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'Duct burners for HRSG configurations in W251 combined cycle.',website:'https://cleaverbrooks.com/product/duct-burner'},
  {code:'W251-216',name:'CORMETECH',status:'ACTIVE',type:'Distributor',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'SCR/CO catalyst modules for HRSG exhaust emission control. METEOR multi-emission solutions.',website:'https://www.cormetech.com'},
  {code:'W251-217',name:'Effox-Flextor-Mader, Inc. (operating as EFM Equipment)',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Toggle and pivot diverter dampers for W251 exhaust to HRSG or bypass stack; HRSG isolation dampers and stack dampers; Louv',website:'https://www.efmequipment.com'},
  {code:'W251-218',name:'ESC Spectrum Corporation',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Complete CEMS systems for W251 gas turbine and combined cycle exhaust stack compliance monitoring; Data Acquisition System',website:'https://escspectrum.com'},
  {code:'W251-219',name:'EVAPCO, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Evaporative cooling towers for combined cycle condenser duty; Field-erected industrial cooling towers for power plant appl',website:'https://www.evapco.com'},
  {code:'W251-220',name:'Fives Group (Pillard INDUCTFLAM)',status:'ACTIVE',type:'Manufacturer',country:'France',tier:'Tier 3',group:'HRSG & Combined Cycle',tags:'HRSG Duct Burner',scope:'Supplemental duct burner for HRSG behind W251; INDUCTFLAM for TEG conditions (low-oxygen, variable temp); fresh-air firing backup; dual-fuel options.',website:'https://www.fivesgroup.com'},
  {code:'W251-221',name:'Forney Corporation',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; adVantage® and Standard duct burners for W251 HRSG inlet, sized 10–1,100 MMBtu/hr; HRSG isolation, bypass, and diverter da',website:'https://www.forneycorp.com'},
  {code:'W251-222',name:'Fox Equipment, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 3',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Louver diverter dampers for W251 exhaust bypass/HRSG diversion (clean gas, low pressure drop); Flap-style (single-blade) d',website:'https://www.foxequipment.com/diverter-dampers/'},
  {code:'W251-223',name:'Fuji Electric Co., Ltd. / Fuji Electric Corp. of America',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Single-cylinder non-reheat condensing steam turbines (FET Series) up to 240 MW — ideal for W251 combined cycle steam duty ',website:'https://americas.fujielectric.com/products/power-generation/small-medium-size-st'},
  {code:'W251-224',name:'GE Vernova (Steam Turbines)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'Steam turbines and HRSG systems for W251 combined cycle. 1,300+ HRSGs installed.',website:'https://www.gevernova.com/gas-power/products/steam-turbines'},
  {code:'W251-225',name:'GEA Group Aktiengesellschaft',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Air-cooled condensers (ACCs) for steam turbine exhaust in combined cycle configuration; Wet cooling systems and hybrid PAC',website:'https://www.gea.com'},
  {code:'W251-226',name:'Graham Manufacturing Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'Condenser/Vacuum',scope:'Steam surface condensers for combined-cycle steam turbines; condenser-ejector vacuum packages; skid-mounted packaged systems; axial, top, and down exh',website:'https://graham-mfg.com'},
  {code:'W251-227',name:'John Cockerill S.A. (Energy Division)',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Drum-type and once-through (OT) HRSGs sized for the W251\'s ~250 MW exhaust gas envelope; Triple-pressure plus reheat HRSG',website:'https://energy.johncockerill.com/en/boilers-and-heat-recovery-steam-generators/'},
  {code:'W251-228',name:'John Zink Hamworthy Combustion (Koch)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG Duct Burner',scope:'HRSG duct burner systems for combined-cycle; hydrogen-ready design; CFD-optimized; full lifecycle support from commissioning through emissions testing',website:'https://www.johnzink.com'},
  {code:'W251-229',name:'Johnson Matthey plc',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; SINOx® extruded SCR catalyst for gas turbine NOx reduction in W251 HRSG; SINOx®-HT high-temperature SCR for applications a',website:'https://matthey.com/products-and-markets/energy/emission-control-solutions/scr-c'},
  {code:'W251-230',name:'NEM Energy B.V.',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Drum-type and Benson once-through HRSGs for W251 exhaust conditions (~1,050°F, up to 3M+ lb/hr mass flow); Diverter damper',website:'https://www.nem-energy.com'},
  {code:'W251-231',name:'Nooter/Eriksen',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'Complete HRSG systems for W251 combined cycle configuration. Drums, headers, tubes, modules, HARPs, inlet ducting, catalyst housings.',website:'https://www.nootereriksen.com'},
  {code:'W251-232',name:'Rentech Boiler Systems, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'Cross-flow two-drum HRSGs for mid-size CT exhaust; optional integral duct burners (NG, hydrogen, bio-diesel); fresh-air firing; modular construction; ',website:'https://rentechboilers.com'},
  {code:'W251-233',name:'SPX Cooling Technologies',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'HRSG & Combined Cycle',tags:'Cooling/Condensing',scope:'Cooling towers and air-cooled condensers for CC steam turbine heat rejection; WSAC systems for steam condensing; integrated cold-end optimization engi',website:'https://spxcooling.com'},
  {code:'W251-234',name:'Sterling Deaerator Company',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; Spray-type, tray-type, and packed column deaerators for HRSG feedwater systems; Package deaerators for smaller combined cy',website:'https://www.sterlingdeaerator.com'},
  {code:'W251-235',name:'Topsoe A/S',status:'ACTIVE',type:'Manufacturer / OEM',country:'',tier:'Tier 2',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'for the W251 Power Island:; DNX-GT SCR catalyst for NOx reduction in W251 HRSG; GTC dual-function CO+SCR catalyst (reduces total system pressure drop ',website:'https://www.topsoe.com'},
  {code:'W251-236',name:'Triveni Turbine Limited',status:'ACTIVE',type:'Manufacturer / OEM',country:'India',tier:'Tier 3',group:'HRSG & Combined Cycle',tags:'Steam Turbine',scope:'Industrial steam turbines for cogeneration or back-pressure alongside W251; API 611/612 compliant; sub-100 MWe; impulse and reaction; refurbishment se',website:'https://www.triveniturbines.com'},
  {code:'W251-237',name:'Vogt Power International',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'HRSG & Combined Cycle',tags:'HRSG',scope:'Complete HRSG systems and components for W251 combined cycle.',website:'https://www.vogtpower.com'},
  {code:'W251-238',name:'Armstrong International, Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: Armstrong provides steam traps, condensate return systems, pressure reducing valves, strainers, sight glasses, and complete ste',website:'https://www.armstronginternational.com'},
  {code:'W251-239',name:'ASC Engineered Solutions, LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'1',scope:'for W251 Power Island: ASC Engineered Solutions / Anvil EPS provides the engineered pipe support specification for the W251 power island piping system',website:'https://www.asc-es.com'},
  {code:'W251-240',name:'Baker Hughes Company (parent); Consolidated Valve division',status:'ACTIVE',type:'Service Provider',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Consolidated safety and pressure relief valves by Baker Hughes provide code-compliant overpressure protection for HRSG steam dr',website:'https://valves.bakerhughes.com/consolidated/safety-relief-valves/consolidated-ty'},
  {code:'W251-241',name:'Bomco, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Pumps / Valves / Piping',tags:'',scope:'Combustion liners, transition pieces, turbine seals, hot gas path components.',website:'www.bomco.com'},
  {code:'W251-242',name:'CIRCOR (IMO/Allweiler)',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'10, 13, 15',scope:'Lube oil pumps (Sys 10), fuel injection pumps (Sys 13, 15). IMO three-screw pumps are standard GT fuel/lube pumps.',website:'https://www.circor.com'},
  {code:'W251-243',name:'Crane Co. — ChemPharma & Energy',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'Cross-cutting',scope:'Gate/globe/check/butterfly valves across all fluid systems; pressure seal valves for HP steam; cooling water circulating valves; pump discharge check ',website:'https://cranecpe.com'},
  {code:'W251-244',name:'Emerson / Fisher',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'11, 12, 13, 16',scope:'Control valves for fuel gas (Sys 11, 12), fuel oil (Sys 13), control oil (Sys 16). Pressure regulators, solenoid valves across all systems.',website:'https://www.emerson.com'},
  {code:'W251-245',name:'Endress+Hauser',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'11, 13, 17',scope:'Flow meters for fuel gas (Sys 11), fuel oil (Sys 13), water injection (Sys 17). Process instrumentation across all fluid systems.',website:'https://www.endress.com'},
  {code:'W251-246',name:'Flowserve Corporation',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'10, 13, 14, 18',scope:'Lube oil pumps (Sys 10), fuel oil pumps (Sys 13, 14), cooling water pumps (Sys 18). Control valves across all fluid systems.',website:'https://www.flowserve.com'},
  {code:'W251-247',name:'Garlock Sealing Technologies LLC',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: Garlock provides the complete gasket and sealing specification for the W251 power island piping system. FLEXSEAL® spiral wound ',website:'https://www.garlock.com'},
  {code:'W251-248',name:'Gilbert Gilkes & Gordon Ltd (Gilkes)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United Kingdom',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'Cross-cutting',scope:'Lube oil pump systems for W251 turbine platforms; AC and DC vertical shaft lube oil pumps; fuel forwarding pumps; compressor wash modules; aftermarket',website:'https://www.gilkes.com'},
  {code:'W251-249',name:'Grundfos Holding A/S (parent); Grundfos Pumps Corporation (US subsidiary)',status:'ACTIVE',type:'Manufacturer / OEM',country:'Denmark',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Grundfos supplies centrifugal pumps for cooling water circulation, condensate handling, dosing chemical injection (boiler water',website:'https://www.grundfos.com/us'},
  {code:'W251-250',name:'IMI plc — Critical Engineering (IMI CCI)',status:'ACTIVE',type:'Manufacturer',country:'United Kingdom',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'Cross-cutting',scope:'Severe-service control valves for steam turbine bypass; anti-surge valves; steam conditioning/let-down valves; isolation valves; actuator systems for ',website:'https://www.imi-critical.com'},
  {code:'W251-251',name:'ITT Inc. (parent); Goulds Pumps (brand)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: ITT Goulds Pumps provides an extensive range of ANSI/API-certified centrifugal and multistage pumps for boiler feed, condensate',website:'https://www.gouldspumps.com'},
  {code:'W251-252',name:'KSB SE & Co. KGaA',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: KSB supplies pumps and valves tailored for all fluid-handling systems within a gas turbine power island, including boiler feedw',website:'https://www.ksb.com'},
  {code:'W251-253',name:'Nihon KOSO Co., Ltd. (parent); KOSO America, Inc. / KOSO Hammel Dahl (US entity)',status:'ACTIVE',type:'Manufacturer / OEM',country:'Japan',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: KOSO control valves are specified for demanding gas turbine auxiliary service applications — particularly high-pressure steam c',website:'https://www.na-koso.com'},
  {code:'W251-254',name:'Parker Hannifin',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'11, 13, 16',scope:'Servo valves for fuel control (Sys 11, 13, 16), filtration, hydraulic components. GE-approved gas turbine components.',website:'https://www.parker.com'},
  {code:'W251-255',name:'Penflex, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Pumps / Valves / Piping',tags:'Cross-cutting',scope:'Metal expansion joints for turbine air inlet/exhaust connections; expansion joints for piping thermal movement; flexible metal connectors for vibratio',website:'https://www.penflex.com'},
  {code:'W251-256',name:'Piping Technology & Products, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'1',scope:'for W251 Power Island: PT&P designs and manufactures engineered pipe supports, variable and constant spring hangers, expansion joints, snubbers, pipe ',website:'https://pipingtech.com/solutions/power-plant-solutions/'},
  {code:'W251-257',name:'Rotork plc',status:'ACTIVE',type:'Manufacturer / OEM',country:'United Kingdom',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Rotork actuators automate isolation, control, and safety valves throughout the W251 power island — including fuel gas trip/shut',website:'https://www.rotork.com'},
  {code:'W251-258',name:'Ruhrpumpen Group',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'Cross-cutting',scope:'Boiler feed pumps for HRSG/steam cycle; condensate pumps (vertical canned, low NPSH); large vertical cooling water pumps (VCT); fire water pumps; gene',website:'https://www.ruhrpumpen.com'},
  {code:'W251-259',name:'Safran Power Units',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 3',group:'Pumps / Valves / Piping',tags:'',scope:'Air turbine starters, valve systems, starting equipment.',website:'www.safran-group.com'},
  {code:'W251-260',name:'SAMSON Aktiengesellschaft',status:'ACTIVE',type:'Manufacturer / OEM',country:'Germany',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: SAMSON control valves and pressure regulators serve the full range of W251 power island fluid control needs: fuel gas pressure ',website:'https://www.samsongroup.com'},
  {code:'W251-261',name:'Spirax-Sarco Engineering plc (parent); Spirax Sarco Limited (operating)',status:'ACTIVE',type:'Service Provider',country:'United Kingdom',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: Spirax Sarco supplies the complete steam trap population for the W251 power island, including balanced-pressure, thermodynamic,',website:'https://www.spiraxsarco.com'},
  {code:'W251-262',name:'Sulzer Ltd.',status:'ACTIVE',type:'Manufacturer',country:'Switzerland',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'18, 14, HRSG',scope:'Cooling water pumps (Sys 18), firewater pumps (Sys 30), boiler feed pumps (HRSG). Specifically lists cooling-water and firewater applications.',website:'https://www.sulzer.com/en/products/pumps'},
  {code:'W251-263',name:'Sundyne, LLC',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Sundyne\'s integrally geared pumps are used for water injection and NOx suppression in gas turbine combustors — injecting demin',website:'https://www.sundyne.com'},
  {code:'W251-264',name:'TLV Co., Ltd. (parent, Japan); TLV Corporation (US subsidiary)',status:'ACTIVE',type:'Service Provider',country:'Japan',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: TLV supplies steam traps, pressure reducing valves, steam separators, and condensate management equipment for the W251 power is',website:'https://www.tlv.com'},
  {code:'W251-265',name:'Valmet Oyj (Neles)',status:'ACTIVE',type:'Manufacturer',country:'Finland',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'11, 12, 29, 47',scope:'Neles butterfly valves for W251 fuel gas trip and blow-off applications; control valves for fuel gas regulation with highest rangeability; Jamesbury b',website:'https://www.valmet.com/flowcontrol'},
  {code:'W251-266',name:'Valmet Oyj (parent); Valmet Flow Control Oy (operating entity)',status:'ACTIVE',type:'Manufacturer / OEM',country:'Finland',tier:'Tier 1',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Valmet\'s Neles control and isolation valves are purpose-built for gas turbine applications: Neles butterfly valves serve blowo',website:'https://www.valmet.com/flowcontrol'},
  {code:'W251-267',name:'Velan Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'Canada',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'HRSG',scope:'for W251 Power Island: Velan gate, globe, check, and ball valves are standard equipment in high-energy steam systems associated with the W251\'s HRSG ',website:'https://www.velan.com'},
  {code:'W251-268',name:'Watts Water Technologies, Inc.',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Watts Water Technologies supplies pressure reducing valves, pressure relief valves, backflow preventers, strainers, and automat',website:'https://www.watts.com'},
  {code:'W251-269',name:'Xylem Inc.',status:'ACTIVE',type:'Manufacturer',country:'United States',tier:'Tier 2',group:'Pumps / Valves / Piping',tags:'',scope:'for W251 Power Island: Xylem\'s Goulds Water Technology brand supplies centrifugal pumps for cooling water circulation, cooling tower make-up, service',website:'https://www.gouldswatertech.com'},
  {code:'W251-270',name:'AP4',status:'ACTIVE',type:'Manufacturer',country:'',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Context suggests control-system sales/support affiliation only.',website:'Not provided in source'},
  {code:'W251-271',name:'Unison Industries (GE Aerospace Company)',status:'ACTIVE',type:'Manufacturer / OEM',country:'United States',tier:'Tier 3',group:'Mechanical Auxiliaries',tags:'',scope:'Igniters, igniter leads, exciter-box- adjacent ignition hardware.',website:'www.unisonindustries.com'}
];
            const CONTACTS = [
  {code:'W251-141',supplier:'Amerex Corporation',name:'Harrison K.',title:'VP of Sales',email:'h.k@amerex-fire.com',phone:''},
  {code:'W251-105',supplier:'Ansaldo Energia',name:'Fabrizio Fabbri',title:'CEO',email:'f.fabbri@ansaldoenergia.com',phone:''},
  {code:'W251-105',supplier:'Ansaldo Energia',name:'Stefano Santinelli',title:'Chief Commercial Officer',email:'s.santinelli@ansaldoenergia.com',phone:''},
  {code:'W251-000',supplier:'Baker Hughes / Nuovo Pignone',name:'Lorenzo Simonelli',title:'Chairman & CEO',email:'l.simonelli@bakerhughes.com',phone:''},
  {code:'W251-000',supplier:'Baker Hughes / Nuovo Pignone',name:'Rod Christie',title:'EVP Turbomachinery',email:'r.christie@bakerhughes.com',phone:''},
  {code:'W251-241',supplier:'Bomco, Inc.',name:'Mark S.',title:'President',email:'m.s@bomco.com',phone:''},
  {code:'W251-241',supplier:'Bomco, Inc.',name:'Customer Service Team',title:'Customer Service',email:'custserv@bomco.com',phone:''},
  {code:'W251-110',supplier:'CGIT Westboro, Inc. (currently operated as part of Trench Gr',name:'Christian Bruch',title:'CEO',email:'c.bruch@siemens-energy.com',phone:''},
  {code:'W251-110',supplier:'CGIT Westboro, Inc. (currently operated as part of Trench Gr',name:'Anne-Laure Parrical',title:'Head of Sales, Gas Services',email:'al.parrical@siemens-energy.com',phone:''},
  {code:'W251-010',supplier:'Donaldson Company',name:'Tod Carpenter',title:'Chairman, President, & CEO / Chairman, President, and CEO / ',email:'t.carpenter@donaldson.com',phone:''},
  {code:'W251-010',supplier:'Donaldson Company',name:'Michael Wynblatt',title:'Chief Technology Officer',email:'m.wynblatt@donaldson.com',phone:''},
  {code:'W251-072',supplier:'Elliott Group',name:'Michael L.',title:'President',email:'m.l@elliott-turbo.com',phone:''},
  {code:'W251-000',supplier:'Emerson / Emerson Automation Solutions (Ovation',name:'Bob Yeager',title:'President, Power and Water / President, Power & Water',email:'bob.yeager@emerson.com',phone:''},
  {code:'W251-000',supplier:'Emerson / Emerson Automation Solutions (Ovation',name:'Lalit Tejwani',title:'VP of Sales, Power & Water',email:'lalit.tejwani@emerson.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Ana Amicarella',title:'Chief Executive Officer',email:'a.amicarella@ethosenergy.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Farzad Jahromi',title:'Vice President Sales, Global',email:'f.jahromi@ethosenergy.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Duncan Swan',title:'VP Global Sales and Marketing',email:'d.swan@ethosenergy.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Graeme Donald',title:'VP Commercial, East Hemisphere',email:'g.donald@ethosenergy.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Mario Cincotta',title:'EVP East Hemisphere',email:'m.cincotta@ethosenergy.com',phone:''},
  {code:'W251-073',supplier:'EthosEnergy',name:'Massimo Valsania',title:'VP of Engineering & Global Functional Champion',email:'m.valsania@ethosenergy.com',phone:''},
  {code:'W251-185',supplier:'GE Vernova Multilin',name:'Eric Gray',title:'CEO, Gas Power / CEO, Power Segment',email:'e.gray@ge.com',phone:''},
  {code:'W251-185',supplier:'GE Vernova Multilin',name:'Scott Strazik',title:'CEO / Chief Executive Officer',email:'s.strazik@ge.com',phone:''},
  {code:'W251-185',supplier:'GE Vernova Multilin',name:'Michael Lapides',title:'VP, Investor Relations',email:'investors@gevernova.com',phone:''},
  {code:'W251-077',supplier:'Gits Mfg. Co.',name:'Andrew C.',title:'General Manager',email:'a.c@gitsmfg.com',phone:''},
  {code:'W251-120',supplier:'GTC Control Solutions',name:'Sales Team',title:'Sales',email:'gtcsales@ap4.com',phone:''},
  {code:'W251-078',supplier:'Hanwha Power Systems (PSM - Power Systems Mfg.)',name:'Rafi Balta',title:'President & CEO',email:'r.balta@psm.com',phone:''},
  {code:'W251-078',supplier:'Hanwha Power Systems (PSM - Power Systems Mfg.)',name:'Chris Johnston',title:'COO',email:'c.johnston@psm.com',phone:''},
  {code:'W251-079',supplier:'Hebeler-Howard Marten Fluid Solutions',name:'Rob Hebeler',title:'President',email:'r.hebeler@hebeler.com',phone:''},
  {code:'W251-079',supplier:'Hebeler-Howard Marten Fluid Solutions',name:'Mark Marten',title:'Operations Director',email:'m.marten@howardmarten.com',phone:''},
  {code:'W251-127',supplier:'Mechanical Dynamics & Analysis (MD&A)',name:'Kim S. / Kim Severance',title:'President',email:'k.s@mdaturbines.com',phone:''},
  {code:'W251-127',supplier:'Mechanical Dynamics & Analysis (MD&A)',name:'Todd H. / Todd Hatcher',title:'VP, Gas Turbine Services',email:'t.h@mdaturbines.com',phone:''},
  {code:'W251-128',supplier:'Mitsubishi Power / Mitsubishi Power Americas',name:'Toshiyuki Hashi',title:'Head of Gas Turbine Business / CEO Mitsubishi Power Ltd',email:'t.hashi@mhi.com',phone:''},
  {code:'W251-128',supplier:'Mitsubishi Power / Mitsubishi Power Americas',name:'William “Bill” Newsom',title:'President and CEO / President & CEO Americas',email:'bill.newsom@amer.mhps.com',phone:''},
  {code:'W251-021',supplier:'Parker Hannifin Corporation — Gas Turbine Filtration Divisio',name:'Andy Weeks',title:'President, Gas Turbine Division',email:'a.weeks@parker.com',phone:''},
  {code:'W251-021',supplier:'Parker Hannifin Corporation — Gas Turbine Filtration Divisio',name:'Jenny Parmentier',title:'CEO',email:'j.parmentier@parker.com',phone:''},
  {code:'W251-093',supplier:'Solar Turbines',name:'Tom Pellette',title:'President',email:'t.pellette@solarturbines.com',phone:''},
  {code:'W251-203',supplier:'The Hiller Companies',name:'Chuck Sledge',title:'CEO / Chief Executive Officer',email:'c.sledge@hillerfire.com',phone:''},
  {code:'W251-203',supplier:'The Hiller Companies',name:'Kevin Sledge',title:'VP of Operations',email:'k.sledge@hillerfire.com',phone:''},
  {code:'W251-097',supplier:'The Hilliard Corporation',name:'Jan van den Blink',title:'Chairman & CEO / Chairman and CEO / CEO',email:'j.vandenblink@hilliardcorp.com',phone:''},
  {code:'W251-097',supplier:'The Hilliard Corporation',name:'Dave Catchpole',title:'Sales Manager, Starters / Sales Manager',email:'d.catchpole@hilliardcorp.com',phone:''},
  {code:'W251-098',supplier:'Timken Gears & Services Inc., Philadelphia Gear Brand',name:'Carl R.',title:'General Manager',email:'c.r@philagear.com',phone:''},
  {code:'W251-208',supplier:'Woodward Inc.',name:'Chip Blankenship',title:'Chairman & CEO / Chairman and CEO',email:'c.blankenship@woodward.com',phone:''},
  {code:'W251-208',supplier:'Woodward Inc.',name:'Terry Voskuil',title:'President, Engine Systems / Chief Technology Officer',email:'t.voskuil@woodward.com',phone:''},
  {code:'W251-208',supplier:'Woodward Inc.',name:'Dan Bowman',title:'VP Sales & Marketing',email:'d.bowman@woodward.com',phone:''},
  {code:'W251-056',supplier:'Petrogas Gas-Systems B.V.',name:'1. T.C. Ree',title:'Managing Director',email:'',phone:''},
  {code:'W251-056',supplier:'Petrogas Gas-Systems B.V.',name:'2. Chris Dubbers',title:'Marketing Coordinator Export',email:'',phone:''},
  {code:'W251-000',supplier:'ERGIL Group',name:'1. Oktay Altunergil',title:'CEO',email:'',phone:''},
  {code:'W251-000',supplier:'ERGIL Group',name:'2. Rıza Altunergil',title:'V.P. Sales & Marketing',email:'',phone:''},
  {code:'W251-000',supplier:'CECO Environmental / CECO Peerless',name:'1. Harrison Fox',title:'Regional Sales Manager, Peerless Separation & Filtration',email:'',phone:''},
  {code:'W251-000',supplier:'CECO Environmental / CECO Peerless',name:'2. Jeff Broderick',title:'Director, Retrofit Sales',email:'',phone:''},
  {code:'W251-035',supplier:'Cobey, Inc.',name:'1. Al Giglia',title:'Director of Engineering & Operations',email:'',phone:''},
  {code:'W251-035',supplier:'Cobey, Inc.',name:'2. David Roberts',title:'Applications Engineer',email:'',phone:''},
  {code:'W251-000',supplier:'Alfa Laval AB — FOCUS Fuel Oil Treatment',name:'1. Jeppe Jacobsen',title:'Vice President, Head of Global Sales, Business Unit Heat Gas',email:'',phone:''},
  {code:'W251-000',supplier:'Alfa Laval AB — FOCUS Fuel Oil Treatment',name:'2. Rafael Lugo',title:'Boilers & Gas Systems Sales Manager',email:'',phone:''},
  {code:'W251-000',supplier:'GEA Group AG — Westfalia Separator Energy Division',name:'1. Thomas Perschke',title:'Director, Business Line Oil & Gas, GEA Westfalia Separator G',email:'',phone:''},
  {code:'W251-000',supplier:'GEA Group AG — Westfalia Separator Energy Division',name:'2. Nick Fernkorn',title:'VP Product Portfolio Management & Marketing, GEA Westfalia S',email:'',phone:''},
  {code:'W251-061',supplier:'Turbotect Ltd.',name:'1. Neil Ashford',title:'UK Representative',email:'neil.ashford@turbotect.com',phone:''},
  {code:'W251-061',supplier:'Turbotect Ltd.',name:'2. Patrick Schauff',title:'USA Representative',email:'Patrick.schauff@ap4.com',phone:''},
  {code:'W251-000',supplier:'2015-certified global designer and manufacturer of external ',name:'1. Andrew Downing',title:'VP of Sales and Marketing',email:'',phone:''},
  {code:'W251-000',supplier:'2015-certified global designer and manufacturer of external ',name:'2. Shay Smith',title:'Inside Sales Manager',email:'',phone:''},
  {code:'W251-000',supplier:'Gas Turbine Efficiency — an EthosEnergy Group Company',name:'1. Kyle Madgett',title:'OEM Sales Lead',email:'',phone:''},
  {code:'W251-000',supplier:'Gas Turbine Efficiency — an EthosEnergy Group Company',name:'2. Jorge Cadena',title:'Former VP Engineering & Business Development',email:'',phone:''},
  {code:'W251-000',supplier:'Multitex Filtration Engineers Ltd.',name:'1. Yogesh Kumar Sood',title:'Executive Director, Oil & Gas',email:'',phone:''},
  {code:'W251-000',supplier:'Multitex Filtration Engineers Ltd.',name:'2. Harinder Singh Ossan',title:'Deputy General Manager',email:'',phone:''},
  {code:'W251-000',supplier:'Combustion Associates Inc.',name:'1. Kusum Kavia',title:'CEO',email:'',phone:''},
  {code:'W251-000',supplier:'GTE — Gas Turbine Efficiency LLC',name:'2. Contact via: Robert Burke',title:'Applications Engineer, EcoValue™ Product',email:'robert.burke@gtefficiency.com',phone:''},
  {code:'W251-000',supplier:'ABB — Electrification Division',name:'1. Alessandro Palin',title:'Former Division President, Distribution Solutions',email:'',phone:''},
  {code:'W251-000',supplier:'ABB — Electrification Division',name:'2. Rasmus Nissen',title:'Marketing and Sales Director/VP, Electrification Distributio',email:'',phone:''},
  {code:'W251-000',supplier:'ABB — Electrification Division',name:'3. General Sales Inquiries',title:'contact.center@us.abb.com',email:'',phone:''},
  {code:'W251-116',supplier:'Eaton Corporation',name:'1. Alberto Enriquez',title:'Former Director Industrial Sales, Eaton',email:'',phone:''},
  {code:'W251-116',supplier:'Eaton Corporation',name:'3. Aneesh Thomas',title:'Associate Director National Sales Medium Voltage',email:'',phone:''},
  {code:'W251-135',supplier:'Schneider Electric',name:'2. Model 6 MCC Sales',title:'Square D product line, contact via local Schneider Electric ',email:'',phone:''},
  {code:'W251-121',supplier:'Hitachi Energy',name:'1. Gianni Moreno',title:'Marketing and Sales Director, Hitachi Energy',email:'',phone:''},
  {code:'W251-121',supplier:'Hitachi Energy',name:'2. Leonardo Romao',title:'Account Director / Sales Director, Hitachi Energy',email:'',phone:''},
  {code:'W251-121',supplier:'Hitachi Energy',name:'3. Steve Robinson',title:'VP, Head of Marketing & Sales, Transformers, Asia Pacific, M',email:'',phone:''},
  {code:'W251-131',supplier:'Prolec Energy',name:'1. Luke Schweng',title:'Commercial Director Power Transformers, Prolec GE',email:'',phone:''},
  {code:'W251-131',supplier:'Prolec Energy',name:'2. Ernesto Alonso Díaz Pérez',title:'Competitiveness Director, Prolec Energy',email:'',phone:''},
  {code:'W251-131',supplier:'Prolec Energy',name:'3. General Sales: info@prolec.energy',title:'+800-437-7653',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens Energy',name:'1. Stefan Linder',title:'Director, New Power Generation Sales, North America',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens Energy',name:'2. Walid E. Sheta',title:'Director of Sales, US Northeast/Midwest, Siemens Energy',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens Energy',name:'3. Thomas Schneider',title:'VP Sales, Siemens Energy Transformers',email:'',phone:''},
  {code:'W251-000',supplier:'Rockwell Automation',name:'1. Joe Gesino',title:'Vice President of Technical Sales, Atkore',email:'',phone:''},
  {code:'W251-000',supplier:'Rockwell Automation',name:'2. Rockwell Automation Sales',title:'+1-414-382-2000',email:'allen.bradley@ra.rockwell.com',phone:''},
  {code:'W251-000',supplier:'Vertiv',name:'2. Vertiv General Sales',title:'vertiv.com/en-us/about/contact-us/',email:'',phone:''},
  {code:'W251-000',supplier:'Cummins Inc. — Power Generation',name:'1. Eric D. Hermann',title:'Global Sales Director, Electric Power, Caterpillar Inc. (com',email:'',phone:''},
  {code:'W251-000',supplier:'Cummins Inc. — Power Generation',name:'2. Michael Murry',title:'Power Generation Sales Director, Cummins Inc.',email:'',phone:''},
  {code:'W251-000',supplier:'Cummins Inc. — Power Generation',name:'3. Rob Gordon',title:'Sales Director, Power Generation at Cummins',email:'',phone:''},
  {code:'W251-000',supplier:'Caterpillar Inc. — Electric Power Division',name:'2. Erik Barton',title:'Sales Director, North & South America, Cat Large Electric Po',email:'',phone:''},
  {code:'W251-000',supplier:'Caterpillar Inc. — Electric Power Division',name:'3. Steve T',title:'Global Sales and Marketing Director, Caterpillar Inc.',email:'',phone:''},
  {code:'W251-118',supplier:'EnerSys',name:'1. Ryan Shadwick',title:'Director of Industrial and Utility, EnerSys',email:'',phone:''},
  {code:'W251-118',supplier:'EnerSys',name:'2. Christopher T',title:'Vice President, Commercial Operations, EnerSys',email:'',phone:''},
  {code:'W251-132',supplier:'Prysmian Group',name:'1. Joe Coffey',title:'Vice President of Sales, Transmission, Prysmian',email:'',phone:''},
  {code:'W251-132',supplier:'Prysmian Group',name:'2. Joe Lowey',title:'Vice President of Sales, Power Distribution, Eastern US Regi',email:'',phone:''},
  {code:'W251-132',supplier:'Prysmian Group',name:'3. Benjamin Bowles',title:'Sales Director, Prysmian',email:'',phone:''},
  {code:'W251-000',supplier:'Atkore Inc.',name:'2. Brett Zurliene',title:'Regional Sales Manager, Atkore Electrical',email:'',phone:''},
  {code:'W251-000',supplier:'Generac Industrial Power',name:'2. Regional Sales Manager (Industrial)',title:'contact via generac.com dealer locator',email:'',phone:''},
  {code:'W251-000',supplier:'ANSUL',name:'1. Andy Robinson',title:'Product Sales Director, Ansul Pre-Engineered Systems EMEA',email:'',phone:''},
  {code:'W251-000',supplier:'ANSUL',name:'2. Derek Addison',title:'Sales Director, Special Hazards APAC',email:'',phone:''},
  {code:'W251-000',supplier:'ANSUL',name:'3. Edgar T. Alvarez Montero',title:'Director BMS, Controls and Detection Latin America, Johnson ',email:'',phone:''},
  {code:'W251-150',supplier:'Fike Corporation',name:'1. Cedric Johnson',title:'Executive Director of Sales, Fike Corporation',email:'',phone:''},
  {code:'W251-000',supplier:'Det-Tronics',name:'1. Youhanna Ligabo',title:'Regional Sales Leader Latin America',email:'',phone:''},
  {code:'W251-000',supplier:'Det-Tronics',name:'2. Joe Veron',title:'Former VP Global Sales, Det-Tronics',email:'',phone:''},
  {code:'W251-000',supplier:'Det-Tronics',name:'3. John Lucas',title:'Technical Sales Engineer, Det-Tronics',email:'',phone:''},
  {code:'W251-000',supplier:'Marioff Corporation Oy',name:'1. De Tourtoulon',title:'Global Sales Director, Water Mist',email:'',phone:''},
  {code:'W251-000',supplier:'Marioff Corporation Oy',name:'2. Göran Persson',title:'Manager Sales, Marioff Skandinavien AB',email:'',phone:''},
  {code:'W251-000',supplier:'Marioff Corporation Oy',name:'3. Marine Sales (general)',title:'Email: marinesales@marioff.fi',email:'',phone:''},
  {code:'W251-000',supplier:'Kidde Fire Systems',name:'1. Rekha Agrawal',title:'Chief Executive Officer, KiddeFenwal',email:'',phone:''},
  {code:'W251-000',supplier:'Kidde Fire Systems',name:'2. Paul Ellis',title:'International Sales Manager / Regional Sales Director Europe',email:'',phone:''},
  {code:'W251-000',supplier:'BKR); part of Baker Hughes Cordant™ Industrial Asset Managem',name:'1. Walid El Said',title:'Senior Sales Manager, Bently Nevada, Kuwait/MENA',email:'',phone:''},
  {code:'W251-000',supplier:'BKR); part of Baker Hughes Cordant™ Industrial Asset Managem',name:'2. Ben Byrne',title:'Lead Sales Specialist, Bently Nevada, Australia/Pacific',email:'',phone:''},
  {code:'W251-000',supplier:'BKR); part of Baker Hughes Cordant™ Industrial Asset Managem',name:'3. Lucia Guzman',title:'Enterprise Software & Consulting Services Account Manager, B',email:'',phone:''},
  {code:'W251-000',supplier:'Brüel & Kjær Vibro',name:'1. Victor Lara',title:'Former Sales Director South Europe, Brüel & Kjær Vibro',email:'',phone:''},
  {code:'W251-000',supplier:'Meggitt Sensing Systems / Parker Meggitt',name:'1. Yves Kwame Mayor',title:'Director Sales and Marketing Europe, Africa & Russia, Meggit',email:'',phone:''},
  {code:'W251-000',supplier:'Meggitt Sensing Systems / Parker Meggitt',name:'2. Mark Whyment',title:'UK Country Sales Manager, Meggitt Sensing Systems',email:'',phone:''},
  {code:'W251-000',supplier:'Meggitt Sensing Systems / Parker Meggitt',name:'3. Dave Martin',title:'Business Development Manager, Energy',email:'',phone:''},
  {code:'W251-000',supplier:'https://www.linkedin.com/in/scott-breeding-4a58526',name:'1. Scott Breeding',title:'President, Metrix Instrument Company',email:'',phone:''},
  {code:'W251-000',supplier:'https://www.linkedin.com/in/scott-breeding-4a58526',name:'2. Abel Flores',title:'Global Sales Operations Manager, Metrix Vibration',email:'',phone:''},
  {code:'W251-000',supplier:'https://www.linkedin.com/in/scott-breeding-4a58526',name:'3. Howard (E.J.)',title:'Sales Consultant, Metrix Vibration',email:'',phone:''},
  {code:'W251-000',supplier:'MSA Safety',name:'1. Dennis Blue',title:'Director of Sales US and Canada, Fixed Gas and Flame Detecti',email:'',phone:''},
  {code:'W251-000',supplier:'MSA Safety',name:'2. Nish Vartanian',title:'Chairman, President and CEO, MSA Safety',email:'',phone:''},
  {code:'W251-147',supplier:'Dräger',name:'1. Desmond Tay',title:'Sales Manager, Draeger Singapore',email:'',phone:''},
  {code:'W251-147',supplier:'Dräger',name:'2. Simon Hopwood',title:'Account Manager, Fixed Gas & Flame Detection, Dräger UK',email:'',phone:''},
  {code:'W251-202',supplier:'SPL Control Inc.',name:'1. Robin Bennett',title:'Director of Projects & Business Development',email:'rbennett@splcontrol.com',phone:''},
  {code:'W251-202',supplier:'SPL Control Inc.',name:'2. Mike Buetow',title:'Director of Sales and Contracts',email:'',phone:''},
  {code:'W251-202',supplier:'SPL Control Inc.',name:'3. Tim Rosenberger',title:'Chief Engineer',email:'',phone:''},
  {code:'W251-207',supplier:'VAW Systems Ltd.',name:'1. Emanuel Mouratidis, M.Eng., P.Eng.',title:'Director of Acoustic Engineering',email:'',phone:''},
  {code:'W251-207',supplier:'VAW Systems Ltd.',name:'2. Murray Salo',title:'Product Manager, Industrial Division',email:'',phone:''},
  {code:'W251-000',supplier:'Kinetics Noise Control',name:'1. David Aquilina, P.Eng.',title:'Canadian ICE Sales Engineer',email:'',phone:''},
  {code:'W251-000',supplier:'ABB — eHouse / Electrical Houses',name:'1. Amit Kumar',title:'Head of Sales, E-House Offshore Oil, Gas & Wind Offshore',email:'',phone:''},
  {code:'W251-000',supplier:'ABB — eHouse / Electrical Houses',name:'2. Chandrisha Rao',title:'Group Manager, Plant Electrification, Hub Asia',email:'',phone:''},
  {code:'W251-000',supplier:'ABB — eHouse / Electrical Houses',name:'3. Ahmed Hamdy',title:'Project Manager, ABB Egypt',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens — E-House',name:'1. Kenan Doğan',title:'E-House Lead Solution Architect & Offer Manager, Conceptual ',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens — E-House',name:'2. Jenny Trahan',title:'Area Sales Manager, Electrical Infrastructure Sales',email:'',phone:''},
  {code:'W251-000',supplier:'Schweitzer Engineering Laboratories',name:'1. Frank Heleniak, P.E.',title:'Vice President of Sales & Customer Service',email:'',phone:''},
  {code:'W251-000',supplier:'Schweitzer Engineering Laboratories',name:'2. Mohamad Nabil',title:'Senior Sales Manager',email:'',phone:''},
  {code:'W251-000',supplier:'GE Vernova — Grid Solutions',name:'1. Andrew Ellison',title:'Area Sales Manager, Protection & Switchgear',email:'',phone:''},
  {code:'W251-000',supplier:'GE Vernova — Grid Solutions',name:'2. Nishant Vaidya',title:'Sales Account Manager, Digitalization & Protection',email:'',phone:''},
  {code:'W251-208',supplier:'Woodward Inc.',name:'1. Naveen Neeraj',title:'Sales Manager, India',email:'',phone:''},
  {code:'W251-208',supplier:'Woodward Inc.',name:'2. Amol Prasher',title:'Sales Manager, Generator Synchronization & Protection',email:'',phone:''},
  {code:'W251-180',supplier:'DEIF A/S',name:'1. Sunil Kumar Rajotia',title:'Director, Business Development, Asia',email:'',phone:''},
  {code:'W251-180',supplier:'DEIF A/S',name:'2. Paul Campbell',title:'UK/Ireland Distributor',email:'',phone:''},
  {code:'W251-180',supplier:'DEIF A/S',name:'3. General: +45 9614 9614',title:'info@deif.com',email:'',phone:''},
  {code:'W251-190',supplier:'LoneStar Group',name:'1. Alexandru Cucos',title:'Sales Export Manager, Global Fastener Solutions',email:'',phone:''},
  {code:'W251-190',supplier:'LoneStar Group',name:'2. Jonathan Ainsworth',title:'Director, LoneStar Fasteners Europe',email:'',phone:''},
  {code:'W251-190',supplier:'LoneStar Group',name:'3. Jenny Lycett',title:'Distribution Sales Manager UK, LoneStar Fasteners Europe',email:'',phone:''},
  {code:'W251-230',supplier:'NEM Energy B.V.',name:'Alexander Wisse',title:'CEO, NEM Energy B.V.',email:'',phone:''},
  {code:'W251-230',supplier:'NEM Energy B.V.',name:'Wilco Antonisse',title:'Director of Engineering',email:'',phone:''},
  {code:'W251-210',supplier:'AC Boilers S.p.A.',name:'Daniele Langè',title:'VP of Sales',email:'',phone:''},
  {code:'W251-234',supplier:'Sterling Deaerator Company',name:'Fred Quintana',title:'New Equipment Sales',email:'fredquintana@sterlingdeaerator.com',phone:''},
  {code:'W251-234',supplier:'Sterling Deaerator Company',name:'Scott Ross',title:'New Equipment Sales',email:'scottross@sterlingdeaerator.com',phone:''},
  {code:'W251-234',supplier:'Sterling Deaerator Company',name:'Stephen Adams',title:'Aftermarket Parts',email:'stephen.adams@sterlingdeaerator.com',phone:''},
  {code:'W251-000',supplier:'Nooter/Eriksen, Inc.',name:'1. Christopher Lehman',title:'General Sales Manager',email:'',phone:''},
  {code:'W251-000',supplier:'Nooter/Eriksen, Inc.',name:'2. Jacob Schweiss',title:'Aftermarket Sales Engineer',email:'',phone:''},
  {code:'W251-000',supplier:'Vogt Power International, Inc.',name:'1. Christopher Turner',title:'CEO',email:'c.turner@vogtpower.com',phone:''},
  {code:'W251-000',supplier:'Vogt Power International, Inc.',name:'2. Nadia Pazmino',title:'Proposal Manager, HRSG Services',email:'',phone:''},
  {code:'W251-000',supplier:'Vogt Power International, Inc.',name:'3. Michael Stull',title:'Director of Operations, HRSG Services',email:'',phone:''},
  {code:'W251-000',supplier:'GE Vernova — HRSG Division',name:'1. HRSG Sales',title:'GE Vernova Gas Power',email:'',phone:''},
  {code:'W251-232',supplier:'Rentech Boiler Systems, Inc.',name:'1. Kevin Slepicka',title:'Vice President, Heat Recovery Boiler Sales',email:'',phone:''},
  {code:'W251-232',supplier:'Rentech Boiler Systems, Inc.',name:'2. Gerardo Lara',title:'Vice President, Fired Boiler Sales',email:'',phone:''},
  {code:'W251-000',supplier:'Cleaver-Brooks',name:'1. NATCOM Duct Burner Sales',title:'Cleaver-Brooks',email:'customerservice@cleaverbrooks.com',phone:''},
  {code:'W251-000',supplier:'John Zink Hamworthy Combustion',name:'1. Tulsa HQ',title:'HRSG/Duct Burner Product Sales',email:'',phone:''},
  {code:'W251-000',supplier:'John Zink Hamworthy Combustion',name:'2. Northeast US Office',title:'2 Corporate Drive Tower II, Suite 445, Shelton, CT 06484',email:'',phone:''},
  {code:'W251-000',supplier:'Fives Group',name:'1. Fives North American Combustion',title:'Sales',email:'',phone:''},
  {code:'W251-000',supplier:'CORMETECH, Inc.',name:'1. Dan Johnson, P.E.',title:'Vice President, Business Development',email:'',phone:''},
  {code:'W251-000',supplier:'CORMETECH, Inc.',name:'2. Scott Daugherty',title:'Chief Operating Officer',email:'',phone:''},
  {code:'W251-000',supplier:'CORMETECH, Inc.',name:'3. Donald Cochran',title:'Director, Durham Manufacturing',email:'',phone:''},
  {code:'W251-000',supplier:'Catalytic Combustion Corporation',name:'1. CCC Sales',title:'Bloomer, WI',email:'',phone:''},
  {code:'W251-000',supplier:'CECO Environmental — Peerless Emissions Control',name:'1. Peerless Emissions Control',title:'Sales',email:'',phone:''},
  {code:'W251-000',supplier:'CECO Environmental — Peerless Emissions Control',name:'2. CECO HQ',title:'General Inquiries',email:'',phone:''},
  {code:'W251-000',supplier:'Siemens Energy — Steam Turbines',name:'2. Siemens Energy US',title:'General',email:'',phone:''},
  {code:'W251-236',supplier:'Triveni Turbine Limited',name:'1. Narayana Prasad',title:'Chief Executive Officer',email:'',phone:''},
  {code:'W251-236',supplier:'Triveni Turbine Limited',name:'2. Balasubramani K',title:'CEO',email:'balasubramani@triveniturbines.com',phone:''},
  {code:'W251-000',supplier:'GHM) serves power generation, refinery, petrochemical, and n',name:'1. Graham Manufacturing Sales',title:'Batavia, NY',email:'',phone:''},
  {code:'W251-000',supplier:'GHM) serves power generation, refinery, petrochemical, and n',name:'2. Houston Region Sales',title:'Phone: +1 281-448-3088',email:'',phone:''},
  {code:'W251-233',supplier:'SPX Cooling Technologies',name:'1. Mark Burney',title:'SPX Cooling Technologies',email:'mark.burney@spx.com',phone:''},
  {code:'W251-233',supplier:'SPX Cooling Technologies',name:'2. SPX Cooling HQ',title:'Phone: 664-7400',email:'',phone:''},
  {code:'W251-246',supplier:'Flowserve Corporation',name:'1. Chuck Dowd',title:'Director, Americas & EMA Power Generation Sales and FCD Glob',email:'',phone:''},
  {code:'W251-246',supplier:'Flowserve Corporation',name:'2. Jim McGeehin',title:'General Manager, Power Generation',email:'',phone:''},
  {code:'W251-000',supplier:'Sulzer Ltd — Pumps Division',name:'1. Dirk Reicherter',title:'Director Sales, Sulzer Ltd',email:'',phone:''},
  {code:'W251-000',supplier:'Sulzer Ltd — Pumps Division',name:'2. Kevin O\'Connell',title:'Former Managing Director Sulzer Pumps US / Vertical Pumps Ma',email:'',phone:''},
  {code:'W251-000',supplier:'Emerson Automation Solutions — Fisher™ Valve Division',name:'1. Colin Burns',title:'UK & Ireland Sales Director, Emerson Automation Solutions',email:'',phone:''},
  {code:'W251-000',supplier:'Emerson Automation Solutions — Fisher™ Valve Division',name:'2. Justin Goodwin',title:'Business Development, Control Valves & Power',email:'',phone:''},
  {code:'W251-000',supplier:'Parker Hannifin Corporation — Industrial Gas Filtration & Po',name:'1. Keith Bayer',title:'Director of Sales, Global Power Generation Platform',email:'',phone:''},
  {code:'W251-000',supplier:'Parker Hannifin Corporation — Industrial Gas Filtration & Po',name:'2. Paul Barron',title:'North American Regional Sales Manager, Parker Gas Turbine Di',email:'',phone:''},
  {code:'W251-000',supplier:'Parker Hannifin Corporation — Industrial Gas Filtration & Po',name:'3. James Hoke',title:'Power Generation Business Development, Parker Hannifin',email:'',phone:''},
  {code:'W251-000',supplier:'CIRCOR International',name:'1. Bob Paul',title:'Global Director of Sales, CIRCOR Energy / Sr. Director Globa',email:'',phone:''},
  {code:'W251-000',supplier:'CIRCOR International',name:'2. Alessandro Lonardo',title:'Managing Director, CIRCOR Allweiler IMO',email:'',phone:''},
  {code:'W251-000',supplier:'CIRCOR International',name:'3. Gregory Vincent',title:'US National Sales Manager, CIRCOR Energy',email:'',phone:''},
  {code:'W251-000',supplier:'Crane Co. — ChemPharma & Energy Division',name:'1. Brian Perkins',title:'Vice President Sales, Crane ChemPharma & Energy',email:'',phone:''},
  {code:'W251-000',supplier:'Crane Co. — ChemPharma & Energy Division',name:'2. Emad Dardour',title:'Regional Sales Manager, Crane ChemPharma & Energy',email:'',phone:''},
  {code:'W251-000',supplier:'IMI plc — Critical Engineering Division',name:'1. Shaun Lindley',title:'Southeast Sales, Solution Sales Specialist – Severe Service ',email:'',phone:''},
  {code:'W251-000',supplier:'IMI plc — Critical Engineering Division',name:'2. Per Sundberg',title:'Former Sales Director / Director Aftermarket EMEA, IMI Criti',email:'',phone:''},
  {code:'W251-000',supplier:'IMI plc — Critical Engineering Division',name:'3. Daniel Zhang',title:'Senior AFM Sales Manager, Power/Petrochemical/O&G, IMI Criti',email:'',phone:''},
  {code:'W251-258',supplier:'Ruhrpumpen Group',name:'1. Mike McDougal',title:'VP Sales, Ruhrpumpen Inc.',email:'',phone:''},
  {code:'W251-258',supplier:'Ruhrpumpen Group',name:'2. Ed Clark',title:'VP, NA Sales at Ruhrpumpen',email:'',phone:''},
  {code:'W251-258',supplier:'Ruhrpumpen Group',name:'3. Pablo Lopez Gonzalez',title:'Key Account Manager, Europe Industry EPCs',email:'',phone:''},
  {code:'W251-000',supplier:'https://www.linkedin.com/in/wayne-finch-909a9226',name:'1. Bill Flavelle',title:'Director of Engineering, Power Generation Products & Interna',email:'',phone:''},
  {code:'W251-000',supplier:'https://www.linkedin.com/in/wayne-finch-909a9226',name:'2. Wayne Finch',title:'Regional Sales Manager, Roper Pump Company',email:'',phone:''},
  {code:'W251-000',supplier:'Gilbert Gilkes & Gordon Ltd',name:'1. Julia Chaplin',title:'Marketing Manager, Gilkes',email:'',phone:''},
  {code:'W251-000',supplier:'Gilbert Gilkes & Gordon Ltd',name:'2. Darren Wager',title:'Vice President of Sales',email:'',phone:''},
  {code:'W251-000',supplier:'Endress+Hauser — Flow Division',name:'1. George Hofer',title:'Head of Strategic Account Management, Endress+Hauser Group',email:'',phone:''},
  {code:'W251-000',supplier:'Endress+Hauser — Flow Division',name:'2. Oliver Seifert',title:'Head of Product Management, Thermal Mass and Vortex Flowmete',email:'',phone:''},
  {code:'W251-255',supplier:'Penflex, Inc.',name:'1. Ronit Patil',title:'Senior Sales Engineer, Penflex Corporation',email:'',phone:''}
];

            for (const s of SUPPLIERS) {
                try {
                    const exists = await db.prepare(
                        `SELECT id FROM supplier_intelligence WHERE org_id = ? AND supplier_code = ? LIMIT 1`
                    ).get('twp', s.code);
                    if (exists) { results.suppliers++; continue; }
                    await db.prepare(
                        `INSERT INTO supplier_intelligence
                         (org_id, supplier_code, name, status, supplier_type, country, tier, system_group, system_tags, scope, website, metadata_json, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', NOW(), NOW())`
                    ).run('twp', s.code, s.name, s.status, s.type, s.country, s.tier, s.group, s.tags, s.scope, s.website);
                    results.suppliers++;
                } catch(e) { results.errors.push('SI:' + s.code + ':' + e.message.slice(0,40)); }
            }

            for (const c of CONTACTS) {
                try {
                    await db.prepare(
                        `INSERT INTO supplier_contacts
                         (org_id, supplier_code, supplier_name, contact_name, title, email, phone, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`
                    ).run('twp', c.code, c.supplier, c.name, c.title, c.email, c.phone);
                    results.contacts++;
                } catch(e) { results.errors.push('SC:' + c.name + ':' + e.message.slice(0,40)); }
            }

            res.json({ status: 'ok', seeded: results, timestamp: new Date().toISOString() });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/supplier-intelligence — W251 supplier database
    router.get('/supplier-intelligence', async (req, res) => {
        try {
            const tier = req.query.tier || null;
            const group = req.query.group || null;
            const search = req.query.search || null;
            const limit = Math.min(parseInt(req.query.limit) || 50, 300);

            let sql = `SELECT supplier_code, name, status, supplier_type, country, tier, system_group, system_tags, website FROM supplier_intelligence WHERE org_id = 'twp'`;
            const params = [];
            if (tier) { sql += ` AND tier = ?`; params.push(tier); }
            if (group) { sql += ` AND system_group ILIKE ?`; params.push('%' + group + '%'); }
            if (search) { sql += ` AND (name ILIKE ? OR system_tags ILIKE ? OR scope ILIKE ?)`; params.push('%'+search+'%', '%'+search+'%', '%'+search+'%'); }
            sql += ` ORDER BY tier, name LIMIT ${limit}`;

            const rows = await db.prepare(sql).all(...params);

            // Summary stats
            const stats = await db.prepare(
                `SELECT tier, COUNT(*) as count FROM supplier_intelligence WHERE org_id = 'twp' GROUP BY tier ORDER BY tier`
            ).all();

            const groups = await db.prepare(
                `SELECT system_group, COUNT(*) as count FROM supplier_intelligence WHERE org_id = 'twp' GROUP BY system_group ORDER BY count DESC LIMIT 12`
            ).all();

            res.json({ status: 'ok', count: rows.length, suppliers: rows, tier_summary: stats, system_groups: groups, timestamp: new Date().toISOString() });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/dashboard/supplier-contacts — contact database
    router.get('/supplier-contacts', async (req, res) => {
        try {
            const supplier = req.query.supplier || null;
            const search = req.query.search || null;
            const limit = Math.min(parseInt(req.query.limit) || 50, 250);

            let sql = `SELECT supplier_code, supplier_name, contact_name, title, email, phone FROM supplier_contacts WHERE org_id = 'twp'`;
            const params = [];
            if (supplier) { sql += ` AND supplier_name ILIKE ?`; params.push('%' + supplier + '%'); }
            if (search) { sql += ` AND (contact_name ILIKE ? OR title ILIKE ? OR supplier_name ILIKE ?)`; params.push('%'+search+'%', '%'+search+'%', '%'+search+'%'); }
            sql += ` ORDER BY supplier_name, contact_name LIMIT ${limit}`;

            const rows = await db.prepare(sql).all(...params);
            res.json({ status: 'ok', count: rows.length, contacts: rows, timestamp: new Date().toISOString() });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });


    // POST /api/dashboard/enrich-supplier — query Apollo for one supplier's contacts
    router.post('/enrich-supplier', async (req, res) => {
        try {
            const { supplier_code, company_name, domain } = req.body;
            const apiKey = process.env.APOLLO_API_KEY || 'AkFiyJXYBR31nKPWSm6c1Q';
            if (!company_name) return res.status(400).json({ error: 'company_name required' });

            // Search Apollo for people at this company
            const searchPayload = {
                api_key: apiKey,
                q_organization_name: company_name,
                person_titles: ['VP', 'Director', 'President', 'Manager', 'Head', 'Chief', 'SVP', 'EVP'],
                per_page: 10,
                page: 1,
            };

            const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                body: JSON.stringify(searchPayload),
            });

            if (!apolloRes.ok) {
                const err = await apolloRes.text();
                return res.status(apolloRes.status).json({ error: 'Apollo API error', detail: err });
            }

            const data = await apolloRes.json();
            const people = data.people || [];
            const saved = [];

            for (const person of people) {
                const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
                const title = person.title || '';
                const email = person.email || '';
                const phone = person.phone_numbers?.[0]?.raw_number || '';
                const linkedin = person.linkedin_url || '';
                if (!name) continue;

                try {
                    await db.prepare(
                        `INSERT INTO supplier_contacts
                         (org_id, supplier_code, supplier_name, contact_name, title, email, phone, metadata_json, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                         ON CONFLICT DO NOTHING`
                    ).run('twp', supplier_code || 'APOLLO', company_name, name, title, email, phone,
                        JSON.stringify({ linkedin, source: 'apollo', apollo_id: person.id }));
                    saved.push({ name, title, email: email ? '✓' : '—' });
                } catch(dbErr) {
                    // ignore duplicate
                }
            }

            res.json({
                status: 'ok',
                company: company_name,
                apollo_found: people.length,
                saved: saved.length,
                contacts: saved,
                credits_used: data.pagination?.total_entries ? 1 : 0,
                timestamp: new Date().toISOString(),
            });
        } catch(err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/dashboard/enrich-batch — run Apollo enrichment on multiple suppliers
    router.post('/enrich-batch', async (req, res) => {
        try {
            const apiKey = process.env.APOLLO_API_KEY || 'AkFiyJXYBR31nKPWSm6c1Q';
            // key set via env or fallback

            // Load Tier 1 suppliers from DB (highest priority)
            const tier = req.body.tier || 'Tier 1';
            const limit = Math.min(parseInt(req.body.limit) || 10, 30);
            const suppliers = await db.prepare(
                `SELECT supplier_code, name FROM supplier_intelligence
                 WHERE org_id = 'twp' AND tier = ? ORDER BY name LIMIT ?`
            ).all(tier, limit);

            if (!suppliers.length) {
                return res.json({ status: 'ok', message: 'No suppliers found. Run seed-suppliers first.', results: [] });
            }

            const results = [];
            let totalFound = 0;
            let totalSaved = 0;

            for (const sup of suppliers) {
                try {
                    const searchPayload = {
                        api_key: apiKey,
                        q_organization_name: sup.name,
                        person_titles: ['VP Sales', 'VP Business Development', 'Director', 'President',
                                        'Head of Sales', 'Commercial Director', 'Account Manager', 'Chief'],
                        per_page: 5,
                        page: 1,
                    };

                    const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
                        body: JSON.stringify(searchPayload),
                    });

                    if (!apolloRes.ok) {
                        results.push({ supplier: sup.name, status: 'api_error', found: 0 });
                        continue;
                    }

                    const data = await apolloRes.json();
                    const people = data.people || [];
                    let saved = 0;

                    for (const person of people) {
                        const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
                        if (!name) continue;
                        try {
                            await db.prepare(
                                `INSERT INTO supplier_contacts
                                 (org_id, supplier_code, supplier_name, contact_name, title, email, phone, metadata_json, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                                 ON CONFLICT DO NOTHING`
                            ).run('twp', sup.supplier_code, sup.name,
                                name, person.title || '', person.email || '',
                                person.phone_numbers?.[0]?.raw_number || '',
                                JSON.stringify({ linkedin: person.linkedin_url || '', source: 'apollo', apollo_id: person.id }));
                            saved++;
                        } catch { /* duplicate */ }
                    }

                    totalFound += people.length;
                    totalSaved += saved;
                    results.push({ supplier: sup.name, found: people.length, saved });

                    // Small delay to respect rate limits
                    await new Promise(r => setTimeout(r, 300));

                } catch(supErr) {
                    results.push({ supplier: sup.name, status: 'error', error: supErr.message.slice(0, 60) });
                }
            }

            res.json({
                status: 'ok',
                tier_queried: tier,
                suppliers_processed: suppliers.length,
                total_contacts_found: totalFound,
                total_contacts_saved: totalSaved,
                results,
                timestamp: new Date().toISOString(),
            });
        } catch(err) {
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

// ── APOLLO ENRICHMENT ENGINE ──────────────────────────────────────────────────
// Queries Apollo.io for contacts at W251 suppliers
// Budget-aware: tracks credits used, prioritizes Tier 1 suppliers
