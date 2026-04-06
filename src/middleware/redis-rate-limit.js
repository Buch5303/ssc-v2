'use strict';
const logger = require('../common/logger');

const DEFAULT_LIMITS = Object.freeze({
    'approval:approve': { max: 100, window_seconds: 3600 },
    'approval:reject':  { max: 100, window_seconds: 3600 },
    'workflow:execute':  { max: 200, window_seconds: 3600 },
    'workflow:replay':   { max: 50,  window_seconds: 3600 },
    '_default':          { max: 300, window_seconds: 3600 },
});

async function checkRateLimit(redis, orgId, actionKey) {
    if (!redis || !orgId) return { allowed: true, source: 'no_redis' };
    try {
        const config = DEFAULT_LIMITS[actionKey] || DEFAULT_LIMITS['_default'];
        const key = 'rl:' + orgId + ':' + actionKey;
        const current = await redis.incr(key);
        if (current === 1) await redis.expire(key, config.window_seconds);
        if (current > config.max) {
            const ttl = await redis.ttl(key);
            logger.warn('redis-rate-limit', 'exceeded', { org_id: orgId, action: actionKey, current, max: config.max });
            return { allowed: false, error: 'rate_limit_exceeded', current, max: config.max, retry_after_seconds: ttl > 0 ? ttl : config.window_seconds };
        }
        return { allowed: true, current, max: config.max };
    } catch (err) {
        logger.error('redis-rate-limit', 'check failed', { error: err.message });
        return { allowed: true, source: 'redis_error_fail_open' };
    }
}

function rateLimitMiddleware(redis, actionKeyFn) {
    return async (req, res, next) => {
        if (!req.identity || !req.identity.orgId) return next();
        const actionKey = typeof actionKeyFn === 'function' ? actionKeyFn(req) : '_default';
        const result = await checkRateLimit(redis, req.identity.orgId, actionKey);
        if (!result.allowed) return res.status(429).json({ error: 'rate_limit_exceeded', retry_after_seconds: result.retry_after_seconds });
        next();
    };
}

module.exports = { checkRateLimit, rateLimitMiddleware, DEFAULT_LIMITS };
