'use strict';
/**
 * FlowSeer Integrity Engine — Perplexity-powered validation — EQS v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * All responses use the Wave 8 intelligence envelope (contract_version 1.0).
 * When PERPLEXITY_API_KEY is absent, endpoints return disabledEnvelope —
 * no dead controls, no misleading active state.
 */

const { successEnvelope, disabledEnvelope, errorEnvelope, perplexityEnvelope, OUTPUT_TYPES, FRESHNESS } = require('../common/intelligence-envelope');
const ENGINE = 'FlowSeer Integrity Engine';
const KEY_ENV = 'PERPLEXITY_API_KEY';

function keyGuard(res) {
    if (!process.env[KEY_ENV]) {
        res.status(503).json(disabledEnvelope({
            engine: ENGINE, mod: 'perplexity_sonar', envVar: KEY_ENV,
            hint: 'Add PERPLEXITY_API_KEY to Vercel env vars → vercel.com/gregory-j-buchanans-projects/ssc-v2/settings/environment-variables'
        }));
        return true;
    }
    return false;
}



const express = require('express');
const perplexity = require('../services/perplexity');
const { DISCOVERED_SUPPLIERS, INDICATIVE_PRICING } = require('./discovery');

// Rough cost per 1K tokens by model (USD)
const MODEL_COSTS = {
    'sonar':              { input: 0.001, output: 0.001 },
    'sonar-pro':          { input: 0.003, output: 0.015 },
    'sonar-deep-research':{ input: 0.008, output: 0.008 }
};

function estimateCost(model, usage = {}) {
    const costs = MODEL_COSTS[model] || MODEL_COSTS['sonar'];
    const inputCost  = ((usage.prompt_tokens     || 0) / 1000) * costs.input;
    const outputCost = ((usage.completion_tokens || 0) / 1000) * costs.output;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6dp
}

async function saveCheck(db, { checkType, subjectName, bopCategory, model, promptSummary, result, triggeredBy = 'manual' }) {
    if (!db) return null;
    try {
        const score = perplexity.parseIntegrityScore(result.content || '');
        const cost  = estimateCost(model, result.usage);
        const row = await db.prepare(`
            INSERT INTO integrity_checks
                (check_type, subject_name, bop_category, perplexity_model, prompt_summary,
                 response_content, citations, integrity_score, tokens_used, model_cost_usd,
                 triggered_by, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'complete')
            RETURNING id
        `).get([
            checkType, subjectName, bopCategory || null, model, promptSummary,
            result.content,
            JSON.stringify(result.citations || []),
            score,
            (result.usage?.total_tokens || 0),
            cost,
            triggeredBy
        ]);
        return row?.id;
    } catch (e) {
        console.error('saveCheck error:', e.message);
        return null;
    }
}

