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
                    const approvedBy = a.status === 'APPROVED' ? 'gbuchanan' : null;
                    await db.prepare(
                        `INSERT INTO approval_requests
                         (org_id, target_type, target_id, action_key, request_status, approval_mode,
                          risk_level, requested_by_user_id, approved_by_user_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL '${daysAgo} days', NOW())`
                    ).run('twp', 'supply_chain_entity',
                        'tg20-' + Math.random().toString(36).slice(2, 8),
                        a.action_key, a.status,
                        a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE',
                        a.risk_level, a.user, approvedBy);
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
