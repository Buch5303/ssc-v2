'use strict';

const logger = require('../common/logger');

/**
 * Day 28: Rate Limiting Middleware
 *
 * Per-org, per-action sliding window rate limiter.
 * Uses database for persistence across restarts.
 * Fail-open on DB errors (logs warning, does not block).
 */

const DEFAULT_LIMITS = Object.freeze({
    'approval:approve': { max: 100, window_minutes: 60 },
    'approval:reject':  { max: 100, window_minutes: 60 },
    'workflow:execute':  { max: 200, window_minutes: 60 },
    'workflow:replay':   { max: 50,  window_minutes: 60 },
    '_default':          { max: 300, window_minutes: 60 },
});

function _windowKey(minutes) {
    const now = new Date();
    const epoch = Math.floor(now.getTime() / (minutes * 60000));
    return epoch.toString();
}

function checkRateLimit(db, orgId, actionKey) {
    try {
        if (!db || !orgId) return { allowed: true };

        const config = DEFAULT_LIMITS[actionKey] || DEFAULT_LIMITS['_default'];
        const windowStart = _windowKey(config.window_minutes);
        const key = actionKey;

        // Upsert: increment or insert
        const existing = db.prepare(
            'SELECT count FROM rate_limit_entries WHERE key = ? AND org_id = ? AND window_start = ?'
        ).get(key, orgId, windowStart);

        if (existing) {
            if (existing.count >= config.max) {
                logger.warn('rate-limit', 'rate limit exceeded', { org_id: orgId, action: actionKey, count: existing.count, max: config.max });
                return { allowed: false, error: 'rate_limit_exceeded', current: existing.count, max: config.max, retry_after_minutes: config.window_minutes };
            }
            db.prepare(
                'UPDATE rate_limit_entries SET count = count + 1 WHERE key = ? AND org_id = ? AND window_start = ?'
            ).run(key, orgId, windowStart);
            return { allowed: true, current: existing.count + 1, max: config.max };
        }

        db.prepare(
            'INSERT OR IGNORE INTO rate_limit_entries (key, org_id, window_start, count) VALUES (?, ?, ?, 1)'
        ).run(key, orgId, windowStart);
        return { allowed: true, current: 1, max: config.max };
    } catch (err) {
        // Fail-open: rate limit DB error should not block business operations
        logger.error('rate-limit', 'rate limit check failed', { error: err.message });
        return { allowed: true, error: 'rate_limit_check_failed' };
    }
}

function rateLimitMiddleware(db, actionKeyFn) {
    return (req, res, next) => {
        if (!req.identity || !req.identity.orgId) return next();
        const actionKey = typeof actionKeyFn === 'function' ? actionKeyFn(req) : (actionKeyFn || '_default');
        const result = checkRateLimit(db, req.identity.orgId, actionKey);
        if (!result.allowed) {
            return res.status(429).json({ error: 'rate_limit_exceeded', retry_after_minutes: result.retry_after_minutes });
        }
        next();
    };
}

function cleanupExpiredWindows(db, olderThanMinutes) {
    try {
        const cutoff = _windowKey(olderThanMinutes || 120);
        db.prepare('DELETE FROM rate_limit_entries WHERE window_start < ?').run(cutoff);
    } catch (err) {
        logger.error('rate-limit', 'cleanup failed', { error: err.message });
    }
}

module.exports = { checkRateLimit, rateLimitMiddleware, cleanupExpiredWindows, DEFAULT_LIMITS };
