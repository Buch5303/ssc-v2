'use strict';
const logger = require('../common/logger');

function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
function _row(r) { if (!r) return null; return { ...r, metadata_json: _jp(r.metadata_json) }; }
function _clamp(v, min, max, fb) { const n = parseInt(v, 10); return isNaN(n) ? fb : Math.max(min, Math.min(max, n)); }

const VALID_SORT_FIELDS = {
    supplier: ['name', 'supplier_code', 'status', 'country', 'rating', 'created_at'],
    part: ['part_number', 'category', 'criticality', 'lead_time_days', 'created_at'],
    order: ['po_number', 'status', 'total_value', 'required_date', 'created_at'],
    shipment: ['shipment_number', 'status', 'eta', 'delivered_at', 'created_at'],
    certification: ['cert_type', 'status', 'issued_at', 'expires_at', 'created_at'],
    inspection: ['result', 'defects_count', 'created_at']
};

function _sort(sortBy, sortDir, entity) {
    const allowed = VALID_SORT_FIELDS[entity] || ['created_at'];
    const field = allowed.includes(sortBy) ? sortBy : 'created_at';
    const dir = String(sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    return { field, dir };
}

// ═══════════════════════════════════════════════════════════
// ADVANCED FILTER QUERIES
// ═══════════════════════════════════════════════════════════

async function querySuppliers(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.category) { c.push('category = ?'); p.push(filters.category); }
    if (filters.country) { c.push('country = ?'); p.push(filters.country); }
    if (filters.min_rating !== undefined) { c.push('rating >= ?'); p.push(filters.min_rating); }
    if (filters.search) { c.push('(name LIKE ? OR supplier_code LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'supplier');

    const total = await db.prepare('SELECT COUNT(*) as total FROM suppliers WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM suppliers WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, suppliers: (rows || []).map(_row), total: total.total };
}

async function queryParts(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.category) { c.push('category = ?'); p.push(filters.category); }
    if (filters.criticality) { c.push('criticality = ?'); p.push(filters.criticality); }
    if (filters.supplier_id) { c.push('supplier_id = ?'); p.push(filters.supplier_id); }
    if (filters.max_lead_time !== undefined) { c.push('lead_time_days <= ?'); p.push(filters.max_lead_time); }
    if (filters.search) { c.push('(part_number LIKE ? OR description LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'part');

    const total = await db.prepare('SELECT COUNT(*) as total FROM parts WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM parts WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, parts: (rows || []).map(_row), total: total.total };
}

async function queryOrders(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.supplier_id) { c.push('supplier_id = ?'); p.push(filters.supplier_id); }
    if (filters.min_value !== undefined) { c.push('total_value >= ?'); p.push(filters.min_value); }
    if (filters.max_value !== undefined) { c.push('total_value <= ?'); p.push(filters.max_value); }
    if (filters.required_after) { c.push('required_date >= ?'); p.push(filters.required_after); }
    if (filters.required_before) { c.push('required_date <= ?'); p.push(filters.required_before); }
    if (filters.search) { c.push('(po_number LIKE ? OR notes LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'order');

    const total = await db.prepare('SELECT COUNT(*) as total FROM purchase_orders WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM purchase_orders WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, orders: (rows || []).map(_row), total: total.total };
}

async function queryShipments(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.carrier) { c.push('carrier = ?'); p.push(filters.carrier); }
    if (filters.po_id) { c.push('po_id = ?'); p.push(filters.po_id); }
    if (filters.eta_after) { c.push('eta >= ?'); p.push(filters.eta_after); }
    if (filters.eta_before) { c.push('eta <= ?'); p.push(filters.eta_before); }
    if (filters.search) { c.push('(shipment_number LIKE ? OR tracking_number LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'shipment');

    const total = await db.prepare('SELECT COUNT(*) as total FROM shipments WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM shipments WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, shipments: (rows || []).map(_row), total: total.total };
}

async function queryCertifications(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.cert_type) { c.push('cert_type = ?'); p.push(filters.cert_type); }
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.supplier_id) { c.push('supplier_id = ?'); p.push(filters.supplier_id); }
    if (filters.expiring_before) { c.push('expires_at <= ?'); p.push(filters.expiring_before); }
    if (filters.expiring_after) { c.push('expires_at >= ?'); p.push(filters.expiring_after); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'certification');

    const total = await db.prepare('SELECT COUNT(*) as total FROM certifications WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM certifications WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, certifications: (rows || []).map(_row), total: total.total };
}

async function queryInspections(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.result) { c.push('result = ?'); p.push(filters.result); }
    if (filters.shipment_id) { c.push('shipment_id = ?'); p.push(filters.shipment_id); }
    if (filters.inspector_user_id) { c.push('inspector_user_id = ?'); p.push(filters.inspector_user_id); }
    if (filters.date_after) { c.push('inspection_date >= ?'); p.push(filters.date_after); }
    if (filters.date_before) { c.push('inspection_date <= ?'); p.push(filters.date_before); }
    if (filters.min_defects !== undefined) { c.push('defect_count >= ?'); p.push(filters.min_defects); }

    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const s = _sort(filters.sort_by, filters.sort_dir, 'inspection');

    const total = await db.prepare('SELECT COUNT(*) as total FROM inspections WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM inspections WHERE ' + c.join(' AND ') + ' ORDER BY ' + s.field + ' ' + s.dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, inspections: (rows || []).map(_row), total: total.total };
}

// ═══════════════════════════════════════════════════════════
// RELATIONSHIP TRAVERSAL
// ═══════════════════════════════════════════════════════════

async function getSupplierParts(db, supplierId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND org_id = ?').get(supplierId, orgId);
    if (!supplier) return { success: false, error: 'supplier_not_found' };
    const rows = await db.prepare('SELECT * FROM parts WHERE supplier_id = ? AND org_id = ? ORDER BY part_number ASC').all(supplierId, orgId);
    return { success: true, parts: (rows || []).map(_row) };
}

async function getSupplierCertifications(db, supplierId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND org_id = ?').get(supplierId, orgId);
    if (!supplier) return { success: false, error: 'supplier_not_found' };
    const rows = await db.prepare('SELECT * FROM certifications WHERE supplier_id = ? AND org_id = ? ORDER BY expires_at ASC').all(supplierId, orgId);
    return { success: true, certifications: (rows || []).map(_row) };
}

async function getSupplierOrders(db, supplierId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const supplier = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND org_id = ?').get(supplierId, orgId);
    if (!supplier) return { success: false, error: 'supplier_not_found' };
    const rows = await db.prepare('SELECT * FROM purchase_orders WHERE supplier_id = ? AND org_id = ? ORDER BY created_at DESC').all(supplierId, orgId);
    return { success: true, orders: (rows || []).map(_row) };
}

async function getOrderLineItems(db, orderId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const order = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!order) return { success: false, error: 'order_not_found' };
    const rows = await db.prepare(`
        SELECT li.*, p.part_number, p.description
        FROM po_line_items li
        LEFT JOIN parts p ON li.part_id = p.id
        WHERE li.po_id = ? AND li.org_id = ?
        ORDER BY li.id ASC
    `).all(orderId, orgId);
    return { success: true, line_items: rows || [] };
}

async function getOrderShipments(db, orderId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const order = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!order) return { success: false, error: 'order_not_found' };
    const rows = await db.prepare('SELECT * FROM shipments WHERE po_id = ? AND org_id = ? ORDER BY created_at DESC').all(orderId, orgId);
    return { success: true, shipments: (rows || []).map(_row) };
}

async function getShipmentInspections(db, shipmentId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const sh = await db.prepare('SELECT id FROM shipments WHERE id = ? AND org_id = ?').get(shipmentId, orgId);
    if (!sh) return { success: false, error: 'shipment_not_found' };
    const rows = await db.prepare('SELECT * FROM inspections WHERE shipment_id = ? AND org_id = ? ORDER BY inspection_date DESC, id DESC').all(shipmentId, orgId);
    return { success: true, inspections: (rows || []).map(_row) };
}

// ═══════════════════════════════════════════════════════════
// TIMELINE / HISTORY QUERYING
// ═══════════════════════════════════════════════════════════

async function getEntityTimeline(db, entityType, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?', 'entity_type = ?']; const p = [filters.org_id, entityType];
    if (filters.entity_id) { c.push('entity_id = ?'); p.push(String(filters.entity_id)); }
    if (filters.action) { c.push('action = ?'); p.push(filters.action); }
    if (filters.actor_user_id) { c.push('actor_user_id = ?'); p.push(filters.actor_user_id); }
    if (filters.after) { c.push('created_at >= ?'); p.push(filters.after); }
    if (filters.before) { c.push('created_at <= ?'); p.push(filters.before); }
    if (filters.source) { c.push('source = ?'); p.push(filters.source); }

    const limit = _clamp(filters.limit, 1, 200, 100);
    const offset = _clamp(filters.offset, 0, 100000, 0);
    const total = await db.prepare('SELECT COUNT(*) as total FROM entity_history WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM entity_history WHERE ' + c.join(' AND ') + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(...p, limit, offset);
    return {
        success: true,
        events: (rows || []).map(r => ({ ...r, previous_values_json: _jp(r.previous_values), new_values_json: _jp(r.new_values), field_changes_json: _jp(r.field_changes) })),
        total: total.total
    };
}

async function getStatusChanges(db, entityType, entityId, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const rows = await db.prepare(`
        SELECT * FROM entity_history
        WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND action = 'STATUS_CHANGE'
        ORDER BY created_at DESC, id DESC
    `).all(orgId, entityType, String(entityId));
    return {
        success: true,
        status_changes: (rows || []).map(r => ({ ...r, field_changes_json: _jp(r.field_changes) }))
    };
}

async function getImportProvenance(db, entityType, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?', 'entity_type = ?', 'source = ?']; const p = [filters.org_id, entityType, 'bulk_import'];
    if (filters.after) { c.push('created_at >= ?'); p.push(filters.after); }
    if (filters.before) { c.push('created_at <= ?'); p.push(filters.before); }
    const rows = await db.prepare('SELECT * FROM entity_history WHERE ' + c.join(' AND ') + ' ORDER BY created_at DESC, id DESC').all(...p);
    return {
        success: true,
        imports: (rows || []).map(r => ({ ...r, new_values_json: _jp(r.new_values), field_changes_json: _jp(r.field_changes) }))
    };
}

module.exports = {
    querySuppliers,
    queryParts,
    queryOrders,
    queryShipments,
    queryCertifications,
    queryInspections,
    getSupplierParts,
    getSupplierCertifications,
    getSupplierOrders,
    getOrderLineItems,
    getOrderShipments,
    getShipmentInspections,
    getEntityTimeline,
    getStatusChanges,
    getImportProvenance,
};
