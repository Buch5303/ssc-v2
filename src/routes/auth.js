'use strict';

/**
 * Auth routes — /api/auth/token, /api/auth/refresh, /api/auth/revoke
 * All endpoints are public (no authenticate middleware).
 * Token issuance, rotation, and revocation via token-service.js.
 */

const tokenService = require('../middleware/token-service');

module.exports = function createAuthRoutes(app) {
    // POST /api/auth/token — issue access + refresh token pair
    app.post('/api/auth/token', async (req, res) => {
        try {
            const { user_id, org_id, role } = req.body;
            if (!user_id || !org_id) return res.status(400).json({ error: 'user_id_and_org_id_required' });
            const tokens = await tokenService.issueTokens({ user_id, org_id, role: role || 'user' });
            return res.json(tokens);
        } catch (err) {
            return res.status(500).json({ error: 'token_issuance_failed', detail: err.message });
        }
    });

    // POST /api/auth/refresh — rotate refresh token, issue new access token
    app.post('/api/auth/refresh', async (req, res) => {
        try {
            const { refresh_token } = req.body;
            if (!refresh_token) return res.status(400).json({ error: 'refresh_token_required' });
            const result = await tokenService.refreshTokens(refresh_token);
            if (!result.success) return res.status(401).json({ error: result.error });
            return res.json(result);
        } catch (err) {
            return res.status(500).json({ error: 'refresh_failed', detail: err.message });
        }
    });

    // POST /api/auth/revoke — revoke a token by jti (adds to blocklist)
    app.post('/api/auth/revoke', async (req, res) => {
        try {
            const { token } = req.body;
            if (!token) return res.status(400).json({ error: 'token_required' });
            const decoded = require('jsonwebtoken').decode(token);
            if (!decoded || !decoded.jti) return res.status(400).json({ error: 'invalid_token' });
            await tokenService.revokeToken(decoded.jti, decoded.exp - Math.floor(Date.now() / 1000));
            return res.json({ revoked: true, jti: decoded.jti });
        } catch (err) {
            return res.status(500).json({ error: 'revoke_failed', detail: err.message });
        }
    });
};
