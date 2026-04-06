'use strict';
function requireAuthenticated(req, res, next) {
    if (!req.auth) { return res.status(401).json({ error: 'authentication_required', detail: 'no authenticated identity' }); }
    if (!req.auth.userId) { return res.status(401).json({ error: 'authentication_required', detail: 'identity missing userId' }); }
    if (!req.auth.orgId) { return res.status(401).json({ error: 'authorization_failed', detail: 'identity missing orgId' }); }
    next();
}
const requireOrgScoped = requireAuthenticated;
module.exports = { requireAuthenticated, requireOrgScoped };
