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
                let where = 'WHERE 1=1';
                const params = [];
                if (category) { params.push(category); where += ` AND bop_category = $${params.length}`; }
                if (search) {
                    params.push(`%${search}%`);
                    where += ` AND (supplier_name ILIKE $${params.length} OR contact_name ILIKE $${params.length} OR title ILIKE $${params.length})`;
                }

                const countRow = await db.prepare(`SELECT COUNT(*) as n FROM supplier_contacts ${where}`).get(...params);
                total = parseInt(countRow?.n || 0);

                params.push(limit, offset);
                contacts = await db.prepare(`
                    SELECT id, supplier_name, contact_name, title, email, phone, created_at
                    FROM supplier_contacts ${where.replace(/bop_category[^,)]*/g, '1=1')}
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

    return router;
}

module.exports = { createWave9Routes };
