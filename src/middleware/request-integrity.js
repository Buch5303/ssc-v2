'use strict';
const logger = require('../common/logger');

/**
 * Day 31: Request Integrity + Replay Protection
 *
 * Validates request nonce and timestamp to prevent replay attacks.
 * Each request must include x-request-nonce and x-request-timestamp.
 * Nonces are tracked per-org to detect reuse.
 *
 * In-memory for sql.js. PostgreSQL: use table with TTL cleanup.
 */

const _seenNonces = new Map(); // key: org_id:nonce → timestamp
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minute window
const MAX_NONCE_CACHE = 100000;

function validateRequestIntegrity(req, res, next) {
    // Optional in dev mode, mandatory in production
    if (process.env.NODE_ENV !== 'production') return next();

    const nonce = req.headers['x-request-nonce'];
    const timestamp = req.headers['x-request-timestamp'];

    if (!nonce || !timestamp) {
        return res.status(400).json({ error: 'request_integrity_failed', detail: 'x-request-nonce and x-request-timestamp required' });
    }

    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(ts) || Math.abs(now - ts) > MAX_AGE_MS) {
        return res.status(400).json({ error: 'request_integrity_failed', detail: 'timestamp outside acceptable window' });
    }

    const orgId = req.identity && req.identity.orgId || 'unknown';
    const nonceKey = orgId + ':' + nonce;

    if (_seenNonces.has(nonceKey)) {
        logger.warn('request-integrity', 'replay_detected', { org_id: orgId, nonce });
        return res.status(409).json({ error: 'replay_detected', detail: 'nonce already used' });
    }

    _seenNonces.set(nonceKey, now);

    // Cleanup old nonces
    if (_seenNonces.size > MAX_NONCE_CACHE) {
        const cutoff = now - MAX_AGE_MS;
        for (const [k, v] of _seenNonces) {
            if (v < cutoff) _seenNonces.delete(k);
        }
    }

    next();
}

/**
 * Service-level replay check (for internal/background calls).
 * Returns { valid: true } or { valid: false, error: string }.
 */
function checkReplayProtection(orgId, nonce, timestamp) {
    if (!nonce || !timestamp) return { valid: true }; // optional for internal calls
    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(ts) || Math.abs(now - ts) > MAX_AGE_MS) {
        return { valid: false, error: 'timestamp_outside_window' };
    }
    const nonceKey = (orgId || 'unknown') + ':' + nonce;
    if (_seenNonces.has(nonceKey)) {
        return { valid: false, error: 'nonce_already_used' };
    }
    _seenNonces.set(nonceKey, now);
    return { valid: true };
}

function resetNonceCache() { _seenNonces.clear(); }

module.exports = { validateRequestIntegrity, checkReplayProtection, resetNonceCache };
