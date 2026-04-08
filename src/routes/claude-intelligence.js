'use strict';
/**
 * FlowSeer Claude Intelligence Routes — EQS v1.0
 * All responses use Wave 8 intelligence envelope (contract_version 1.0).
 * When ANTHROPIC_API_KEY is absent, endpoints return disabledEnvelope.
 */
const { successEnvelope, disabledEnvelope, errorEnvelope } = require('../common/intelligence-envelope');

const CLAUDE_ENGINE = 'Claude Intelligence Engine';
const CLAUDE_KEY_ENV = 'ANTHROPIC_API_KEY';

function claudeKeyGuard(res) {
    if (!process.env[CLAUDE_KEY_ENV]) {
        res.status(503).json(disabledEnvelope({
            engine: CLAUDE_ENGINE, mod: 'claude_sonnet', envVar: CLAUDE_KEY_ENV,
            hint: 'Add ANTHROPIC_API_KEY to Vercel env vars → vercel.com/gregory-j-buchanans-projects/ssc-v2/settings/environment-variables. Key: sk-ant-...'
        }));
        return true;
    }
    return false;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes:
 *   GET  /api/claude/status                 — engine status + model info
 *   POST /api/claude/analyze-pricing        — anomaly detection across all pricing
 *   POST /api/claude/draft-rfq              — generate professional RFQ email
 *   POST /api/claude/compare-suppliers      — ranked supplier comparison
 *   POST /api/claude/cross-validate         — second-opinion on Perplexity check
 *   POST /api/claude/procurement-summary    — executive BOP procurement summary
 *   POST /api/claude/outreach-strategy      — supplier outreach tactical plan
 *   GET  /api/claude/results                — history of all Claude analysis runs
 */

const express = require('express');
const claude = require('../services/claude');
const { DISCOVERED_SUPPLIERS, INDICATIVE_PRICING } = require('./discovery');

async function saveClaudeResult(db, { analysisType, subjectName, content, usage, model, triggeredBy = 'api' }) {
    if (!db) return null;
    try {
        const cost = claude.estimateCost(usage);
        const row = await db.prepare(`
            INSERT INTO claude_results
                (analysis_type, subject_name, content, input_tokens, output_tokens,
                 model_cost_usd, model, triggered_by, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
            RETURNING id
        `).get([
            analysisType, subjectName, content,
            usage?.input_tokens || 0, usage?.output_tokens || 0,
            cost, model, triggeredBy
        ]);
        return row?.id;
    } catch { return null; }
}

function createClaudeRoutes(db, opts = {}) {
    const router = express.Router();

    // ─── STATUS ───────────────────────────────────────────────────────────────
    router.get('/status', async (req, res) => {
        const hasKey = !!process.env.ANTHROPIC_API_KEY;
        let dbStats = { total_analyses: 0, total_cost_usd: 0, last_run: null };

        if (db) {
            try {
                const r = await db.prepare(
                    `SELECT COUNT(*) as cnt, SUM(model_cost_usd) as cost, MAX(created_at) as last FROM claude_results`
                ).get();
                dbStats.total_analyses = parseInt(r?.cnt || 0);
                dbStats.total_cost_usd = parseFloat(r?.cost || 0).toFixed(4);
                dbStats.last_run = r?.last || null;
            } catch {}
        }

        res.json({
            engine: 'FlowSeer Claude Intelligence Engine',
            version: '1.0.0',
            status: hasKey ? 'operational' : 'no_api_key',
            claude_configured: hasKey,
            model: claude.DEFAULT_MODEL,
            capabilities: [
                'pricing_anomaly_detection',
                'rfq_drafting',
                'supplier_comparison',
                'perplexity_cross_validation',
                'executive_procurement_summary',
                'outreach_strategy'
            ],
            cost_estimate: {
                pricing_analysis:      '$0.01-0.05 (full dataset)',
                rfq_draft:             '$0.005-0.015 per RFQ',
                supplier_comparison:   '$0.005-0.010',
                procurement_summary:   '$0.010-0.025',
                cross_validation:      '$0.003-0.008'
            },
            vs_perplexity: {
                perplexity: 'Real-time web search + citations — best for: is this supplier active? current pricing signals?',
                claude:     'Deep reasoning + synthesis — best for: analyze everything, draft RFQ, rank suppliers, exec summary'
            },
            db_stats: dbStats
        });
    });

    // ─── ANALYZE PRICING ─────────────────────────────────────────────────────
    router.post('/analyze-pricing', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        try {
            const records = req.body?.records || INDICATIVE_PRICING;
            const result = await claude.analyzePricingAnomalies(records);
            const id = await saveClaudeResult(db, {
                analysisType: 'pricing_analysis',
                subjectName: `BOP Pricing Analysis — ${records.length} records`,
                content: result.content,
                usage: result.usage,
                model: result.model,
                triggeredBy: req.body?.triggered_by || 'api'
            });

            res.json({
                ok: true, analysis_id: id,
                subject: `BOP Pricing Analysis — ${records.length} records`,
                analysis: result.content,
                records_analyzed: records.length,
                input_tokens: result.usage?.input_tokens,
                output_tokens: result.usage?.output_tokens,
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) {
            res.status(e.message.includes('ANTHROPIC_API_KEY') ? 503 : 500)
               .json({ error: e.message, hint: e.message.includes('API_KEY') ? 'Add ANTHROPIC_API_KEY to Vercel env vars' : undefined });
        }
    });

    // ─── DRAFT RFQ ────────────────────────────────────────────────────────────
    router.post('/draft-rfq', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        const { supplier_name, contact_name, contact_title, part_description, bop_category, price_mid_usd, delivery_location, project_name } = req.body || {};
        if (!supplier_name || !part_description) return res.status(400).json({ error: 'supplier_name and part_description required' });

        try {
            const result = await claude.draftRFQ({
                supplierName: supplier_name,
                contactName: contact_name,
                contactTitle: contact_title,
                partDescription: part_description,
                bopCategory: bop_category,
                priceMid: price_mid_usd || 0,
                deliveryLocation: delivery_location,
                projectName: project_name
            });

            const id = await saveClaudeResult(db, {
                analysisType: 'rfq_draft',
                subjectName: `RFQ: ${supplier_name} — ${part_description}`,
                content: result.content,
                usage: result.usage,
                model: result.model,
                triggeredBy: req.body?.triggered_by || 'api'
            });

            res.json({
                ok: true, analysis_id: id,
                supplier: supplier_name,
                rfq: result.content,
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── COMPARE SUPPLIERS ────────────────────────────────────────────────────
    router.post('/compare-suppliers', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        const { category, supplier_names } = req.body || {};
        if (!category) return res.status(400).json({ error: 'category required' });

        try {
            // Use provided names or auto-select from seeded data
            let suppliers;
            if (supplier_names && supplier_names.length) {
                suppliers = DISCOVERED_SUPPLIERS.filter(s => supplier_names.includes(s.name) || s.bop_category === category);
            } else {
                suppliers = DISCOVERED_SUPPLIERS.filter(s => s.bop_category === category);
            }

            if (!suppliers.length) return res.status(404).json({ error: `No suppliers found for category: ${category}` });

            const result = await claude.compareSuppliers({ category, suppliers });
            const id = await saveClaudeResult(db, {
                analysisType: 'supplier_comparison',
                subjectName: `Supplier Comparison: ${category}`,
                content: result.content,
                usage: result.usage,
                model: result.model
            });

            res.json({
                ok: true, analysis_id: id, category,
                suppliers_compared: suppliers.length,
                comparison: result.content,
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── CROSS-VALIDATE (Perplexity ↔ Claude) ────────────────────────────────
    router.post('/cross-validate', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        const { supplier_name, perplexity_analysis, perplexity_score } = req.body || {};
        if (!supplier_name || !perplexity_analysis) return res.status(400).json({ error: 'supplier_name and perplexity_analysis required' });

        try {
            const result = await claude.crossValidateIntegrityCheck({
                supplierName: supplier_name,
                perplexityAnalysis: perplexity_analysis,
                perplexityScore: perplexity_score || 'UNKNOWN'
            });

            const id = await saveClaudeResult(db, {
                analysisType: 'cross_validation',
                subjectName: `Cross-validate: ${supplier_name}`,
                content: result.content,
                usage: result.usage,
                model: result.model
            });

            res.json({
                ok: true, analysis_id: id,
                supplier: supplier_name,
                perplexity_score,
                claude_verdict: result.content,
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── PROCUREMENT SUMMARY ──────────────────────────────────────────────────
    router.post('/procurement-summary', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        try {
            const records = req.body?.records || INDICATIVE_PRICING;
            const totalMid  = records.reduce((s, p) => s + (p.price_mid_usd  || 0), 0);
            const totalLow  = records.reduce((s, p) => s + (p.price_low_usd  || 0), 0);
            const totalHigh = records.reduce((s, p) => s + (p.price_high_usd || 0), 0);

            const t1 = DISCOVERED_SUPPLIERS.filter(s => s.tier === 1).length;
            const t2t3 = DISCOVERED_SUPPLIERS.filter(s => s.tier === 2 || s.tier === 3).length;
            const t4 = DISCOVERED_SUPPLIERS.filter(s => s.tier === 4).length;

            const result = await claude.generateProcurementSummary({
                pricingRecords: records,
                supplierCounts: { total: DISCOVERED_SUPPLIERS.length, t1, t2_t3: t2t3, t4 },
                totalMid, totalLow, totalHigh
            });

            const id = await saveClaudeResult(db, {
                analysisType: 'procurement_summary',
                subjectName: 'BOP Procurement Executive Summary',
                content: result.content,
                usage: result.usage,
                model: result.model
            });

            res.json({
                ok: true, analysis_id: id,
                summary: result.content,
                bop_totals: { low: totalLow, mid: totalMid, high: totalHigh },
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── OUTREACH STRATEGY ────────────────────────────────────────────────────
    router.post('/outreach-strategy', async (req, res) => {
        if (claudeKeyGuard(res)) return;
        const { category, price_mid_usd } = req.body || {};
        if (!category) return res.status(400).json({ error: 'category required' });

        try {
            const suppliers = DISCOVERED_SUPPLIERS.filter(s => s.bop_category === category);
            if (!suppliers.length) return res.status(404).json({ error: `No suppliers for: ${category}` });

            const pricingRecord = INDICATIVE_PRICING.find(p => p.bop_category === category);
            const midPrice = price_mid_usd || pricingRecord?.price_mid_usd || 0;

            const result = await claude.draftOutreachStrategy({ category, suppliers, priceMid: midPrice });
            const id = await saveClaudeResult(db, {
                analysisType: 'outreach_strategy',
                subjectName: `Outreach Strategy: ${category}`,
                content: result.content,
                usage: result.usage,
                model: result.model
            });

            res.json({
                ok: true, analysis_id: id, category,
                strategy: result.content,
                suppliers_included: suppliers.map(s => s.name),
                cost_usd: claude.estimateCost(result.usage),
                model: result.model
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ─── RESULTS HISTORY ──────────────────────────────────────────────────────
    router.get('/results', async (req, res) => {
        const page   = Math.max(1, parseInt(req.query.page) || 1);
        const limit  = Math.min(50, parseInt(req.query.limit) || 20);
        const type   = req.query.type || null;
        const offset = (page - 1) * limit;

        let results = [];
        if (db) {
            try {
                let where = 'WHERE 1=1';
                const params = [];
                if (type) { params.push(type); where += ` AND analysis_type = $${params.length}`; }
                params.push(limit, offset);
                results = await db.prepare(`
                    SELECT id, analysis_type, subject_name, model, input_tokens, output_tokens,
                           model_cost_usd, triggered_by, created_at,
                           LEFT(content, 400) as preview
                    FROM claude_results ${where}
                    ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}
                `).all(params);
            } catch {}
        }

        res.json({ results, page, limit });
    });

    return router;
}

module.exports = { createClaudeRoutes };
