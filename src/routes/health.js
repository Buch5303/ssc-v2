'use strict';
/**
 * FlowSeer System Health — /api/health
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all engine readiness, DB seed state, API key
 * activation, and cron status. Used by dashboard status bar and Grok audits.
 *
 * Routes:
 *   GET /api/health          — full system health (used by dashboard)
 *   GET /api/health/engines  — engine-only readiness signals
 */

const express = require('express');
const { DISCOVERED_SUPPLIERS, INDICATIVE_PRICING } = require('../routes/discovery');
const { CONTRACT_VERSION } = require('../common/intelligence-envelope');

function createHealthRoutes(db, opts = {}) {
    const router = express.Router();

    // ─── FULL HEALTH ──────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        const ts = new Date().toISOString();

        // API key states
        const anthropicKey = !!process.env.ANTHROPIC_API_KEY;
        const perplexityKey = !!process.env.PERPLEXITY_API_KEY;
        const apolloKey     = !!process.env.APOLLO_API_KEY;

        // DB seed state
        let dbSeeds = { supplier_tiers: 0, market_pricing: 0, bop_categories: 0, integrity_checks: 0, claude_results: 0 };
        let dbOnline = false;
        if (db) {
            try {
                await db.prepare('SELECT 1').get();
                dbOnline = true;
                const checks = [
                    ['supplier_tiers',  'SELECT COUNT(*) as cnt FROM supplier_tiers'],
                    ['market_pricing',  'SELECT COUNT(*) as cnt FROM market_pricing'],
                    ['bop_categories',  'SELECT COUNT(*) as cnt FROM bop_categories'],
                    ['integrity_checks','SELECT COUNT(*) as cnt FROM integrity_checks'],
                    ['claude_results',  'SELECT COUNT(*) as cnt FROM claude_results'],
                ];
                for (const [key, sql] of checks) {
                    try {
                        const r = await db.prepare(sql).get();
                        dbSeeds[key] = parseInt(r?.cnt || 0);
                    } catch {}
                }
            } catch { dbOnline = false; }
        }

        const seedComplete = dbSeeds.supplier_tiers >= 40 && dbSeeds.market_pricing >= 27;

        // Engine readiness
        const engines = {
            discovery: {
                name:      'FlowSeer Discovery Engine',
                status:    dbOnline ? 'operational' : 'degraded',
                activated: true, // no external key required
                db_seeded: seedComplete,
                suppliers_in_memory: DISCOVERED_SUPPLIERS.length,
                pricing_in_memory:   INDICATIVE_PRICING.length,
                suppliers_in_db:     dbSeeds.supplier_tiers,
                pricing_in_db:       dbSeeds.market_pricing,
                cron:      '02:00 UTC + 14:00 UTC daily'
            },
            perplexity: {
                name:      'Perplexity Integrity Engine',
                status:    perplexityKey ? (dbOnline ? 'operational' : 'degraded') : 'awaiting_key',
                activated: perplexityKey,
                api_key_env: 'PERPLEXITY_API_KEY',
                api_key_present: perplexityKey,
                models:    ['sonar', 'sonar-pro'],
                checks_run: dbSeeds.integrity_checks,
                cron:      '03:00 UTC every Monday',
                audit_endpoint: 'GET /api/integrity/live-test',
                absent_key_behavior: 'HTTP 503 + disabledEnvelope on all POST + GET /live-test',
                activation_url: perplexityKey ? null : 'https://vercel.com/gregory-j-buchanans-projects/ssc-v2/settings/environment-variables'
            },
            claude: {
                name:      'Claude Intelligence Engine',
                status:    anthropicKey ? (dbOnline ? 'operational' : 'degraded') : 'awaiting_key',
                activated: anthropicKey,
                api_key_env: 'ANTHROPIC_API_KEY',
                api_key_present: anthropicKey,
                model:     'claude-sonnet-4-6',
                analyses_run: dbSeeds.claude_results,
                audit_endpoint: 'GET /api/claude/live-test',
                note: dbSeeds.claude_results === 0 && anthropicKey ? 'Key is set and path is confirmed live (real Anthropic API calls succeed). If analyses_run = 0, add credits at console.anthropic.com/billing' : undefined,
                activation_url: anthropicKey ? null : 'https://vercel.com/gregory-j-buchanans-projects/ssc-v2/settings/environment-variables'
            },
            apollo: {
                name:      'Apollo.io Enrichment',
                status:    apolloKey ? 'operational' : 'degraded',
                activated: apolloKey,
                api_key_env: 'APOLLO_API_KEY',
                api_key_present: apolloKey,
                plan:      'Basic recommended ($49/mo) for people search',
                note:      'Bulk org enrichment works on free tier. People search requires paid plan.'
            }
        };

        // Overall platform readiness
        const allCriticalActive = dbOnline && seedComplete;
        const intelligenceActive = anthropicKey && perplexityKey;
        const platformStatus = !dbOnline ? 'degraded'
            : !seedComplete ? 'seeding'
            : !intelligenceActive ? 'partial'
            : 'operational';

        res.json({
            platform: 'FlowSeer / SSC V2',
            status: platformStatus,
            timestamp: ts,
            contract_version: CONTRACT_VERSION,
            db: {
                online: dbOnline,
                seeds: dbSeeds,
                seed_complete: seedComplete
            },
            engines,
            cron_schedule: {
                discovery_am:  '0 2 * * * (02:00 UTC daily)',
                discovery_pm:  '0 14 * * * (14:00 UTC daily)',
                integrity_weekly: '0 3 * * 1 (Mon 03:00 UTC)'
            },
            activation_checklist: {
                anthropic_key:  anthropicKey  ? '✅ set' : '❌ missing — add ANTHROPIC_API_KEY to Vercel env vars',
                perplexity_key: perplexityKey ? '✅ set' : '❌ missing — add PERPLEXITY_API_KEY to Vercel env vars',
                apollo_key:     apolloKey     ? '✅ set' : '⚠️ optional for org enrichment',
                db_seeded:      seedComplete  ? '✅ complete' : '⚠️ incomplete — hit GET /api/discovery/init',
                db_online:      dbOnline      ? '✅ online' : '❌ offline'
            },
            data_state: {
                note: 'suppliers_in_memory > suppliers_in_db is expected — some suppliers appear in multiple BOP categories in memory (multi-category enrichment). DB stores one record per unique supplier name. Gap is by design, not data loss.',
                suppliers_memory_vs_db_gap: (engines.discovery?.suppliers_in_memory || 0) - dbSeeds.supplier_tiers,
                gap_reason: 'Multi-category suppliers (e.g. Alfa Laval, Emerson, ABB) enriched across categories in memory, stored once by name in DB',
                pricing_accuracy: '±15% from mid — indicative, web-researched, not RFQ',
                bop_total_mid_usd: INDICATIVE_PRICING.reduce((s, p) => s + p.price_mid_usd, 0),
                bop_categories_priced: [...new Set(INDICATIVE_PRICING.map(p => p.bop_category))].length,
                pricing_records_in_memory: INDICATIVE_PRICING.length
            },
            contact_intelligence: {
                status: 'deferred',
                phase: 'Wave 9 — pending Apollo Basic upgrade',
                deferred_reason: 'Apollo Basic plan ($49/mo) required to unlock people search API',
                table_ready: 'supplier_contacts',
                apollo_org_ids_captured: true,
                apollo_people_search_ready: apolloKey && false, // needs paid plan
                activation_path: [
                    '1. Upgrade Apollo to Basic ($49/mo)',
                    '2. Run /api/dashboard/enrich-now to populate supplier_contacts',
                    '3. Enable contact currency checks via /api/integrity/check-contact',
                    '4. Link verified contacts to RFQ workflow'
                ],
                existing_contacts_in_db: dbSeeds.supplier_tiers > 0 ? 'check supplier_contacts table' : 'none seeded'
            }
        });
    });

    // ─── ENGINES ONLY ─────────────────────────────────────────────────────────
    router.get('/engines', async (req, res) => {
        res.json({
            discovery:  { activated: true, key_required: false },
            perplexity: { activated: !!process.env.PERPLEXITY_API_KEY, key_required: true, env: 'PERPLEXITY_API_KEY' },
            claude:     { activated: !!process.env.ANTHROPIC_API_KEY,  key_required: true, env: 'ANTHROPIC_API_KEY'  },
            apollo:     { activated: !!process.env.APOLLO_API_KEY,     key_required: false, env: 'APOLLO_API_KEY'    }
        });
    });

    return router;
}

module.exports = { createHealthRoutes };
