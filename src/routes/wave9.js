'use strict';
/**
 * Wave 9 — Contact Intelligence Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes the existing W251 supplier contacts from migration 024 and
 * prepares the contact intelligence pipeline for Apollo Basic activation.
 *
 * Routes:
 *   GET  /api/wave9/status           — readiness state + counts
 *   GET  /api/wave9/contacts         — paginated contact list
 *   GET  /api/wave9/contacts/:id     — single contact detail
 *   POST /api/wave9/contacts/:id/tag — tag contact with bop_category
 */

const express = require('express');
const { discoveryEnvelope, OUTPUT_TYPES, FRESHNESS } = require('../common/intelligence-envelope');
const { DISCOVERED_SUPPLIERS } = require('./discovery');

function createWave9Routes(db, opts = {}) {
    const router = express.Router();

    // ─── STATUS ──────────────────────────────────────────────────────────────
    router.get('/status', async (req, res) => {
        const counts = { total: 0, with_email: 0, with_title: 0, tagged: 0, untagged: 0 };
        if (db) {
            try {
                // Use only columns from migration 024 (guaranteed present)
                // bop_category/seniority/currency_status added by 028 — check if they exist
                const r = await db.prepare(`
                    SELECT
                        COUNT(*) as total,
                        COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '') as with_email,
                        COUNT(title) FILTER (WHERE title IS NOT NULL AND title != '') as with_title
                    FROM supplier_contacts
                `).get();
                counts.total      = parseInt(r?.total     || 0);
                counts.with_email = parseInt(r?.with_email || 0);
                counts.with_title = parseInt(r?.with_title || 0);

                // Try bop_category columns separately — may not exist yet
                try {
                    const r2 = await db.prepare(`
                        SELECT
                            COUNT(bop_category) FILTER (WHERE bop_category IS NOT NULL) as tagged,
                            COUNT(*) FILTER (WHERE bop_category IS NULL) as untagged
                        FROM supplier_contacts
                    `).get();
                    counts.tagged   = parseInt(r2?.tagged   || 0);
                    counts.untagged = parseInt(r2?.untagged || 0);
                } catch { counts.tagged = 0; counts.untagged = counts.total; }
            } catch (e) { counts.error = e.message; }
        }

        res.json({
            ...discoveryEnvelope({
                mod: 'wave9_status',
                outputType: OUTPUT_TYPES.DERIVED,
                freshness: FRESHNESS.CACHED,
                sourceSummary: 'Live DB contact counts',
                data: {}
            }),
            wave: 'Wave 9 — Contact Intelligence',
            status: counts.total > 0 ? 'contacts_available' : 'empty',
            contacts: counts,
            suppliers_in_memory: DISCOVERED_SUPPLIERS.length,
            apollo_upgrade_required: !process.env.APOLLO_API_KEY,
            activation_path: [
                '1. Upgrade Apollo to Basic ($49/mo)',
                '2. POST /api/wave9/enrich — runs Apollo people search across T1 suppliers',
                '3. GET /api/wave9/contacts — browse enriched exec contacts',
                '4. POST /api/wave9/contacts/:id/rfq — trigger Claude RFQ draft for contact'
            ],
            note: counts.total > 0
                ? `${counts.total} contacts loaded from W251 supplier intelligence (migration 024). Use tag endpoint to assign BOP categories.`
                : 'No contacts yet. Activate Apollo Basic to populate.'
        });
    });

    // ─── LIST CONTACTS ────────────────────────────────────────────────────────
    router.get('/contacts', async (req, res) => {
        const page     = Math.max(1, parseInt(req.query.page)  || 1);
        const limit    = Math.min(50, parseInt(req.query.limit) || 20);
        const offset   = (page - 1) * limit;
        const category = req.query.category || null;
        const search   = req.query.q || null;

        let contacts = [], total = 0;
        if (db) {
            try {
                // Build type-cast where clause — PG requires explicit casts for ILIKE
                let where = 'WHERE 1=1';
                const params = [];
                if (category) { params.push(category); where += ` AND bop_category = $${params.length}::text`; }
                if (search) {
                    params.push(`%${search}%`);
                    const si = params.length;
                    where += ` AND (supplier_name ILIKE $${si}::text OR contact_name ILIKE $${si}::text OR title ILIKE $${si}::text)`;
                }

                const countRow = await db.prepare(`SELECT COUNT(*) as n FROM supplier_contacts ${where}`).get(...params);
                total = parseInt(countRow?.n || 0);

                params.push(limit, offset);
                contacts = await db.prepare(`
                    SELECT id, supplier_name, contact_name, title, email, phone, created_at
                    FROM supplier_contacts ${where}
                    ORDER BY supplier_name, title
                    LIMIT $${params.length-1} OFFSET $${params.length}
                `).all(...params);
            } catch (e) {
                return res.status(500).json({ error: e.message });
            }
        }

        res.json({
            ...discoveryEnvelope({
                mod: 'contact_list',
                outputType: OUTPUT_TYPES.CACHED,
                freshness: FRESHNESS.CACHED,
                sourceSummary: `DB contacts — ${total} total`,
                data: {}
            }),
            contacts,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            filters: { category, search }
        });
    });

    // ─── CONTACTS BY CATEGORY ────────────────────────────────────────────────
    router.get('/contacts/by-category', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            const rows = await db.prepare(`
                SELECT bop_category, COUNT(*) as contacts,
                       COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '') as with_email
                FROM supplier_contacts
                WHERE bop_category IS NOT NULL
                GROUP BY bop_category
                ORDER BY contacts DESC
            `).all();
            res.json({
                ok: true, total_tagged: rows.reduce((s,r)=>s+parseInt(r.contacts),0),
                categories: rows.map(r => ({ category: r.bop_category, contacts: parseInt(r.contacts), with_email: parseInt(r.with_email||0) }))
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── SINGLE CONTACT ───────────────────────────────────────────────────────
    router.get('/contacts/:id', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            const contact = await db.prepare(
                `SELECT * FROM supplier_contacts WHERE id = $1`
            ).get(parseInt(req.params.id));
            if (!contact) return res.status(404).json({ error: 'Contact not found' });
            res.json({ ...discoveryEnvelope({ mod: 'contact_detail', outputType: OUTPUT_TYPES.CACHED, freshness: FRESHNESS.CACHED, sourceSummary: 'DB contact record', data: {} }), contact });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── TAG CONTACT ──────────────────────────────────────────────────────────
    router.post('/contacts/:id/tag', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        const { bop_category, seniority } = req.body || {};
        if (!bop_category) return res.status(400).json({ error: 'bop_category required' });
        try {
            await db.prepare(
                `UPDATE supplier_contacts SET bop_category=$1, seniority=$2 WHERE id=$3`
            ).run(bop_category, seniority || null, parseInt(req.params.id));
            res.json({ ok: true, id: parseInt(req.params.id), bop_category, seniority });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });


    // ─── AUTO-TAG CONTACTS ────────────────────────────────────────────────────
    // Matches W251 supplier_contacts to BOP categories via supplier name lookup

    // GET trigger — browser/tool accessible
    router.get('/run-auto-tag', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            // Ensure columns exist (migration 028 may have failed silently)
            try { await db.prepare(`ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS bop_category TEXT`).run(); } catch {}
            try { await db.prepare(`ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS seniority TEXT`).run(); } catch {}

            // ── Tier-1: exact/near-exact from discovery data ──────────────────
            const nameMap = {};
            DISCOVERED_SUPPLIERS.forEach(s => {
                const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                nameMap[key] = s.bop_category;
                if (s.domain) { const d = s.domain.split('.')[0].toLowerCase(); if (!nameMap[d]) nameMap[d] = s.bop_category; }
            });

            // ── Tier-2: keyword→category map for W251 supplier name formats ──
            // W251 contacts use sub-brand names (e.g. "ABB — Electrification Division")
            // This map catches them by brand keyword present in supplier_name
            const keywordMap = [
                // Reduction Gearbox
                ['flender',         'Reduction_Gearbox'],
                ['renk',            'Reduction_Gearbox'],
                ['rexnord',         'Reduction_Gearbox'],
                ['kopflex',         'Reduction_Gearbox'],
                // Starting Package
                ['voith',           'Starting_Package'],
                ['piller',          'Starting_Package'],
                // Lube Oil System
                ['alfa laval',      'Lube_Oil_System'],
                ['alfalaval',       'Lube_Oil_System'],
                ['mds',             'Lube_Oil_System'],
                // Fuel Gas System
                ['krohne',          'Fuel_Gas_System'],
                ['emerson fisher',  'Fuel_Gas_System'],
                ['fisher controls', 'Fuel_Gas_System'],
                // Compressor Washing
                ['turbotect',       'Compressor_Washing'],
                // Inlet Air Filtering
                ['donaldson',       'Inlet_Air_Filtering'],
                ['camfil',          'Inlet_Air_Filtering'],
                ['aaf',             'Inlet_Air_Filtering'],
                // Exhaust System
                ['g+h',             'Exhaust_System'],
                ['svi',             'Exhaust_System'],
                ['bremco',          'Exhaust_System'],
                // Water Injection
                ['veolia',          'Water_Injection'],
                ['petrotech',       'Water_Injection'],
                // Black Start
                ['caterpillar',     'Black_Start_Equipment'],
                ['cat power',       'Black_Start_Equipment'],
                ['cummins',         'Black_Start_Equipment'],
                // MV System
                ['abb',             'MV_System'],
                ['schneider electric','MV_System'],
                ['eaton',           'MV_System'],
                // DC Battery
                ['saft',            'DC_Battery_System'],
                ['enersys',         'DC_Battery_System'],
                ['northstar battery','DC_Battery_System'],
                ['exide',           'DC_Battery_System'],
                // LV MCC System
                ['siemens',         'LV_MCC_System'],
                ['schneider',       'LV_MCC_System'],
                // Fire Fighting
                ['marioff',         'Fire_Fighting'],
                ['fike',            'Fire_Fighting'],
                ['ansul',           'Fire_Fighting'],
                ['amerex',          'Fire_Fighting'],
                ['kidde',           'Fire_Fighting'],
                ['tyco',            'Fire_Fighting'],
                ['protectowire',    'Fire_Fighting'],
                ['hochiki',         'Fire_Fighting'],
                // Gas Detection
                ['msa safety',      'Gas_Detection'],
                ['msa ',            'Gas_Detection'],
                ['dräger',          'Gas_Detection'],
                ['drager',          'Gas_Detection'],
                ['draeger',         'Gas_Detection'],
                ['honeywell analytics','Gas_Detection'],
                ['gas detection',   'Gas_Detection'],
                // Vibration Monitoring
                ['bently nevada',   'Vibration_Monitoring'],
                ['bently',          'Vibration_Monitoring'],
                ['baker hughes',    'Vibration_Monitoring'],
                ['skf',             'Vibration_Monitoring'],
                // Coupling Joints
                ['vulkan',          'Coupling_Joints'],
                ['ringfeder',       'Coupling_Joints'],
                ['ameridrives',     'Coupling_Joints'],
                ['jaure',           'Coupling_Joints'],
                // Enclosures
                ['faist',           'Enclosures'],
                ['iac acoustics',   'Enclosures'],
                ['acoustic',        'Enclosures'],
                // Cooling Water
                ['kelvion',         'Cooling_Water'],
                ['cockerill',       'Cooling_Water'],
                ['harsco',          'Cooling_Water'],
                // Piping Valves
                ['flowserve',       'Piping_Valves'],
                ['velan',           'Piping_Valves'],
                ['circor',          'Piping_Valves'],
                ['trillium',        'Piping_Valves'],
            ];

            const contacts = await db.prepare(`SELECT id, supplier_name FROM supplier_contacts`).all();
            let tagged = 0, skipped = 0, alreadyTagged = 0;
            for (const c of contacts) {
                const raw  = (c.supplier_name || '').toLowerCase();
                const key  = raw.replace(/[^a-z0-9]/g, '');
                let category = nameMap[key];

                // Tier-1 partial match on discovery names
                if (!category) {
                    for (const [k, cat] of Object.entries(nameMap)) {
                        if (k.length > 4 && key.includes(k)) { category = cat; break; }
                    }
                }

                // Tier-2 keyword map on raw name
                if (!category) {
                    for (const [kw, cat] of keywordMap) {
                        if (raw.includes(kw.toLowerCase())) { category = cat; break; }
                    }
                }

                if (category) {
                    try { await db.prepare(`UPDATE supplier_contacts SET bop_category=$1 WHERE id=$2`).run(category, c.id); tagged++; }
                    catch {}
                } else skipped++;
            }
            res.json({ ok: true, total: contacts.length, tagged, skipped,
                note: `${tagged} tagged across BOP categories. ${skipped} unmatched (likely GT OEM / HRSG / non-BOP suppliers).` });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/auto-tag', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            // Build supplier name → bop_category map from in-memory discovery data
            const nameMap = {};
            DISCOVERED_SUPPLIERS.forEach(s => {
                const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                nameMap[key] = s.bop_category;
                // Also map by domain keyword
                if (s.domain) {
                    const domain = s.domain.split('.')[0].toLowerCase();
                    if (!nameMap[domain]) nameMap[domain] = s.bop_category;
                }
            });

            // Fetch all untagged contacts
            const contacts = await db.prepare(
                `SELECT id, supplier_name FROM supplier_contacts`
            ).all();

            let tagged = 0, skipped = 0;
            for (const c of contacts) {
                const key = (c.supplier_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                // Try full name match first
                let category = nameMap[key];
                // Try partial match — check if any BOP supplier name appears in the contact's supplier name
                if (!category) {
                    for (const [k, cat] of Object.entries(nameMap)) {
                        if (k.length > 4 && key.includes(k)) { category = cat; break; }
                    }
                }
                if (category) {
                    try {
                        await db.prepare(`UPDATE supplier_contacts SET bop_category=$1 WHERE id=$2`)
                            .run(category, c.id);
                        tagged++;
                    } catch {}
                } else skipped++;
            }

            res.json({
                ok: true, total: contacts.length, tagged, skipped,
                note: `Tagged ${tagged} contacts with BOP categories from in-memory discovery data. ${skipped} could not be matched.`
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── RFQ PER CONTACT ─────────────────────────────────────────────────────
    // Drafts a Claude RFQ email for a specific contact
    router.post('/contacts/:id/rfq', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
        if (!hasClaudeKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY required', hint: 'Add key to Vercel env vars' });

        try {
            const contact = await db.prepare(`SELECT * FROM supplier_contacts WHERE id=$1`).get(parseInt(req.params.id));
            if (!contact) return res.status(404).json({ error: 'Contact not found' });

            const { project_name = 'Project Jupiter — TG20B7-8 W251 Power Island', delivery_location = 'Santa Teresa, New Mexico, USA' } = req.body || {};
            const category = contact.bop_category || req.body?.bop_category || 'BOP Equipment';
            const pricingRecord = await db.prepare(`SELECT * FROM market_pricing WHERE bop_category=$1 ORDER BY price_mid_usd DESC LIMIT 1`).get(category).catch(() => null);

            const claude = require('../services/claude');
            const result = await claude.draftRFQ({
                supplierName: contact.supplier_name,
                contactName: contact.contact_name,
                contactTitle: contact.title,
                partDescription: category.replace(/_/g, ' '),
                bopCategory: category,
                priceMid: pricingRecord?.price_mid_usd || null,
                deliveryLocation: delivery_location,
                projectName: project_name
            });

            const { createClaudeRoutes } = require('./claude-intelligence');
            // Persist via direct DB insert
            try {
                await db.prepare(`INSERT INTO claude_results (analysis_type,subject_name,content,input_tokens,output_tokens,model_cost_usd,model,triggered_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`)
                    .run('rfq_draft', `RFQ: ${contact.supplier_name} — ${category}`, result.content, result.usage?.input_tokens||0, result.usage?.output_tokens||0, claude.estimateCost(result.usage), result.model, 'wave9_contact_rfq');
            } catch {}

            res.json({
                _envelope: { contract_version: '1.0', engine: 'Claude Intelligence Engine', module: 'contact_rfq', timestamp: new Date().toISOString(), freshness: 'live', output_type: 'generated_draft', source_summary: `Claude ${result.model} — contact RFQ draft`, readiness: 'operational', error: null },
                ok: true, contact_id: contact.id,
                supplier: contact.supplier_name, contact: contact.contact_name, title: contact.title,
                bop_category: category, rfq: result.content,
                cost_usd: claude.estimateCost(result.usage), model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── OUTREACH READINESS ───────────────────────────────────────────────────
    // Returns actionable contacts (have email + BOP category) grouped by category
    router.get('/outreach-readiness', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            const data = await getOutreachReadiness(db);
            const total_actionable = (data?.by_category || []).reduce((s,r) => s + parseInt(r.actionable||0), 0);
            res.json({
                ok: true, total_actionable,
                note: `${total_actionable} contacts have both email + BOP category — ready for Claude RFQ drafting`,
                by_category: data?.by_category || [],
                top_contacts: data?.actionable_contacts || []
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
}

module.exports = { createWave9Routes };

// ─── OUTREACH READINESS — exported for dashboard / status ────────────────────
async function getOutreachReadiness(db) {
    if (!db) return null;
    try {
        const byCategory = await db.prepare(`
            SELECT bop_category,
                   COUNT(*) as contacts,
                   COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '') as actionable
            FROM supplier_contacts
            WHERE bop_category IS NOT NULL
            GROUP BY bop_category ORDER BY actionable DESC, contacts DESC
        `).all();
        const topContacts = await db.prepare(`
            SELECT sc.id, sc.supplier_name, sc.contact_name, sc.title, sc.email, sc.bop_category
            FROM supplier_contacts sc
            WHERE sc.email IS NOT NULL AND sc.email != '' AND sc.bop_category IS NOT NULL
            ORDER BY sc.bop_category, sc.supplier_name LIMIT 20
        `).all();
        return { by_category: byCategory, actionable_contacts: topContacts };
    } catch { return null; }
}
module.exports.getOutreachReadiness = getOutreachReadiness;
