'use strict';

function requireAuthenticated(req, res, next) {
  if (!req.auth || !req.auth.userId || !req.auth.orgId) {
    return res.status(401).json({ error: 'authentication_required' });
  }
  next();
}

module.exports = { requireAuthenticated };
