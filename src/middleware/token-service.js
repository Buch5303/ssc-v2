'use strict';
const jwt = require('jsonwebtoken');
const logger = require('../common/logger');
const metrics = require('../common/metrics');

/**
 * Day 35: Token Service — Short-lived access + refresh tokens
 *
 * Access tokens: 15 min lifetime (configurable via ACCESS_TOKEN_TTL)
 * Refresh tokens: 7 day lifetime (configurable via REFRESH_TOKEN_TTL)
 * Revocation: in-memory blocklist (Redis-backed when REDIS_URL set)
 *
 * This replaces the long-lived HS256 posture for pilot-facing users.
 */

const ACCESS_TTL = parseInt(process.env.ACCESS_TOKEN_TTL, 10) || 900; // 15 min
const REFRESH_TTL = parseInt(process.env.REFRESH_TOKEN_TTL, 10) || 604800; // 7 days

// Revocation blocklist: token jti → expiry timestamp
const _blocklist = new Map();
let _redis = null;

function setRedis(redis) { _redis = redis; }

function _secret() {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET not configured');
    return s;
}

function _refreshSecret() {
    return (process.env.JWT_REFRESH_SECRET || _secret()) + '_refresh';
}

function _generateJti() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
}

function issueTokenPair(userId, orgId, claims = {}) {
    if (!userId || !orgId) return { success: false, error: 'user_id_and_org_id_required' };

    const jti = _generateJti();
    const refreshJti = _generateJti();

    const accessToken = jwt.sign(
        { sub: userId, org_id: orgId, jti, type: 'access', ...claims },
        _secret(),
        { expiresIn: ACCESS_TTL }
    );

    const refreshToken = jwt.sign(
        { sub: userId, org_id: orgId, jti: refreshJti, type: 'refresh', access_jti: jti },
        _refreshSecret(),
        { expiresIn: REFRESH_TTL }
    );

    metrics.increment('tokens.issued');
    return {
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        access_expires_in: ACCESS_TTL,
        refresh_expires_in: REFRESH_TTL,
        token_type: 'Bearer',
    };
}

async function refreshAccessToken(refreshTokenStr) {
    try {
        const payload = jwt.verify(refreshTokenStr, _refreshSecret());
        if (payload.type !== 'refresh') return { success: false, error: 'not_a_refresh_token' };

        // Check if refresh token is revoked
        if (await isRevoked(payload.jti)) {
            return { success: false, error: 'refresh_token_revoked' };
        }

        // Check if the old access token's jti was revoked (token family revocation)
        if (payload.access_jti && await isRevoked(payload.access_jti)) {
            // Possible token reuse attack — revoke the refresh token too
            await revokeToken(payload.jti, REFRESH_TTL);
            logger.warn('token-service', 'token_reuse_detected', { user_id: payload.sub, org_id: payload.org_id });
            metrics.increment('tokens.reuse_detected');
            return { success: false, error: 'token_reuse_detected' };
        }

        // Issue new pair, revoke old access token
        const result = issueTokenPair(payload.sub, payload.org_id);
        if (result.success && payload.access_jti) {
            await revokeToken(payload.access_jti, ACCESS_TTL);
        }

        metrics.increment('tokens.refreshed');
        return result;
    } catch (err) {
        if (err.name === 'TokenExpiredError') return { success: false, error: 'refresh_token_expired' };
        if (err.name === 'JsonWebTokenError') return { success: false, error: 'invalid_refresh_token' };
        return { success: false, error: err.message };
    }
}

async function revokeToken(jti, ttl) {
    if (!jti) return;
    const expiry = Date.now() + (ttl || ACCESS_TTL) * 1000;
    _blocklist.set(jti, expiry);

    if (_redis) {
        try { await _redis.set('revoked:' + jti, '1', 'EX', ttl || ACCESS_TTL); }
        catch (err) { logger.error('token-service', 'redis revoke failed', { error: err.message }); }
    }
    metrics.increment('tokens.revoked');
}

async function isRevoked(jti) {
    if (!jti) return false;

    // Check Redis first
    if (_redis) {
        try {
            const val = await _redis.get('revoked:' + jti);
            if (val) return true;
        } catch { /* fall through to in-memory */ }
    }

    // In-memory fallback
    const expiry = _blocklist.get(jti);
    if (!expiry) return false;
    if (Date.now() > expiry) { _blocklist.delete(jti); return false; }
    return true;
}

async function verifyAccessToken(tokenStr) {
    try {
        const payload = jwt.verify(tokenStr, _secret());
        if (payload.type && payload.type !== 'access') {
            return { success: false, error: 'not_an_access_token' };
        }
        if (payload.jti && await isRevoked(payload.jti)) {
            return { success: false, error: 'token_revoked' };
        }
        return { success: true, payload };
    } catch (err) {
        if (err.name === 'TokenExpiredError') return { success: false, error: 'token_expired' };
        if (err.name === 'JsonWebTokenError') return { success: false, error: 'invalid_token' };
        return { success: false, error: err.message };
    }
}

function cleanupBlocklist() {
    const now = Date.now();
    for (const [jti, expiry] of _blocklist) {
        if (now > expiry) _blocklist.delete(jti);
    }
}

function resetBlocklist() { _blocklist.clear(); }

module.exports = {
    issueTokenPair, refreshAccessToken, revokeToken, isRevoked,
    verifyAccessToken, setRedis, cleanupBlocklist, resetBlocklist,
    ACCESS_TTL, REFRESH_TTL,
};

// verified present in tree — 2026-04-07T01:16:44Z
