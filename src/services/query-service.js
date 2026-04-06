'use strict';
const logger = require('../common/logger');

function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
function _row(r) { if (!r) return null; return { ...r, metadata_json: _jp(r.metadata_json) }; }
function _clamp(v, min, max, fb) { const n = parseInt(v, 10); return isNaN(n) ? fb : Math.max(min, Math.min(max, n)); }

const VALID_SORT_FIELDS = {
    supplier: ['name', 'supplier_code', 'status', 'country', 'rating', 'created_at'],
    part: ['part_number', 'description', 'category', 'criticality', 'lead_time_days', 'created_at'],
    purchase_order: ['po_number', 'status', 'total_value', 'required_date', 'created_at'],
    shipment: ['shipment_number', 'status', 'ship_date', 'eta', 'created_at'],
    inspection: ['result', 'inspection_date', 'defect_count', 'created_at'],
    certification: ['cert_type', 'status', 'expiry_date', 'created_at'],
};

function _safeSortField(entityType, field) {
    const valid = VALID_SORT_FIELDS[entityType] || [];
    return valid.includes(field) ? field : 'created_at';
}

function _safeSortDir(dir) { return dir === 'asc' ? 'ASC' : 'DESC'; }

// ═══════════════════════════════════════════════════════════
// ADVANCED SUPPLIER QUERIES
// ═══════════════════════════════════════════════════════════

