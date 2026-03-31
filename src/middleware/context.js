'use strict';

function extractIdentity(req, _res, next) {
    req.identity = {
        userId: (req.user && req.user.id) || req.headers['x-user-id'] || null,
        orgId:  (req.org && req.org.id)   || req.headers['x-org-id']  || null,
    };
    next();
}

function requireIdentity(req, res, next) {
    if (!req.identity || !req.identity.userId) {
        return res.status(401).json({ error: 'actor_user_id_not_in_trusted_context' });
    }
    if (!req.identity.orgId) {
        return res.status(401).json({ error: 'org_id_not_in_trusted_context' });
    }
    next();
}

module.exports = { extractIdentity, requireIdentity };
