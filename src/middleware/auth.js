'use strict';
const jwt = require('jsonwebtoken');
const { verifyAccessToken } = require('./token-service');

const VALID_MODES = new Set(['headers', 'jwt']);

async function authenticate(req, res, next) {
    try {
        const mode = process.env.AUTH_MODE || null;
        if (!mode || !VALID_MODES.has(mode)) {
            return res.status(500).json({ error: 'auth_configuration_error', detail: 'AUTH_MODE must be "headers" or "jwt"' });
        }
        if (mode === 'headers') return _authHeaders(req, res, next);
        return await _authJwt(req, res, next);
    } catch (err) {
        return res.status(500).json({ error: 'auth_internal_error', detail: err.message });
    }
}

function _authHeaders(req, res, next) {
    const userId = req.headers['x-user-id'] || null;
    const orgId  = req.headers['x-org-id']  || null;
    if (!userId || !orgId) {
        return res.status(401).json({ error: 'authentication_required', detail: 'x-user-id and x-org-id headers required' });
    }
    req.auth = { userId, orgId, mode: 'headers' };
    next();
}

async function _authJwt(req, res, next) {
    const secret = process.env.JWT_SECRET || null;
    if (!secret) {
        return res.status(500).json({ error: 'auth_configuration_error', detail: 'JWT_SECRET not configured' });
    }
    const hdr = req.headers.authorization;
    if (!hdr || !hdr.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'authentication_required', detail: 'Authorization: Bearer <token> required' });
    }
    const token = hdr.slice(7);
    if (!token) {
        return res.status(401).json({ error: 'authentication_required', detail: 'empty token' });
    }

    // Verify signature + expiry + revocation status
    const result = await verifyAccessToken(token);
    if (!result.success) {
        const status = result.error === 'token_revoked' ? 401 : 401;
        return res.status(status).json({ error: 'authentication_failed', detail: result.error });
    }

    const payload = result.payload;
    const userId = payload.sub || payload.user_id || null;
    const orgId  = payload.org_id || null;
    if (!userId || !orgId) {
        return res.status(401).json({ error: 'authentication_failed', detail: 'token must contain sub (or user_id) and org_id claims' });
    }
    req.auth = { userId, orgId, mode: 'jwt', jti: payload.jti || null };
    next();
}

function signToken(payload, secret, options = {}) {
    return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: options.expiresIn || '1h', ...options });
}

module.exports = { authenticate, signToken, VALID_MODES };