async function querySuppliers(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['s.org_id = ?']; const p = [orgId];

    if (filters.status) { c.push('s.status = ?'); p.push(filters.status); }
    if (filters.category) { c.push('s.category = ?'); p.push(filters.category); }
    if (filters.country) { c.push('s.country = ?'); p.push(filters.country); }
    if (filters.min_rating) { c.push('s.rating >= ?'); p.push(parseFloat(filters.min_rating)); }
    if (filters.search) { c.push('(s.name LIKE ? OR s.supplier_code LIKE ? OR s.contact_email LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%', '%' + filters.search + '%'); }

    const sort = _safeSortField('supplier', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM suppliers s WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT s.*, (SELECT COUNT(*) FROM parts WHERE supplier_id = s.id) as part_count, (SELECT COUNT(*) FROM certifications WHERE supplier_id = s.id) as cert_count, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) as order_count FROM suppliers s WHERE ' + c.join(' AND ') + ' ORDER BY s.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);

    return { success: true, suppliers: (rows || []).map(_row), total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// ADVANCED PART QUERIES
// ═══════════════════════════════════════════════════════════

async function queryParts(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['p.org_id = ?']; const pp = [orgId];

    if (filters.category) { c.push('p.category = ?'); pp.push(filters.category); }
    if (filters.criticality) { c.push('p.criticality = ?'); pp.push(filters.criticality); }
    if (filters.supplier_id) { c.push('p.supplier_id = ?'); pp.push(parseInt(filters.supplier_id, 10)); }
    if (filters.max_lead_time) { c.push('p.lead_time_days <= ?'); pp.push(parseInt(filters.max_lead_time, 10)); }
    if (filters.search) { c.push('(p.part_number LIKE ? OR p.description LIKE ?)'); pp.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const sort = _safeSortField('part', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM parts p WHERE ' + c.join(' AND ')).get(...pp);
    const rows = await db.prepare('SELECT p.*, s.name as supplier_name FROM parts p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE ' + c.join(' AND ') + ' ORDER BY p.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...pp, limit, offset);

    return { success: true, parts: (rows || []).map(_row), total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// ADVANCED ORDER QUERIES
// ═══════════════════════════════════════════════════════════

async function queryOrders(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['o.org_id = ?']; const p = [orgId];

    if (filters.status) { c.push('o.status = ?'); p.push(filters.status); }
    if (filters.supplier_id) { c.push('o.supplier_id = ?'); p.push(parseInt(filters.supplier_id, 10)); }
    if (filters.min_value) { c.push('o.total_value >= ?'); p.push(parseFloat(filters.min_value)); }
    if (filters.max_value) { c.push('o.total_value <= ?'); p.push(parseFloat(filters.max_value)); }
    if (filters.required_after) { c.push('o.required_date >= ?'); p.push(filters.required_after); }
    if (filters.required_before) { c.push('o.required_date <= ?'); p.push(filters.required_before); }
    if (filters.search) { c.push('o.po_number LIKE ?'); p.push('%' + filters.search + '%'); }

    const sort = _safeSortField('purchase_order', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM purchase_orders o WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT o.*, s.name as supplier_name, (SELECT COUNT(*) FROM shipments WHERE po_id = o.id) as shipment_count FROM purchase_orders o LEFT JOIN suppliers s ON o.supplier_id = s.id WHERE ' + c.join(' AND ') + ' ORDER BY o.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);

    return { success: true, orders: (rows || []).map(_row), total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// SHIPMENT QUERIES
// ═══════════════════════════════════════════════════════════

async function queryShipments(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['sh.org_id = ?']; const p = [orgId];

    if (filters.status) { c.push('sh.status = ?'); p.push(filters.status); }
    if (filters.carrier) { c.push('sh.carrier = ?'); p.push(filters.carrier); }
    if (filters.po_id) { c.push('sh.po_id = ?'); p.push(parseInt(filters.po_id, 10)); }
    if (filters.eta_after) { c.push('sh.eta >= ?'); p.push(filters.eta_after); }
    if (filters.eta_before) { c.push('sh.eta <= ?'); p.push(filters.eta_before); }
    if (filters.search) { c.push('(sh.shipment_number LIKE ? OR sh.tracking_number LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const sort = _safeSortField('shipment', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM shipments sh WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT sh.*, o.po_number, (SELECT COUNT(*) FROM inspections WHERE shipment_id = sh.id) as inspection_count FROM shipments sh LEFT JOIN purchase_orders o ON sh.po_id = o.id WHERE ' + c.join(' AND ') + ' ORDER BY sh.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);

    return { success: true, shipments: (rows || []).map(_row), total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// CERTIFICATION QUERIES
// ═══════════════════════════════════════════════════════════

async function queryCertifications(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['c.org_id = ?']; const p = [orgId];

    if (filters.cert_type) { c.push('c.cert_type = ?'); p.push(filters.cert_type); }
    if (filters.status) { c.push('c.status = ?'); p.push(filters.status); }
    if (filters.supplier_id) { c.push('c.supplier_id = ?'); p.push(parseInt(filters.supplier_id, 10)); }
    if (filters.expiring_before) { c.push('c.expiry_date <= ?'); p.push(filters.expiring_before); }
    if (filters.expiring_after) { c.push('c.expiry_date >= ?'); p.push(filters.expiring_after); }

    const sort = _safeSortField('certification', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM certifications c WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT c.*, s.name as supplier_name FROM certifications c LEFT JOIN suppliers s ON c.supplier_id = s.id WHERE ' + c.join(' AND ') + ' ORDER BY c.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);

    return { success: true, certifications: rows || [], total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// INSPECTION QUERIES
// ═══════════════════════════════════════════════════════════

async function queryInspections(db, orgId, filters = {}) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const c = ['i.org_id = ?']; const p = [orgId];

    if (filters.result) { c.push('i.result = ?'); p.push(filters.result); }
    if (filters.shipment_id) { c.push('i.shipment_id = ?'); p.push(parseInt(filters.shipment_id, 10)); }
    if (filters.inspector_user_id) { c.push('i.inspector_user_id = ?'); p.push(filters.inspector_user_id); }
    if (filters.date_after) { c.push('i.inspection_date >= ?'); p.push(filters.date_after); }
    if (filters.date_before) { c.push('i.inspection_date <= ?'); p.push(filters.date_before); }
    if (filters.min_defects) { c.push('i.defect_count >= ?'); p.push(parseInt(filters.min_defects, 10)); }

    const sort = _safeSortField('inspection', filters.sort_by);
    const dir = _safeSortDir(filters.sort_dir);
    const limit = _clamp(filters.limit, 1, 200, 50);
    const offset = _clamp(filters.offset, 0, 1e7, 0);

    const cnt = await db.prepare('SELECT COUNT(*) as total FROM inspections i WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT i.*, sh.shipment_number FROM inspections i LEFT JOIN shipments sh ON i.shipment_id = sh.id WHERE ' + c.join(' AND ') + ' ORDER BY i.' + sort + ' ' + dir + ' LIMIT ? OFFSET ?').all(...p, limit, offset);

    return { success: true, inspections: rows || [], total: cnt ? cnt.total : 0, limit, offset };
}

// ═══════════════════════════════════════════════════════════
// RELATIONSHIP TRAVERSAL
// ═══════════════════════════════════════════════════════════

async function getSupplierParts(db, orgId, supplierId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const rows = await db.prepare('SELECT * FROM parts WHERE org_id = ? AND supplier_id = ? ORDER BY part_number ASC').all(orgId, supplierId);
    return { success: true, parts: (rows || []).map(_row) };
}

async function getSupplierCertifications(db, orgId, supplierId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const rows = await db.prepare('SELECT * FROM certifications WHERE org_id = ? AND supplier_id = ? ORDER BY expiry_date ASC').all(orgId, supplierId);
    return { success: true, certifications: rows || [] };
}

async function getSupplierOrders(db, orgId, supplierId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const rows = await db.prepare('SELECT * FROM purchase_orders WHERE org_id = ? AND supplier_id = ? ORDER BY created_at DESC').all(orgId, supplierId);
    return { success: true, orders: (rows || []).map(_row) };
}

async function getOrderLineItems(db, orgId, orderId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const order = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!order) return { success: false, error: 'order_not_found' };
    const rows = await db.prepare('SELECT li.*, p.part_number, p.description as part_description FROM po_line_items li LEFT JOIN parts p ON li.part_id = p.id WHERE li.po_id = ? AND li.org_id = ?').all(orderId, orgId);
    return { success: true, line_items: rows || [] };
}

async function getOrderShipments(db, orgId, orderId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const order = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(orderId, orgId);
    if (!order) return { success: false, error: 'order_not_found' };
    const rows = await db.prepare('SELECT * FROM shipments WHERE po_id = ? AND org_id = ? ORDER BY created_at DESC').all(orderId, orgId);
    return { success: true, shipments: (rows || []).map(_row) };
}

async function getShipmentInspections(db, orgId, shipmentId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const sh = await db.prepare('SELECT id FROM shipments WHERE id = ? AND org_id = ?').get(shipmentId, orgId);
    if (!sh) return { success: false, error: 'shipment_not_found' };
    const rows = await db.prepare('SELECT * FROM inspections WHERE shipment_id = ? AND org_id = ? ORDER BY inspection_date DESC').all(shipmentId, orgId);
    return { success: true, inspections: rows || [] };
}

// ═══════════════════════════════════════════════════════════
// TIMELINE / HISTORY ACCESS
// ═══════════════════════════════════════════════════════════

async function getEntityTimeline(db, orgId, entityType, entityId, opts = {}) {
    if (!orgId || !entityType) return { success: false, error: 'org_id_and_entity_type_required' };
    const c = ['org_id = ?', 'entity_type = ?']; const p = [orgId, entityType];
    if (entityId) { c.push('entity_id = ?'); p.push(entityId); }
    if (opts.action) { c.push('action = ?'); p.push(opts.action); }
    if (opts.actor) { c.push('actor_user_id = ?'); p.push(opts.actor); }
    if (opts.after) { c.push('created_at >= ?'); p.push(opts.after); }
    if (opts.before) { c.push('created_at <= ?'); p.push(opts.before); }
    if (opts.source) { c.push('source = ?'); p.push(opts.source); }

    const limit = _clamp(opts.limit, 1, 500, 100);
    const offset = _clamp(opts.offset, 0, 1e7, 0);
    const cnt = await db.prepare('SELECT COUNT(*) as total FROM entity_history WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM entity_history WHERE ' + c.join(' AND ') + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...p, limit, offset);

    return {
        success: true, total: cnt ? cnt.total : 0, limit, offset,
        events: (rows || []).map(r => ({
            ...r,
            field_changes_json: _jp(r.field_changes_json),
            previous_values_json: _jp(r.previous_values_json),
            new_values_json: _jp(r.new_values_json),
        })),
    };
}

async function getStatusChanges(db, orgId, entityType, entityId) {
    if (!orgId || !entityType || !entityId) return { success: false, error: 'org_id_entity_type_entity_id_required' };
    const rows = await db.prepare(
        "SELECT * FROM entity_history WHERE org_id = ? AND entity_type = ? AND entity_id = ? AND action = 'STATUS_CHANGE' ORDER BY created_at ASC"
    ).all(orgId, entityType, entityId);
    return {
        success: true,
        changes: (rows || []).map(r => ({
            from: _jp(r.field_changes_json).status ? _jp(r.field_changes_json).status.from : null,
            to: _jp(r.field_changes_json).status ? _jp(r.field_changes_json).status.to : null,
            actor: r.actor_user_id,
            timestamp: r.created_at,
            source: r.source,
        })),
    };
}

async function getImportProvenance(db, orgId, entityType, opts = {}) {
    if (!orgId || !entityType) return { success: false, error: 'org_id_and_entity_type_required' };
    const limit = _clamp(opts.limit, 1, 500, 100);
    const rows = await db.prepare(
        "SELECT * FROM entity_history WHERE org_id = ? AND entity_type = ? AND source = 'bulk_import' ORDER BY created_at DESC LIMIT ?"
    ).all(orgId, entityType, limit);
    return {
        success: true,
        imports: (rows || []).map(r => ({
            entity_id: r.entity_id,
            actor: r.actor_user_id,
            timestamp: r.created_at,
            new_values: _jp(r.new_values_json),
            correlation_id: r.correlation_id,
        })),
    };
}

module.exports = {
    querySuppliers, queryParts, queryOrders, queryShipments, queryCertifications, queryInspections,
    getSupplierParts, getSupplierCertifications, getSupplierOrders,
    getOrderLineItems, getOrderShipments, getShipmentInspections,
    getEntityTimeline, getStatusChanges, getImportProvenance,
    VALID_SORT_FIELDS,
};
