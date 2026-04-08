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

                // Try extended columns (added by migration 028 or auto-tag)
                try {
                    const r2 = await db.prepare(`
                        SELECT
                            COUNT(bop_category) FILTER (WHERE bop_category IS NOT NULL) as tagged,
                            COUNT(*) FILTER (WHERE bop_category IS NULL) as untagged,
                            COUNT(*) FILTER (WHERE seniority = 'c_suite') as c_suite,
                            COUNT(*) FILTER (WHERE seniority = 'vp') as vp,
                            COUNT(*) FILTER (WHERE seniority = 'director') as director
                        FROM supplier_contacts
                    `).get();
                    counts.tagged   = parseInt(r2?.tagged   || 0);
                    counts.untagged = parseInt(r2?.untagged || 0);
                    counts.c_suite  = parseInt(r2?.c_suite  || 0);
                    counts.vp       = parseInt(r2?.vp       || 0);
                    counts.director = parseInt(r2?.director || 0);
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

    // ─── CONTACTS BY SENIORITY ───────────────────────────────────────────────
    router.get('/contacts/by-seniority', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            const rows = await db.prepare(`
                SELECT seniority,
                       COUNT(*)::int as contacts,
                       COUNT(email) FILTER (WHERE email IS NOT NULL AND email != '')::int as with_email,
                       COUNT(bop_category) FILTER (WHERE bop_category IS NOT NULL)::int as bop_tagged
                FROM supplier_contacts
                WHERE seniority IS NOT NULL
                GROUP BY seniority ORDER BY contacts DESC
            `).all();
            const safe = v => parseInt(v||0)||0;
            const total = rows.reduce((s,r)=>s+safe(r.contacts),0);
            res.json({ ok: true, total_classified: total,
                by_seniority: rows.map(r=>({ seniority: r.seniority, contacts: safe(r.contacts), with_email: safe(r.with_email), bop_tagged: safe(r.bop_tagged) })) });
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
            // ── Seniority pass on all contacts ──────────────────────────────
            try { await db.prepare(`ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS seniority TEXT`).run(); } catch {}
            const allContacts2 = await db.prepare(`SELECT id, title FROM supplier_contacts`).all();
            let senioritySet = 0;
            for (const c of allContacts2) {
                const t = (c.title || '').toLowerCase();
                let seniority = null;
                if (/\bchief\b|\bceo\b|\bcto\b|\bcoo\b|\bcfo\b|\bchairman\b|\bpresident\b|\bmanaging director\b|\bmd\b/.test(t)) seniority = 'c_suite';
                else if (/\bvp\b|\bvice president\b|\bsvp\b|\bevp\b/.test(t)) seniority = 'vp';
                else if (/\bdirector\b/.test(t)) seniority = 'director';
                else if (/\bmanager\b|\bhead of\b|\blead\b/.test(t)) seniority = 'manager';
                else if (t.length > 3) seniority = 'staff';
                if (seniority) {
                    try { await db.prepare(`UPDATE supplier_contacts SET seniority=$1 WHERE id=$2`).run(seniority, c.id); senioritySet++; }
                    catch {}
                }
            }

            res.json({ ok: true, total: contacts.length, tagged, skipped, seniority_classified: senioritySet,
                note: `${tagged} tagged across BOP categories. ${senioritySet} contacts classified by seniority. ${skipped} unmatched (likely GT OEM / HRSG / non-BOP suppliers).` });
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

            // Store in contact_outreach pipeline
            await ensureOutreachTable();
            let outreach_id = null;
            try {
                const outrow = await db.prepare(`
                    INSERT INTO contact_outreach (contact_id, supplier_name, outreach_type, status, rfq_category, rfq_content, created_at)
                    VALUES ($1,$2,'rfq','draft',$3,$4,NOW()) RETURNING id
                `).get(contact.id, contact.supplier_name, category, result.content);
                outreach_id = outrow?.id;
            } catch {}

            res.json({
                _envelope: { contract_version: '1.0', engine: 'Claude Intelligence Engine', module: 'contact_rfq', timestamp: new Date().toISOString(), freshness: 'live', output_type: 'generated_draft', source_summary: `Claude ${result.model} — contact RFQ draft`, readiness: 'operational', error: null },
                ok: true, contact_id: contact.id, outreach_id,
                supplier: contact.supplier_name, contact: contact.contact_name, title: contact.title,
                bop_category: category, rfq: result.content,
                cost_usd: claude.estimateCost(result.usage), model: result.model,
                note: outreach_id ? `RFQ stored in contact_outreach (id: ${outreach_id}). Mark as sent via POST /api/wave9/outreach/${outreach_id}/send` : 'RFQ generated (outreach storage failed)'
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });


    // ─── RFQ QUEUE ───────────────────────────────────────────────────────────────
    // Returns BOP-tagged C-Suite/VP contacts with email, enriched with pricing context
    router.get('/rfq-queue', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        await ensureOutreachTable();
        try {
            const contacts = await db.prepare(`
                SELECT sc.id, sc.supplier_name, sc.contact_name, sc.title,
                       sc.email, sc.bop_category, sc.seniority,
                       co.id as outreach_id, co.status as outreach_status
                FROM supplier_contacts sc
                LEFT JOIN contact_outreach co ON co.contact_id = sc.id
                WHERE sc.seniority IN ('c_suite','vp')
                  AND sc.email IS NOT NULL AND sc.email != ''
                  AND sc.bop_category IS NOT NULL
                ORDER BY
                    CASE WHEN co.id IS NULL THEN 0 ELSE 1 END,
                    CASE sc.seniority WHEN 'c_suite' THEN 1 ELSE 2 END,
                    sc.supplier_name
            `).all();

            // Enrich with pricing midpoints per category
            const pricing = await db.prepare(`
                SELECT bop_category, SUM(price_mid_usd) as category_mid
                FROM market_pricing GROUP BY bop_category
            `).all();
            const pricingMap = {};
            pricing.forEach(p => { pricingMap[p.bop_category] = parseFloat(p.category_mid||0); });

            const queue = contacts.map(c => ({
                id: c.id, supplier_name: c.supplier_name, contact_name: c.contact_name,
                title: c.title, email: c.email, bop_category: c.bop_category, seniority: c.seniority,
                category_mid_usd: pricingMap[c.bop_category] || 0,
                rfq_status: c.outreach_id ? (c.outreach_status || 'drafted') : 'not_started',
                outreach_id: c.outreach_id || null,
                action: c.outreach_id ? `POST /api/wave9/outreach/${c.outreach_id}/send` : `POST /api/wave9/contacts/${c.id}/rfq`
            }));

            const not_started = queue.filter(q => q.rfq_status === 'not_started').length;
            res.json({
                ok: true, total: queue.length,
                not_started, drafted: queue.filter(q=>q.rfq_status==='draft').length,
                sent: queue.filter(q=>q.rfq_status==='sent').length,
                next: queue.find(q => q.rfq_status === 'not_started') || null,
                queue
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── PIPELINE SUMMARY ────────────────────────────────────────────────────────
    // Single-call procurement pipeline state — contacts + outreach + seniority
    router.get('/pipeline', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        await ensureOutreachTable();
        try {
            const [contactStats, outreachStats, topTargets] = await Promise.all([
                db.prepare(`
                    SELECT
                        COUNT(*)::int                                                       as total,
                        COUNT(bop_category) FILTER (WHERE bop_category IS NOT NULL)::int   as bop_tagged,
                        COUNT(email)        FILTER (WHERE email IS NOT NULL AND email!='')::int as with_email,
                        COUNT(*) FILTER (WHERE seniority='c_suite')::int                   as c_suite,
                        COUNT(*) FILTER (WHERE seniority='vp')::int                        as vp,
                        COUNT(*) FILTER (WHERE seniority IN ('c_suite','vp') AND email IS NOT NULL AND email!='')::int as priority_targets
                    FROM supplier_contacts
                `).get(),
                db.prepare(`
                    SELECT
                        COUNT(*)::int                                       as total,
                        COUNT(*) FILTER (WHERE status='draft')::int        as draft,
                        COUNT(*) FILTER (WHERE status='sent')::int         as sent,
                        COUNT(*) FILTER (WHERE status='replied')::int      as replied,
                        COUNT(*) FILTER (WHERE status='meeting_set')::int  as meeting_set
                    FROM contact_outreach
                `).get(),
                db.prepare(`
                    SELECT id, supplier_name, contact_name, title, email, bop_category, seniority
                    FROM supplier_contacts
                    WHERE seniority IN ('c_suite','vp')
                      AND email IS NOT NULL AND email!=''
                      AND bop_category IS NOT NULL
                    ORDER BY CASE seniority WHEN 'c_suite' THEN 1 ELSE 2 END, supplier_name
                    LIMIT 10
                `).all()
            ]);
            res.json({
                ok: true,
                timestamp: new Date().toISOString(),
                contacts: contactStats,
                outreach: outreachStats,
                priority_rfq_targets: topTargets,
                next_action: outreachStats?.total === 0
                    ? 'No RFQs drafted yet. Use POST /api/wave9/contacts/:id/rfq with a priority target contact ID.'
                    : `${outreachStats?.draft} RFQ drafts ready to send. Use POST /api/wave9/outreach/:id/send to mark as sent.`
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── TOP TARGETS ─────────────────────────────────────────────────────────────
    // C-Suite + VP contacts with email addresses — highest priority RFQ targets
    router.get('/top-targets', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        try {
            const targets = await db.prepare(`
                SELECT id, supplier_name, contact_name, title, email, bop_category, seniority
                FROM supplier_contacts
                WHERE email IS NOT NULL AND email != ''
                  AND seniority IN ('c_suite','vp')
                ORDER BY
                    CASE seniority WHEN 'c_suite' THEN 1 WHEN 'vp' THEN 2 ELSE 3 END,
                    bop_category NULLS LAST,
                    supplier_name
            `).all();
            res.json({
                ok: true,
                total: targets.length,
                note: `${targets.length} C-Suite/VP contacts with verified emails — ready for Claude RFQ. POST /api/wave9/contacts/:id/rfq to draft.`,
                targets
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });


    // ─── OUTREACH PIPELINE ────────────────────────────────────────────────────
    // Ensure contact_outreach table exists (migration 028 may have failed silently)
    async function ensureOutreachTable() {
        if (!db) return;
        try {
            await db.prepare(`CREATE TABLE IF NOT EXISTS contact_outreach (
                id SERIAL PRIMARY KEY, contact_id INTEGER, supplier_name TEXT NOT NULL,
                outreach_type TEXT DEFAULT 'rfq', status TEXT DEFAULT 'draft',
                rfq_category TEXT, rfq_content TEXT, sent_at TIMESTAMPTZ,
                replied_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
            )`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_co_status ON contact_outreach(status)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_co_supplier ON contact_outreach(supplier_name)`).run();
        } catch {}
    }

    // List all RFQ drafts and outreach records
    router.get('/outreach', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        await ensureOutreachTable();
        try {
            const status = req.query.status || null;
            const params = [];
            let where = 'WHERE 1=1';
            if (status) { params.push(status); where += ` AND o.status = $${params.length}::text`; }
            params.push(parseInt(req.query.limit)||20, (parseInt(req.query.page||1)-1)*(parseInt(req.query.limit)||20));
            const rows = await db.prepare(`
                SELECT o.id, o.contact_id, o.supplier_name, o.outreach_type, o.status,
                       o.rfq_category, LEFT(o.rfq_content, 200) as rfq_preview,
                       o.sent_at, o.replied_at, o.created_at,
                       sc.contact_name, sc.title, sc.email
                FROM contact_outreach o
                LEFT JOIN supplier_contacts sc ON sc.id = o.contact_id
                ${where}
                ORDER BY o.created_at DESC
                LIMIT $${params.length-1} OFFSET $${params.length}
            `).all(...params);
            const countRow = await db.prepare(`SELECT COUNT(*)::int as n FROM contact_outreach ${where}`).get(...params.slice(0,-2));
            res.json({ ok: true, total: countRow?.n||0, outreach: rows });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Mark outreach as sent
    router.post('/outreach/:id/send', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        await ensureOutreachTable();
        try {
            await db.prepare(`UPDATE contact_outreach SET status='sent', sent_at=NOW() WHERE id=$1`)
                .run(parseInt(req.params.id));
            res.json({ ok: true, id: parseInt(req.params.id), status: 'sent', sent_at: new Date().toISOString() });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Mark outreach replied
    router.post('/outreach/:id/reply', async (req, res) => {
        if (!db) return res.status(503).json({ error: 'No database' });
        const { notes } = req.body || {};
        try {
            await db.prepare(`UPDATE contact_outreach SET status='replied', replied_at=NOW(), notes=$1 WHERE id=$2`)
                .run(notes||null, parseInt(req.params.id));
            res.json({ ok: true, id: parseInt(req.params.id), status: 'replied' });
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
