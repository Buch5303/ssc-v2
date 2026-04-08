'use strict';
/**
 * FlowSeer Claude Intelligence Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses Anthropic's Claude API as the synthesis and reasoning layer.
 * Complements Perplexity (real-time search) with deep analysis, RFQ drafting,
 * supplier comparison, pricing anomaly detection, and cross-validation.
 *
 * Model: claude-sonnet-4-6 (fast, capable, cost-effective for this workload)
 * API:   https://api.anthropic.com/v1/messages
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'; // haiku: fast, cost-effective, handles current load

function getApiKey() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set in environment');
    return key;
}

/**
 * Core Claude query function.
 */
async function query({ prompt, systemPrompt, model = DEFAULT_MODEL, maxTokens = 1024 }) {
    const messages = [{ role: 'user', content: prompt }];

    const body = {
        model,
        max_tokens: maxTokens,
        messages
    };
    if (systemPrompt) body.system = systemPrompt;

    const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
            'x-api-key': getApiKey(),
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(`Claude API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.content?.[0]?.text || '';
    const usage   = data.usage || {};

    return { content, usage, model: data.model || model, raw: data };
}

// ─── COST ESTIMATE ────────────────────────────────────────────────────────────
// claude-sonnet-4-6: $3/MTok input, $15/MTok output
function estimateCost(usage = {}) {
    const inputCost  = ((usage.input_tokens  || 0) / 1_000_000) * 3.0;
    const outputCost = ((usage.output_tokens || 0) / 1_000_000) * 15.0;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

// ─── INTELLIGENCE FUNCTIONS ───────────────────────────────────────────────────

/**
 * Analyze all BOP pricing records and flag anomalies, outliers, or inconsistencies.
 */
async function analyzePricingAnomalies(pricingRecords) {
    const summary = pricingRecords.map(p =>
        `- ${p.bop_category} | ${p.sub_category || p.part_description} | Low: $${(p.price_low_usd/1000).toFixed(0)}K | Mid: $${(p.price_mid_usd/1000).toFixed(0)}K | High: $${(p.price_high_usd/1000).toFixed(0)}K | Source: ${p.source_supplier || 'unknown'} | Confidence: ${p.confidence}`
    ).join('\n');

    const prompt = `You are reviewing indicative BOP (Balance of Plant) pricing for a 50MW industrial gas turbine power plant procurement program (W251/TG20 class). All pricing is ±15% from mid.

Here are the ${pricingRecords.length} pricing records:

${summary}

Please analyze and provide:
1. **OUTLIERS** — Any prices that seem unusually high or low vs industry norms for this equipment class
2. **CROSS-CATEGORY CONSISTENCY** — Does the relative sizing between systems make sense? (e.g., transformer should cost more than a gas detection system)
3. **MISSING MAJOR COST DRIVERS** — What BOP systems are NOT priced that likely represent significant cost?
4. **TOTAL BOP ASSESSMENT** — Is the total mid estimate reasonable for a 50MW GT plant?
5. **TOP 3 RISKS** — Biggest pricing risks to the program budget

Be direct and specific. Flag anything that looks wrong.`;

    const systemPrompt = `You are a senior power plant procurement engineer with 20+ years of BOP procurement experience for industrial gas turbines in the 50-100MW class. You know current market pricing well and can spot anomalies instantly.`;

    return query({ prompt, systemPrompt, maxTokens: 1500 });
}

/**
 * Generate a professional RFQ email for a supplier.
 */
async function draftRFQ({ supplierName, contactName, contactTitle, partDescription, bopCategory, priceMid, deliveryLocation, projectName }) {
    const prompt = `Draft a professional Request for Quotation (RFQ) email for the following:

Supplier: ${supplierName}
Contact: ${contactName || 'Procurement Team'} ${contactTitle ? `(${contactTitle})` : ''}
Equipment/System: ${partDescription}
BOP Category: ${bopCategory}
Indicative Budget: ~$${(priceMid/1000).toFixed(0)}K USD (for internal reference only, not to be shared)
Delivery Location: ${deliveryLocation || 'Site TBD — Santa Teresa, New Mexico, USA'}
Project: ${projectName || 'Project Jupiter — 50MW Gas Turbine Power Plant'}

RFQ should include:
1. Brief project introduction (W251B8/TG20 class turbine, ~50MW simple cycle)
2. Scope of supply requested (be specific to the equipment)
3. Required deliverables: technical datasheet, preliminary GA drawing, delivery schedule, commercial terms
4. Requested commercial terms: DDP delivery, 30/30/30/10 payment terms, 12-month warranty
5. Bid due date: 3 weeks from today
6. TWP contact information placeholder
7. Professional but direct tone — this is a serious procurement inquiry

Output: Subject line + full email body only. No preamble.`;

    const systemPrompt = `You are a senior procurement manager at Trans World Power (TWP), a power generation development company. You are professional, direct, and know how to write effective RFQs that get serious responses from industrial suppliers.`;

    return query({ prompt, systemPrompt, maxTokens: 1200 });
}

/**
 * Compare multiple suppliers in a category and produce a ranked recommendation.
 */
async function compareSuppliers({ category, suppliers }) {
    const supplierText = suppliers.map((s, i) =>
        `${i+1}. ${s.name} | Tier ${s.tier} | Revenue: ${s.revenue_usd ? '$'+(s.revenue_usd/1e6).toFixed(0)+'M' : 'unknown'} | ${s.hq_country || 'HQ unknown'} | ${(s.capabilities||[]).slice(0,3).join(', ')}`
    ).join('\n');

    const prompt = `Compare the following suppliers for the BOP category: **${category}**

${supplierText}

Provide:
1. **RANKED RECOMMENDATION** — Best to worst for a 50MW GT plant in New Mexico, USA. Consider: supply reliability, technical capability, lead times, local support, and price competitiveness.
2. **WINNER** — Who to approach first and why (one sentence)
3. **BACKUP** — Best alternative and why
4. **RED FLAGS** — Any suppliers to avoid or watch carefully
5. **NEGOTIATION LEVERAGE** — What competitive dynamics exist that TWP can use in pricing negotiations?

Be direct. TWP needs a shortlist for RFQ distribution.`;

    const systemPrompt = `You are a strategic procurement advisor specializing in power generation equipment. You help industrial gas turbine operators make smart supplier selections based on technical merit, commercial terms, and supply chain risk.`;

    return query({ prompt, systemPrompt, maxTokens: 1000 });
}

/**
 * Cross-validate a Perplexity integrity check result — second opinion.
 */
async function crossValidateIntegrityCheck({ supplierName, perplexityAnalysis, perplexityScore }) {
    const prompt = `Perplexity (real-time web search) has provided the following integrity assessment for supplier **${supplierName}**:

Score: ${perplexityScore}
Analysis:
${perplexityAnalysis}

As a second-opinion validator:
1. Does this assessment seem reasonable based on your knowledge of this company?
2. Are there any important factors the Perplexity analysis may have missed?
3. What is your confidence in the ${perplexityScore} score? (Agree / Partially Agree / Disagree)
4. **FINAL VERDICT**: HIGH / MEDIUM / LOW integrity for procurement purposes, and one-sentence rationale.

Be concise. This is a dual-validation check.`;

    const systemPrompt = `You are a procurement intelligence analyst providing a second opinion on supplier integrity assessments for a gas turbine power plant procurement program.`;

    return query({ prompt, systemPrompt, maxTokens: 600 });
}

/**
 * Generate an executive procurement summary for all BOP systems.
 */
async function generateProcurementSummary({ pricingRecords, supplierCounts, totalMid, totalLow, totalHigh }) {
    const byGroup = {};
    pricingRecords.forEach(p => {
        if (!byGroup[p.bop_category]) byGroup[p.bop_category] = { mid: 0, items: 0 };
        byGroup[p.bop_category].mid   += p.price_mid_usd || 0;
        byGroup[p.bop_category].items += 1;
    });

    const topItems = Object.entries(byGroup)
        .sort((a, b) => b[1].mid - a[1].mid)
        .slice(0, 8)
        .map(([cat, d]) => `  ${cat.replace(/_/g,' ')}: $${(d.mid/1000).toFixed(0)}K`)
        .join('\n');

    const prompt = `Generate a crisp executive procurement summary for the following BOP (Balance of Plant) procurement program:

Project: TG20B7-8 W251 Gas Turbine Power Island — Project Jupiter
Location: Santa Teresa, New Mexico, USA
Turbine: W251B8 class, ~50MW

BOP Cost Summary (±15% indicative):
  Low:  $${(totalLow/1e6).toFixed(2)}M
  Mid:  $${(totalMid/1e6).toFixed(2)}M  ← planning number
  High: $${(totalHigh/1e6).toFixed(2)}M

Top Cost Categories (mid):
${topItems}

Supplier Coverage:
  Total BOP suppliers identified: ${supplierCounts.total}
  Tier 1 (OEM/Major): ${supplierCounts.t1}
  Tier 2-3 (Specialty): ${supplierCounts.t2_t3}
  Tier 4 (Small/SME): ${supplierCounts.t4}

Write a 3-paragraph executive summary covering:
1. Program scope and budget position
2. Supply chain readiness (key suppliers, long-lead items, risks)
3. Recommended next actions for procurement team

Tone: Board-ready. Direct. No fluff.`;

    const systemPrompt = `You are the Chief Procurement Officer at Trans World Power (TWP). You write crisp, board-ready procurement summaries for gas turbine power plant projects.`;

    return query({ prompt, systemPrompt, maxTokens: 800 });
}

/**
 * Draft a supplier outreach strategy for a specific BOP category.
 */
async function draftOutreachStrategy({ category, suppliers, priceMid }) {
    const names = suppliers.map(s => s.name).join(', ');
    const prompt = `Create a brief supplier outreach strategy for the BOP category: **${category}**

Budget (mid indicative): $${(priceMid/1000).toFixed(0)}K
Known suppliers: ${names}

Provide:
1. Recommended outreach sequence (who to contact first, second, third)
2. Key technical questions to include in initial outreach
3. Commercial terms to lead with
4. What competitive tension to create between suppliers
5. Expected negotiation range from listed budget

Format as a short tactical action plan. 150 words max.`;

    return query({ prompt, maxTokens: 400 });
}

module.exports = {
    query,
    estimateCost,
    analyzePricingAnomalies,
    draftRFQ,
    compareSuppliers,
    crossValidateIntegrityCheck,
    generateProcurementSummary,
    draftOutreachStrategy,
    DEFAULT_MODEL
};
