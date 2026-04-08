'use strict';
/**
 * Wave 8 Intelligence Response Envelope — EQS v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Every intelligence endpoint response is wrapped in this contract envelope.
 * Consumers (dashboard, API clients, Grok audits) can rely on consistent
 * metadata without parsing response bodies.
 *
 * Output types:
 *   verified   — data confirmed by external authoritative source (Perplexity w/ citations)
 *   derived    — computed from verified data (pricing rollup, tier stats)
 *   generated  — AI-synthesized analysis (Claude outputs)
 *   estimated  — indicative / web-researched, not formally RFQ'd
 *   seeded     — loaded from internal static dataset, not live-fetched
 *   cached     — previously live-fetched, served from DB cache
 *   placeholder — not yet available (engine not active)
 *
 * Freshness states:
 *   live       — fetched this request from external API
 *   cached     — served from DB, within TTL
 *   seeded     — from static in-memory seeded data
 *   stale      — served from DB, TTL expired
 *   unavailable — engine not configured or down
 *
 * Readiness states:
 *   operational       — engine active, API key present, DB healthy
 *   awaiting_key      — API key missing from environment
 *   degraded          — engine active but some sub-systems down
 *   offline           — engine completely unavailable
 */

const CONTRACT_VERSION = '1.0';

/**
 * Wrap any intelligence result in the standard envelope.
 */
function envelope({
    engine,
    module: mod,
    outputType,
    freshness,
    sourceSummary,
    readiness,
    data,
    meta = {},
    error = null
}) {
    return {
        _envelope: {
            contract_version: CONTRACT_VERSION,
            engine,
            module: mod || engine,
            timestamp: new Date().toISOString(),
            freshness,          // live | cached | seeded | stale | unavailable
            output_type: outputType, // verified | derived | generated | estimated | seeded | cached | placeholder
            source_summary: sourceSummary,
            readiness,          // operational | awaiting_key | degraded | offline
            error: error || undefined
        },
        ...(data || {})
    };
}

/**
 * Check if an API key is present in environment.
 * Returns readiness string, never throws.
 */
function keyReadiness(envVar) {
    return process.env[envVar] ? 'operational' : 'awaiting_key';
}

/**
 * Build a disabled-engine placeholder response.
 * Used when an API key is missing — never shows dead controls as live.
 */
function disabledEnvelope({ engine, mod, envVar, hint }) {
    return envelope({
        engine,
        module: mod || engine,
        outputType: 'placeholder',
        freshness: 'unavailable',
        sourceSummary: `${envVar} not configured`,
        readiness: 'awaiting_key',
        data: {
            ok: false,
            activated: false,
            activation_required: envVar,
            hint: hint || `Add ${envVar} to Vercel environment variables to activate this engine.`,
            activation_url: 'https://vercel.com/gregory-j-buchanans-projects/ssc-v2/settings/environment-variables'
        }
    });
}

/**
 * Wrap a successful intelligence result.
 */
function successEnvelope({ engine, mod, outputType, freshness, sourceSummary, data }) {
    return envelope({
        engine,
        module: mod || engine,
        outputType,
        freshness,
        sourceSummary,
        readiness: 'operational',
        data: { ok: true, ...data }
    });
}

/**
 * Wrap an error result.
 */
function errorEnvelope({ engine, mod, error, readiness = 'degraded' }) {
    return envelope({
        engine,
        module: mod,
        outputType: 'placeholder',
        freshness: 'unavailable',
        sourceSummary: 'Error during execution',
        readiness,
        data: { ok: false },
        error: error?.message || String(error)
    });
}

module.exports = { envelope, keyReadiness, disabledEnvelope, successEnvelope, errorEnvelope, CONTRACT_VERSION };

// ─── OUTPUT TYPE CONSTANTS ────────────────────────────────────────────────────
// Use these everywhere — no freehand strings. Enforces semantic discipline.
const OUTPUT_TYPES = {
    VERIFIED:           'verified',       // External source confirmed with citations
    DERIVED:            'derived',        // Computed from verified/seeded data
    GENERATED_ANALYSIS: 'generated_analysis',      // Claude: anomaly detect, exec summary
    GENERATED_RECOMMENDATION: 'generated_recommendation', // Claude: compare, outreach
    GENERATED_DRAFT:    'generated_draft', // Claude: RFQ email, language output
    ESTIMATED:          'estimated',      // Web-researched ±15% pricing bands
    SEEDED:             'seeded',         // From static in-memory dataset
    CACHED:             'cached',         // Previously live-fetched, served from DB
    PLACEHOLDER:        'placeholder',    // Engine not active
};

const FRESHNESS = {
    LIVE:        'live',        // Fetched this request from external API
    CACHED:      'cached',      // Served from DB within TTL
    SEEDED:      'seeded',      // From static in-memory seeded data
    STALE:       'stale',       // Served from DB, TTL expired
    UNAVAILABLE: 'unavailable', // Engine not configured or down
};

/**
 * Perplexity-specific: wrap result with verified or derived typing
 * based on whether citations are present.
 */
function perplexityEnvelope({ mod, result, data, cached = false }) {
    const hasCitations = Array.isArray(result?.citations) && result.citations.length > 0;
    return successEnvelope({
        engine: 'FlowSeer Integrity Engine',
        mod: mod || 'perplexity_sonar',
        outputType: hasCitations ? OUTPUT_TYPES.VERIFIED : OUTPUT_TYPES.DERIVED,
        freshness: cached ? FRESHNESS.CACHED : FRESHNESS.LIVE,
        sourceSummary: hasCitations
            ? `Perplexity Sonar — ${result.citations.length} web citation(s)`
            : `Perplexity Sonar — no citations returned`,
        data: {
            ...data,
            citations: result?.citations || [],
            tokens_used: result?.usage?.total_tokens,
            cost_usd: result?.usage ? undefined : undefined,
            model: result?.model,
        }
    });
}

/**
 * Claude-specific: wrap result with appropriate generated typing.
 */
function claudeEnvelope({ mod, outputType, result, data }) {
    return successEnvelope({
        engine: 'Claude Intelligence Engine',
        mod: mod || 'claude_sonnet',
        outputType: outputType || OUTPUT_TYPES.GENERATED_ANALYSIS,
        freshness: FRESHNESS.LIVE,
        sourceSummary: `Claude ${result?.model || 'claude-sonnet-4-6'} — AI-generated`,
        data: {
            ...data,
            input_tokens:  result?.usage?.input_tokens,
            output_tokens: result?.usage?.output_tokens,
            model:         result?.model,
        }
    });
}

/**
 * Discovery-specific: wrap seeded or derived data.
 */
function discoveryEnvelope({ mod, outputType, freshness, sourceSummary, data }) {
    return successEnvelope({
        engine: 'FlowSeer Discovery Engine',
        mod: mod || 'discovery',
        outputType: outputType || OUTPUT_TYPES.SEEDED,
        freshness: freshness || FRESHNESS.SEEDED,
        sourceSummary: sourceSummary || 'FlowSeer seeded supplier + pricing database',
        data
    });
}

module.exports = {
    envelope, keyReadiness, disabledEnvelope, successEnvelope, errorEnvelope,
    perplexityEnvelope, claudeEnvelope, discoveryEnvelope,
    OUTPUT_TYPES, FRESHNESS,
    CONTRACT_VERSION
};
