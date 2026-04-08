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