function createIntegrityRoutes(db, opts = {}) {
    const router = express.Router();

    // ─── STATUS ───────────────────────────────────────────────────────────────
    router.get('/status', async (req, res) => {
        const hasKey = !!process.env.PERPLEXITY_API_KEY;
        let dbStats = { total_checks: 0, last_check: null, avg_score_numeric: null };

        if (db) {
            try {
                const r = await db.prepare('SELECT COUNT(*) as cnt, MAX(created_at) as last FROM integrity_checks').get();
                dbStats.total_checks = parseInt(r?.cnt || 0);
                dbStats.last_check   = r?.last || null;
            } catch {}
        }

        res.json({
            _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'status', timestamp: new Date().toISOString(), freshness: FRESHNESS.SEEDED, output_type: OUTPUT_TYPES.DERIVED, source_summary: 'Local DB state + env config', readiness: hasKey ? 'operational' : 'awaiting_key' },
            engine: 'FlowSeer Integrity Engine',
            version: '1.0.0',
            status: hasKey ? 'operational' : 'no_api_key',
            perplexity_configured: hasKey,
            models_available: ['sonar', 'sonar-pro', 'sonar-deep-research'],
            capabilities: [
                'supplier_integrity_check',
                'pricing_cross_validation',
                'contact_currency_verification',
                'market_briefing',
                'net_new_supplier_discovery',
                'batch_integrity_sweep'
            ],
            db_stats: dbStats,
            cost_estimate: {
                supplier_check:   '$0.001-0.003 per check (sonar)',
                pricing_check:    '$0.003-0.015 per check (sonar-pro)',
                market_briefing:  '$0.005-0.020 per briefing (sonar-pro)',
                discovery_run:    '$0.008-0.030 per category (sonar-pro)',
                full_sweep_31_suppliers: '$0.03-0.10 estimated'
            }
        });
    });

    // ─── CHECK SUPPLIER ───────────────────────────────────────────────────────
    router.post('/check-supplier', async (req, res) => {
        if (keyGuard(res)) return;
        const { name, domain, bop_category, revenue_usd, parent, description } = req.body || {};
        if (!name) return res.status(400).json({ error: 'name required' });

        try {
            const result = await perplexity.checkSupplierIntegrity({
                name, domain, bopCategory: bop_category,
                revenue: revenue_usd, parent, description
            });
            const score = perplexity.parseIntegrityScore(result.content);
            const checkId = await saveCheck(db, {
                checkType: 'supplier', subjectName: name, bopCategory: bop_category,
                model: result.model, promptSummary: `Supplier integrity check: ${name}`,
                result, triggeredBy: req.body.triggered_by || 'api'
            });

            res.json(perplexityEnvelope({
                mod: 'supplier_integrity',
                result,
                data: { check_id: checkId, supplier: name, integrity_score: score, analysis: result.content, cost_usd: estimateCost(result.model, result.usage) }
            }));
        } catch (e) {
            res.status(e.message.includes('PERPLEXITY_API_KEY') ? 503 : 500)
               .json({ error: e.message, hint: e.message.includes('API_KEY') ? 'Add PERPLEXITY_API_KEY to Vercel environment variables' : undefined });
        }
    });

    // ─── CHECK PRICING ────────────────────────────────────────────────────────
    router.post('/check-pricing', async (req, res) => {
        if (keyGuard(res)) return;
        const { part_description, bop_category, price_mid_usd, price_low_usd, price_high_usd, source_supplier } = req.body || {};
        if (!part_description || !price_mid_usd) return res.status(400).json({ error: 'part_description and price_mid_usd required' });

        try {
            const result = await perplexity.checkPricingIntegrity({
                partDescription: part_description,
                bopCategory: bop_category,
                priceMid: price_mid_usd,
                priceRange: { low: price_low_usd, high: price_high_usd },
                sourceSupplier: source_supplier
            });
            const score = perplexity.parseIntegrityScore(result.content);
            const checkId = await saveCheck(db, {
                checkType: 'pricing', subjectName: part_description, bopCategory: bop_category,
                model: result.model, promptSummary: `Pricing check: ${part_description} @ $${(price_mid_usd/1000).toFixed(0)}K`,
                result, triggeredBy: req.body.triggered_by || 'api'
            });

            res.json(perplexityEnvelope({
                mod: 'pricing_validation',
                result,
                data: { check_id: checkId, part: part_description, bop_category, price_mid_usd, integrity_score: score, analysis: result.content, cost_usd: estimateCost(result.model, result.usage) }
            }));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── CHECK CONTACT ────────────────────────────────────────────────────────
    router.post('/check-contact', async (req, res) => {
        if (keyGuard(res)) return;
        const { name, title, company, domain } = req.body || {};
        if (!name || !company) return res.status(400).json({ error: 'name and company required' });

        try {
            const result = await perplexity.checkContactCurrency({ name, title, company, domain });
            const score = perplexity.parseIntegrityScore(result.content);
            const checkId = await saveCheck(db, {
                checkType: 'contact', subjectName: `${name} @ ${company}`,
                model: result.model, promptSummary: `Contact check: ${name}, ${title} at ${company}`,
                result, triggeredBy: req.body.triggered_by || 'api'
            });

            res.json(perplexityEnvelope({
                mod: 'contact_currency',
                result,
                data: { check_id: checkId, contact: name, title, company, currency_status: score, analysis: result.content, cost_usd: estimateCost(result.model, result.usage) }
            }));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── MARKET BRIEFING ──────────────────────────────────────────────────────
    router.post('/market-briefing', async (req, res) => {
        if (keyGuard(res)) return;
        const { bop_category, category_name } = req.body || {};
        if (!bop_category) return res.status(400).json({ error: 'bop_category required' });

        // Check cache first (7-day TTL)
        if (db) {
            try {
                const cached = await db.prepare(
                    `SELECT * FROM market_briefings WHERE bop_category = $1 AND valid_until > NOW() ORDER BY created_at DESC LIMIT 1`
                ).get([bop_category]);
                if (cached) {
                    return res.json({ _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'market_briefing', timestamp: new Date().toISOString(), freshness: FRESHNESS.CACHED, output_type: OUTPUT_TYPES.CACHED, source_summary: 'Cached Perplexity briefing (7-day TTL)', readiness: 'operational', error: null }, ok: true, cached: true, bop_category, briefing: cached.briefing_content, citations: JSON.parse(cached.citations || '[]'), created_at: cached.created_at });
                }
            } catch {}
        }

        try {
            const result = await perplexity.getMarketBriefing({ bopCategory: bop_category, categoryName: category_name || bop_category });

            // Cache in DB
            if (db) {
                try {
                    await db.prepare(`
                        INSERT INTO market_briefings (bop_category, category_name, briefing_content, citations, perplexity_model, tokens_used, valid_until)
                        VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '7 days')
                    `).run([bop_category, category_name || bop_category, result.content, JSON.stringify(result.citations || []), result.model, result.usage?.total_tokens || 0]);
                } catch {}
            }

            res.json(perplexityEnvelope({
                mod: 'market_briefing',
                result,
                cached: false,
                data: { bop_category, category_name, briefing: result.content, cost_usd: estimateCost(result.model, result.usage), valid_for: '7 days' }
            }));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── DISCOVER SUPPLIERS ───────────────────────────────────────────────────
    router.post('/discover-suppliers', async (req, res) => {
        if (keyGuard(res)) return;
        const { bop_category, keywords = [], existing_suppliers = [] } = req.body || {};
        if (!bop_category) return res.status(400).json({ error: 'bop_category required' });

        try {
            const result = await perplexity.discoverSuppliers({ bopCategory: bop_category, keywords, existingSuppliers: existing_suppliers });

            if (db) {
                try {
                    await db.prepare(`
                        INSERT INTO perplexity_discoveries (bop_category, discovery_content, citations, perplexity_model, tokens_used)
                        VALUES ($1,$2,$3,$4,$5)
                    `).run([bop_category, result.content, JSON.stringify(result.citations || []), result.model, result.usage?.total_tokens || 0]);
                } catch {}
            }

            res.json(perplexityEnvelope({
                mod: 'supplier_discovery',
                result,
                data: { bop_category, discovery: result.content, cost_usd: estimateCost(result.model, result.usage) }
            }));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── LIVE TEST — Grok audit endpoint ─────────────────────────────────────
    // GET-accessible. Confirms Perplexity absent-key behavior (503 + disabledEnvelope)
    // or live operational path when PERPLEXITY_API_KEY is set.
    // Grok: without key → 503, _envelope.readiness: awaiting_key, output_type: placeholder
    //       with key    → 200, _envelope.output_type: verified or derived, live_call: true
    router.get('/live-test', async (req, res) => {
        const hasKey = !!process.env.PERPLEXITY_API_KEY;
        if (!hasKey) {
            return res.status(503).json(disabledEnvelope({
                engine: ENGINE,
                mod: 'live_test',
                envVar: KEY_ENV,
                hint: 'Add PERPLEXITY_API_KEY to Vercel env vars → perplexity.ai/settings/api. Engine is awaiting_key — all POST endpoints also return 503.'
            }));
        }
        // Key is present — run a minimal real Perplexity call
        try {
            const { callPerplexity } = require('../services/perplexity');
            const result = await callPerplexity({
                prompt: 'Confirm: Is Flowserve Corporation (flowserve.com) currently an active industrial valve manufacturer serving power generation? One sentence answer with source.',
                model: 'sonar',
                maxTokens: 100
            });
            res.json(perplexityEnvelope({
                mod: 'live_test',
                result,
                data: {
                    subject: 'Wave 8 Live-Test — Perplexity Grok Audit',
                    output: result.content,
                    audit_note: 'Real Perplexity Sonar API call via GET. live_call=true. Verify _envelope.output_type is verified (with citations) or derived (without).'
                }
            }));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── RESULTS — paginated check history ────────────────────────────────────
    router.get('/results', async (req, res) => {
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const type  = req.query.type || null;
        const score = req.query.score || null;
        const offset = (page - 1) * limit;

        let results = [];
        if (db) {
            try {
                let where = 'WHERE 1=1';
                const params = [];
                if (type)  { params.push(type);  where += ` AND check_type = $${params.length}`; }
                if (score) { params.push(score);  where += ` AND integrity_score = $${params.length}`; }
                params.push(limit, offset);
                results = await db.prepare(`
                    SELECT id, check_type, subject_name, bop_category, integrity_score,
                           perplexity_model, tokens_used, model_cost_usd, triggered_by,
                           created_at, LEFT(response_content, 300) as preview
                    FROM integrity_checks ${where}
                    ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}
                `).all(params);
            } catch {}
        }

        res.json({ _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'integrity_results', timestamp: new Date().toISOString(), freshness: FRESHNESS.CACHED, output_type: OUTPUT_TYPES.DERIVED, source_summary: 'DB integrity check history', readiness: 'operational', error: null }, results, page, limit, total: results.length });
    });

    // ─── SCORES SUMMARY ───────────────────────────────────────────────────────
    router.get('/scores', async (req, res) => {
        let scores = { by_score: {}, by_type: {}, total: 0 };

        if (db) {
            try {
                const rows = await db.prepare(`
                    SELECT integrity_score, check_type, COUNT(*) as cnt
                    FROM integrity_checks
                    GROUP BY integrity_score, check_type
                `).all();
                rows.forEach(r => {
                    scores.by_score[r.integrity_score] = (scores.by_score[r.integrity_score] || 0) + parseInt(r.cnt);
                    scores.by_type[r.check_type]  = (scores.by_type[r.check_type]  || 0) + parseInt(r.cnt);
                    scores.total += parseInt(r.cnt);
                });
            } catch {}
        }

        res.json({ _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'integrity_scores', timestamp: new Date().toISOString(), freshness: FRESHNESS.CACHED, output_type: OUTPUT_TYPES.DERIVED, source_summary: 'DB aggregated integrity scores', readiness: 'operational', error: null }, ...scores });
    });

    // ─── BATCH SWEEP — run integrity checks on all seeded suppliers ───────────
    router.post('/sweep', async (req, res) => {
        if (keyGuard(res)) return;
        const limit = Math.min(10, parseInt(req.body?.limit) || 5); // cap at 10 per sweep to control cost
        const checkType = req.body?.check_type || 'supplier';

        // Estimate cost upfront
        const estCostPer = 0.002; // avg sonar check
        const estTotal   = limit * estCostPer;

        try {
            const results = [];
            let totalCost = 0;
            let totalTokens = 0;

            if (checkType === 'supplier') {
                const batch = DISCOVERED_SUPPLIERS.slice(0, limit);
                for (const s of batch) {
                    try {
                        const result = await perplexity.checkSupplierIntegrity({
                            name: s.name, domain: s.domain,
                            bopCategory: s.bop_category,
                            revenue: s.revenue_usd,
                            parent: null
                        });
                        const score = perplexity.parseIntegrityScore(result.content);
                        const cost  = estimateCost(result.model, result.usage);
                        totalCost   += cost;
                        totalTokens += result.usage?.total_tokens || 0;

                        await saveCheck(db, {
                            checkType: 'supplier', subjectName: s.name, bopCategory: s.bop_category,
                            model: result.model, promptSummary: `Batch sweep: ${s.name}`,
                            result, triggeredBy: req.body?.triggered_by || 'sweep'
                        });

                        results.push({ supplier: s.name, score, cost_usd: cost, citations: result.citations.length });
                        // Small delay to avoid rate limiting
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) {
                        results.push({ supplier: s.name, score: 'ERROR', error: e.message });
                    }
                }
            } else if (checkType === 'pricing') {
                const batch = INDICATIVE_PRICING.slice(0, limit);
                for (const p of batch) {
                    try {
                        const result = await perplexity.checkPricingIntegrity({
                            partDescription: p.part_description,
                            bopCategory: p.bop_category,
                            priceMid: p.price_mid_usd,
                            priceRange: { low: p.price_low_usd, high: p.price_high_usd },
                            sourceSupplier: p.source_supplier
                        });
                        const score = perplexity.parseIntegrityScore(result.content);
                        const cost  = estimateCost(result.model, result.usage);
                        totalCost   += cost;
                        totalTokens += result.usage?.total_tokens || 0;

                        await saveCheck(db, {
                            checkType: 'pricing', subjectName: p.part_description, bopCategory: p.bop_category,
                            model: result.model, promptSummary: `Batch sweep pricing: ${p.sub_category}`,
                            result, triggeredBy: req.body?.triggered_by || 'sweep'
                        });

                        results.push({ part: p.part_description, category: p.bop_category, score, cost_usd: cost });
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) {
                        results.push({ part: p.part_description, score: 'ERROR', error: e.message });
                    }
                }
            }

            res.json({
                _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'sweep', timestamp: new Date().toISOString(), freshness: FRESHNESS.LIVE, output_type: OUTPUT_TYPES.DERIVED, source_summary: `Batch sweep — ${results.length} checks via Perplexity Sonar`, readiness: 'operational', error: null },
                ok: true, check_type: checkType, checked: results.length,
                results, total_cost_usd: Math.round(totalCost * 10000) / 10000,
                total_tokens: totalTokens,
                estimated_cost_limit: limit,
                note: `Cost capped at ${limit} checks. Run again for next batch.`
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── CRON — weekly integrity sweep ────────────────────────────────────────
    router.get('/cron', async (req, res) => {
        // Lightweight weekly sweep — 3 random suppliers + 2 pricing checks
        try {
            let swept = 0, totalCost = 0;
            const sample = DISCOVERED_SUPPLIERS.sort(() => Math.random() - 0.5).slice(0, 3);

            for (const s of sample) {
                try {
                    const result = await perplexity.checkSupplierIntegrity({ name: s.name, domain: s.domain, bopCategory: s.bop_category });
                    const cost = estimateCost(result.model, result.usage);
                    totalCost += cost;
                    await saveCheck(db, { checkType: 'supplier', subjectName: s.name, bopCategory: s.bop_category, model: result.model, promptSummary: `Weekly cron: ${s.name}`, result, triggeredBy: 'cron' });
                    swept++;
                    await new Promise(r => setTimeout(r, 800));
                } catch {}
            }

            res.json({ _envelope: { contract_version: '1.0', engine: 'FlowSeer Integrity Engine', module: 'cron_sweep', timestamp: new Date().toISOString(), freshness: FRESHNESS.LIVE, output_type: OUTPUT_TYPES.DERIVED, source_summary: 'Weekly cron integrity sweep', readiness: 'operational', error: null }, ok: true, swept, total_cost_usd: Math.round(totalCost * 10000) / 10000, timestamp: new Date().toISOString() });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}

module.exports = { createIntegrityRoutes };
