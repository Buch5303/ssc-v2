'use strict';
/**
 * Perplexity Sonar API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time web search with citations — used as a second-opinion integrity
 * layer for FlowSeer supplier data, pricing, and market intelligence.
 *
 * Models:
 *   sonar            — fast, cheap, real-time web search. Good for quick checks.
 *   sonar-pro        — deeper reasoning, more sources. Good for pricing validation.
 *   sonar-deep-research — multi-step research. Good for net-new supplier discovery.
 *
 * API: https://api.perplexity.ai/chat/completions (OpenAI-compatible)
 * Pricing: sonar ~$1/1M tokens · sonar-pro ~$3/$15 · deep-research ~$8/$8
 */

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

function getApiKey() {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) throw new Error('PERPLEXITY_API_KEY not set in environment');
    return key;
}

/**
 * Core query function — sends a prompt to Perplexity and returns the answer + citations.
 */
async function query({ prompt, model = 'sonar', systemPrompt, maxTokens = 1024 }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(PERPLEXITY_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.1,   // low temp = factual, consistent
            return_citations: true,
            return_related_questions: false
        })
    });

    if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        throw new Error(`Perplexity API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    const usage = data.usage || {};

    return { content, citations, usage, model, raw: data };
}

// ─── INTEGRITY CHECK FUNCTIONS ────────────────────────────────────────────────

/**
 * Verify a supplier is active, correctly described, and flag any changes.
 */
async function checkSupplierIntegrity({ name, domain, description, bopCategory, revenue, parent }) {
    const prompt = `Verify the following industrial supplier and provide a brief integrity check as of April 2026:

Company: ${name}
Domain: ${domain || 'unknown'}
BOP Category: ${bopCategory || 'power generation / industrial'}
Reported Revenue: ${revenue ? '$' + (revenue / 1e6).toFixed(0) + 'M' : 'unknown'}
Parent Company: ${parent || 'unknown'}

Please confirm:
1. Is this company currently active and operating? (Yes/No + brief explanation)
2. Is the parent company / ownership correct?
3. Are they a recognized supplier to the industrial gas turbine / power generation sector?
4. Any recent news: acquisitions, shutdowns, financial distress, major contracts, or leadership changes in 2025-2026?
5. Overall integrity score: HIGH / MEDIUM / LOW confidence in the data quality

Keep response concise and factual. Include source citations.`;

    const systemPrompt = `You are an industrial supply chain intelligence analyst. Verify supplier data for a gas turbine power generation procurement program. Be factual, concise, and cite sources. Focus on current status as of 2026.`;

    return query({ prompt, systemPrompt, model: 'sonar', maxTokens: 512 });
}

/**
 * Cross-check a pricing record against current market intelligence.
 */
async function checkPricingIntegrity({ partDescription, bopCategory, priceMid, priceRange, sourceSupplier }) {
    const prompt = `Validate the following indicative pricing for a 50MW industrial gas turbine (W251/TG20 class) power plant procurement, as of Q1 2026:

Part/System: ${partDescription}
BOP Category: ${bopCategory}
Indicative Mid Price: $${(priceMid / 1000).toFixed(0)}K USD
Price Range: $${(priceRange.low / 1000).toFixed(0)}K – $${(priceRange.high / 1000).toFixed(0)}K USD
Source Suppliers: ${sourceSupplier}

Please assess:
1. Does this price range appear reasonable for this equipment in today's market?
2. Any current market factors affecting pricing (supply chain, lead times, inflation, demand)?
3. Key suppliers in this space currently active and competitive?
4. Pricing confidence: VALIDATED / REASONABLE / QUESTIONABLE / UNABLE_TO_VERIFY

Be concise. Cite sources where available.`;

    const systemPrompt = `You are a power generation equipment procurement specialist with expertise in BOP (Balance of Plant) pricing for industrial gas turbines. Validate pricing for a W251 class turbine procurement program.`;

    return query({ prompt, systemPrompt, model: 'sonar-pro', maxTokens: 512 });
}

/**
 * Discover net-new suppliers for a BOP category not yet in the database.
 */
async function discoverSuppliers({ bopCategory, keywords, existingSuppliers = [] }) {
    const existing = existingSuppliers.slice(0, 10).join(', ');
    const prompt = `Find current manufacturers and suppliers for the following industrial gas turbine Balance of Plant (BOP) system, as of 2026:

System Category: ${bopCategory}
Search Keywords: ${keywords.join(', ')}
Already known suppliers (exclude these): ${existing || 'none'}

Please identify:
1. Up to 8 manufacturers/suppliers currently active in this space — both large (Tier 1) and smaller specialty suppliers (Tier 2-4)
2. For each: company name, headquarters country, approximate revenue/size if known, and why they are relevant
3. Any notable recent developments (new entrants, consolidation, capacity expansions)?

Format as a numbered list. Focus on industrial power generation suppliers active in 2025-2026.`;

    const systemPrompt = `You are an industrial procurement specialist focused on gas turbine power plant Balance of Plant equipment. Identify current, active manufacturers globally.`;

    return query({ prompt, systemPrompt, model: 'sonar-pro', maxTokens: 1024 });
}

/**
 * Verify an executive contact is still in their role.
 */
async function checkContactCurrency({ name, title, company, domain }) {
    const prompt = `Verify whether the following person is currently in their reported role as of early 2026:

Name: ${name}
Title: ${title}
Company: ${company}
Domain: ${domain || ''}

1. Is this person still in this role? (Current / Likely Changed / Unknown)
2. Any LinkedIn or press evidence of role change?
3. If they've moved, any indication of new role/company?

Keep response brief and factual.`;

    return query({ prompt, model: 'sonar', maxTokens: 256 });
}

/**
 * Get a market intelligence briefing for a BOP category.
 */
async function getMarketBriefing({ bopCategory, categoryName }) {
    const prompt = `Provide a brief market intelligence update for the following power plant equipment category as of Q1-Q2 2026:

Category: ${categoryName} (${bopCategory})
Context: Procurement for a 50MW industrial gas turbine power plant (W251/TG20 class)

Cover:
1. Current market conditions (tight/loose supply, lead times, pricing trends)
2. Key dominant suppliers and market share
3. Notable developments in 2025-2026 (consolidation, new entrants, technology changes)
4. Any supply chain risks or opportunities

Keep concise — 3-4 key bullets per section. Cite sources.`;

    const systemPrompt = `You are a power generation equipment market analyst providing procurement intelligence for an industrial gas turbine project in 2026.`;

    return query({ prompt, systemPrompt, model: 'sonar-pro', maxTokens: 768 });
}

/**
 * Parse a Perplexity response to extract a structured integrity score.
 */
function parseIntegrityScore(content) {
    const upper = content.toUpperCase();
    if (upper.includes('HIGH') && (upper.includes('CONFIDENCE') || upper.includes('INTEGRITY'))) return 'HIGH';
    if (upper.includes('MEDIUM') && (upper.includes('CONFIDENCE') || upper.includes('INTEGRITY'))) return 'MEDIUM';
    if (upper.includes('LOW') && (upper.includes('CONFIDENCE') || upper.includes('INTEGRITY'))) return 'LOW';
    if (upper.includes('VALIDATED')) return 'VALIDATED';
    if (upper.includes('REASONABLE')) return 'REASONABLE';
    if (upper.includes('QUESTIONABLE')) return 'QUESTIONABLE';
    if (upper.includes('ACTIVE') || upper.includes('CURRENTLY OPERATING')) return 'ACTIVE';
    return 'UNKNOWN';
}

module.exports = {
    query,
    checkSupplierIntegrity,
    checkPricingIntegrity,
    discoverSuppliers,
    checkContactCurrency,
    getMarketBriefing,
    parseIntegrityScore
};
