'use strict';
const logger = require('../common/logger');

const NONCE_TTL_SECONDS = 300; // 5 minutes

async function checkNonce(redis, orgId, nonce, timestamp) {
    if (!redis) return { valid: true, source: 'no_redis' };
    if (!nonce || !timestamp) return { valid: true, source: 'no_nonce' };
    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(ts) || Math.abs(now - ts) > NONCE_TTL_SECONDS * 1000) {
        return { valid: false, error: 'timestamp_outside_window' };
    }
    try {
        const key = 'nonce:' + (orgId || 'anon') + ':' + nonce;
        const existed = await redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
        if (!existed) {
            logger.warn('redis-replay', 'nonce reuse detected', { org_id: orgId, nonce });
            return { valid: false, error: 'nonce_already_used' };
        }
        return { valid: true };
    } catch (err) {
        logger.error('redis-replay', 'check failed', { error: err.message });
        return { valid: true, source: 'redis_error_fail_open' };
    }
}

function replayProtectionMiddleware(redis) {
    return async (req, res, next) => {
        if (process.env.NODE_ENV !== 'production') return next();
        const nonce = req.headers['x-request-nonce'];
        const timestamp = req.headers['x-request-timestamp'];
        if (!nonce || !timestamp) return res.status(400).json({ error: 'request_integrity_failed', detail: 'x-request-nonce and x-request-timestamp required' });
        const orgId = req.identity && req.identity.orgId || 'anon';
        const result = await checkNonce(redis, orgId, nonce, timestamp);
        if (!result.valid) return res.status(409).json({ error: result.error });
        next();
    };
}

module.exports = { checkNonce, replayProtectionMiddleware, NONCE_TTL_SECONDS };
