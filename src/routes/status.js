'use strict';
/**
 * FlowSeer Platform Status — /api/status
 * Single-call summary endpoint for Grok audits and operator dashboards.
 * Returns the essential facts about the current platform state.
 */
const express = require('express');
const { CONTRACT_VERSION } = require('../common/intelligence-envelope');

function createStatusRoutes(db, opts = {}) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const ts = new Date().toISOString();

        // Gather DB counts
        const counts = {};
        if (db) {
            const tables = [
                ['supplier_tiers',   'SELECT COUNT(*) as n FROM supplier_tiers'],
                ['market_pricing',   'SELECT COUNT(*) as n FROM market_pricing'],
                ['bop_categories',   'SELECT COUNT(*) as n FROM bop_categories'],
                ['claude_results',   'SELECT COUNT(*) as n FROM claude_results'],
                ['integrity_checks', 'SELECT COUNT(*) as n FROM integrity_checks'],
                ['supplier_contacts','SELECT COUNT(*) as n FROM supplier_contacts'],
                ['contact_outreach', 'SELECT COUNT(*) as n FROM contact_outreach'],
            ];
            for (const [key, sql] of tables) {
                try { const r = await db.prepare(sql).get(); counts[key] = parseInt(r?.n || 0); }
                catch { counts[key] = 0; }
            }

            // Live BOP total from DB
            try {
                const r = await db.prepare(`SELECT SUM(price_mid_usd) as total FROM market_pricing`).get();
                counts.bop_total_mid_usd = parseFloat(r?.total || 0);
            } catch { counts.bop_total_mid_usd = 0; }
        }

        res.json({
            _envelope: {
                contract_version: CONTRACT_VERSION,
                engine: 'FlowSeer Platform',
                module: 'status',
                timestamp: ts,
                freshness: 'live',
                output_type: 'derived',
                source_summary: 'Live DB counts + env config',
                readiness: 'operational',
                error: null
            },
            platform: 'FlowSeer / SSC V2',
            head: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) || process.env.BUILD_COMMIT_SHA?.slice(0,7) || 'local',
            timestamp: ts,
            db: {
                online: !!db,
                counts,
            },
            engines: {
                discovery:  { status: 'operational',  key_required: false },
                claude:     { status: process.env.ANTHROPIC_API_KEY  ? 'operational' : 'awaiting_key', model: 'claude-haiku-4-5-20251001', analyses_run: counts.claude_results || 0 },
                perplexity: { status: process.env.PERPLEXITY_API_KEY ? 'operational' : 'awaiting_key', checks_run: counts.integrity_checks || 0 },
            },
            bop_intelligence: {
                suppliers_in_db:     counts.supplier_tiers || 0,
                pricing_records:     counts.market_pricing || 0,
                bop_total_mid_usd:   counts.bop_total_mid_usd || 0,
                bop_categories_priced: 19,
            },
            wave9_readiness: {
                contacts_in_db:          counts.supplier_contacts || 0,
                outreach_records:        counts.contact_outreach || 0,
                apollo_upgrade_required: !process.env.APOLLO_API_KEY,
                top_targets_endpoint:    'GET /api/wave9/top-targets',
                rfq_endpoint:            'POST /api/wave9/contacts/:id/rfq',
                outreach_pipeline:       'GET /api/wave9/outreach',
                activation_path: 'Upgrade Apollo to Basic ($49/mo) → POST /api/wave9/enrich-contacts'
            },
            audit_endpoints: {
                claude_live_test:       'GET /api/claude/live-test',
                integrity_live_test:    'GET /api/integrity/live-test',
                health:                 'GET /api/health',
                pricing_summary:        'GET /api/discovery/pricing/summary',
                claude_results:         'GET /api/claude/results?limit=5',
                wave9_status:           'GET /api/wave9/status',
                wave9_top_targets:      'GET /api/wave9/top-targets',
                wave9_by_seniority:     'GET /api/wave9/contacts/by-seniority',
                wave9_by_category:      'GET /api/wave9/contacts/by-category',
                wave9_outreach:         'GET /api/wave9/outreach-readiness',
                wave9_pipeline:         'GET /api/wave9/pipeline',
                wave9_rfq_queue:        'GET /api/wave9/rfq-queue',
            }
        });
    });

    return router;
}

module.exports = { createStatusRoutes };
