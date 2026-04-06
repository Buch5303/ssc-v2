'use strict';

const logger = require('../common/logger');

/**
 * Day 29: Tenant Isolation Middleware
 *
 * Enforces org_id isolation at service level (belt).
 * PostgreSQL RLS enforces at DB level (suspenders).
 *
 * Every request MUST have a verified org_id from auth context.
 * This middleware:
 * 1. Validates org_id exists on req.identity
 * 2. Sets tenant context for DB RLS (PostgreSQL)
 * 3. Provides tenant-scoped query helpers
 */

function requireTenant(req, res, next) {
    if (!req.identity || !req.identity.orgId) {
        return res.status(403).json({ error: 'tenant_isolation_violation', detail: 'org_id required' });
    }
    req.tenantId = req.identity.orgId;
    next();
}

/**
 * setTenantContext — for PostgreSQL RLS.
 * Sets app.current_org_id session variable so RLS policies filter automatically.
 * No-op for SQLite.
 */
async function setTenantContext(db, orgId) {
    if (!orgId) throw new Error('TENANT_VIOLATION: org_id required');
    if (db && typeof db.query === 'function') {
        await db.query("SET LOCAL app.current_org_id = $1", [orgId]);
    }
    // SQLite: no-op (tenant isolation enforced in application layer)
}

/**
 * validateTenantAccess — verify a row belongs to the requesting org.
 * Defense-in-depth check used by services before returning data.
 */
function validateTenantAccess(row, orgId) {
    if (!row) return false;
    if (!orgId) return false;
    return row.org_id === orgId;
}

/**
 * scopedQuery — wraps a query to always include org_id filter.
 * Prevents accidental cross-tenant queries.
 */
function scopedQuery(db, sql, params, orgId) {
    if (!orgId) throw new Error('TENANT_VIOLATION: org_id required for scoped query');
    // The caller must include org_id in their WHERE clause.
    // This function validates the pattern is followed.
    if (!sql.includes('org_id')) {
        throw new Error('TENANT_VIOLATION: query must filter by org_id');
    }
    return db.prepare(sql).all(...params);
}

module.exports = { requireTenant, setTenantContext, validateTenantAccess, scopedQuery };
