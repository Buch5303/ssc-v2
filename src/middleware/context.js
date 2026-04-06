'use strict';
function extractIdentity(req, _res, next) {
    if (!req.auth) { req.identity = null; return next(); }
    req.identity = { userId: req.auth.userId || null, orgId: req.auth.orgId || null };
    next();
}
function requireIdentity(req, res, next) {
    if (!req.identity || !req.identity.userId) { return res.status(401).json({ error: 'actor_user_id_not_in_trusted_context' }); }
    if (!req.identity.orgId) { return res.status(401).json({ error: 'org_id_not_in_trusted_context' }); }
    next();
}
module.exports = { extractIdentity, requireIdentity };
