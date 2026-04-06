'use strict';
const { enforceGovernance, GATE_STATUS } = require('./governance-gate');
const entityHistory = require('./entity-history');
const logger = require('../common/logger');
const metrics = require('../common/metrics');

function _now() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function _js(o) { try { return JSON.stringify(o || {}); } catch { return '{}'; } }
function _jp(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
function _row(r) { if (!r) return null; return { ...r, metadata_json: _jp(r.metadata_json) }; }

// ═══════════════════════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════════════════════

async function createSupplier(db, params) {
    if (!params.org_id) return { success: false, error: 'org_id_required' };
    if (!params.supplier_code) return { success: false, error: 'supplier_code_required' };
    if (!params.name) return { success: false, error: 'name_required' };
    if (!params.actor_user_id) return { success: false, error: 'actor_user_id_required' };

    try {
        const now = _now();
        const ins = await db.prepare(
            'INSERT INTO suppliers (org_id, supplier_code, name, status, category, country, contact_email, rating, metadata_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(params.org_id, params.supplier_code, params.name, params.status || 'ACTIVE',
            params.category || null, params.country || null, params.contact_email || null,
            params.rating || null, _js(params.metadata), params.actor_user_id, now, now);

        const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
        await entityHistory.record(db, {
            org_id: params.org_id, entity_type: 'supplier', entity_id: id,
            action: 'CREATE', actor_user_id: params.actor_user_id, source: params.source || 'manual',
            new_values: { supplier_code: params.supplier_code, name: params.name, status: params.status || 'ACTIVE' },
        });
        metrics.increment('suppliers.created');
        return { success: true, supplier_id: id };
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) return { success: false, error: 'supplier_code_exists' };
        return { success: false, error: err.message };
    }
}

async function getSupplier(db, id, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const row = await db.prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!row) return { success: false, error: 'supplier_not_found' };
    return { success: true, supplier: _row(row) };
}

async function listSuppliers(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.category) { c.push('category = ?'); p.push(filters.category); }
    if (filters.country) { c.push('country = ?'); p.push(filters.country); }
    if (filters.search) { c.push('(name LIKE ? OR supplier_code LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }

    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const cnt = await db.prepare('SELECT COUNT(*) as total FROM suppliers WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM suppliers WHERE ' + c.join(' AND ') + ' ORDER BY name ASC LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, suppliers: (rows || []).map(_row), total: cnt ? cnt.total : 0 };
}

async function updateSupplier(db, id, params) {
    if (!params.org_id || !params.actor_user_id) return { success: false, error: 'org_id_and_actor_required' };

    // Governance: only for destructive/bulk/AI updates
    if (params.is_destructive || params.is_bulk || params.is_ai_originated) {
        const gate = await enforceGovernance(db, {
            org_id: params.org_id, actor_user_id: params.actor_user_id,
            target_type: 'supplier', target_id: String(id), action_type: 'update',
            is_destructive: params.is_destructive, is_bulk: params.is_bulk, is_ai_originated: params.is_ai_originated,
        });
        if (gate.status !== GATE_STATUS.CLEAR) {
            return { success: false, error: 'governance_blocked', gate_status: gate.status, approval_request_id: gate.approval_request_id };
        }
    }

    const prev = await db.prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?').get(id, params.org_id);
    if (!prev) return { success: false, error: 'supplier_not_found' };

    const fields = {};
    const sets = []; const vals = [];
    for (const f of ['name', 'status', 'category', 'country', 'contact_email', 'rating']) {
        if (params[f] !== undefined) { sets.push(f + ' = ?'); vals.push(params[f]); fields[f] = { from: prev[f], to: params[f] }; }
    }
    if (params.metadata !== undefined) { sets.push('metadata_json = ?'); vals.push(_js(params.metadata)); }
    if (sets.length === 0) return { success: false, error: 'no_fields_to_update' };

    sets.push('updated_at = ?'); vals.push(_now());
    vals.push(id, params.org_id);
    await db.prepare('UPDATE suppliers SET ' + sets.join(', ') + ' WHERE id = ? AND org_id = ?').run(...vals);

    await entityHistory.record(db, {
        org_id: params.org_id, entity_type: 'supplier', entity_id: id,
        action: 'UPDATE', actor_user_id: params.actor_user_id,
        field_changes: fields, previous_values: _row(prev),
    });
    metrics.increment('suppliers.updated');
    return { success: true };
}

async function deleteSupplier(db, id, params) {
    if (!params.org_id || !params.actor_user_id) return { success: false, error: 'org_id_and_actor_required' };

    // Governance: delete is destructive, requires DUAL approval
    const gate = await enforceGovernance(db, {
        org_id: params.org_id, actor_user_id: params.actor_user_id,
        target_type: 'supplier', target_id: String(id), action_type: 'delete',
        is_destructive: true,
    });
    if (gate.status !== GATE_STATUS.CLEAR) {
        return { success: false, error: 'governance_blocked', gate_status: gate.status, approval_request_id: gate.approval_request_id };
    }

    const prev = await db.prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?').get(id, params.org_id);
    if (!prev) return { success: false, error: 'supplier_not_found' };

    // Check for dependent records
    const deps = await db.prepare('SELECT COUNT(*) as c FROM parts WHERE supplier_id = ?').get(id);
    if (deps && deps.c > 0) return { success: false, error: 'supplier_has_dependent_parts', count: deps.c };

    await db.prepare('DELETE FROM suppliers WHERE id = ? AND org_id = ?').run(id, params.org_id);
    await entityHistory.record(db, {
        org_id: params.org_id, entity_type: 'supplier', entity_id: id,
        action: 'DELETE', actor_user_id: params.actor_user_id, previous_values: _row(prev),
    });
    metrics.increment('suppliers.deleted');
    return { success: true };
}

// ═══════════════════════════════════════════════════════════
// PARTS
// ═══════════════════════════════════════════════════════════

async function createPart(db, params) {
    if (!params.org_id || !params.part_number || !params.actor_user_id) return { success: false, error: 'org_id_part_number_actor_required' };
    try {
        const now = _now();
        const ins = await db.prepare(
            'INSERT INTO parts (org_id, part_number, description, category, unit_of_measure, supplier_id, lead_time_days, criticality, metadata_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(params.org_id, params.part_number, params.description || null, params.category || null,
            params.unit_of_measure || 'EACH', params.supplier_id || null, params.lead_time_days || null,
            params.criticality || 'STANDARD', _js(params.metadata), params.actor_user_id, now, now);
        const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
        await entityHistory.record(db, {
            org_id: params.org_id, entity_type: 'part', entity_id: id,
            action: 'CREATE', actor_user_id: params.actor_user_id,
            new_values: { part_number: params.part_number, criticality: params.criticality || 'STANDARD' },
        });
        metrics.increment('parts.created');
        return { success: true, part_id: id };
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) return { success: false, error: 'part_number_exists' };
        return { success: false, error: err.message };
    }
}

async function getPart(db, id, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const row = await db.prepare('SELECT * FROM parts WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!row) return { success: false, error: 'part_not_found' };
    return { success: true, part: _row(row) };
}

async function listParts(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.category) { c.push('category = ?'); p.push(filters.category); }
    if (filters.criticality) { c.push('criticality = ?'); p.push(filters.criticality); }
    if (filters.supplier_id) { c.push('supplier_id = ?'); p.push(filters.supplier_id); }
    if (filters.search) { c.push('(part_number LIKE ? OR description LIKE ?)'); p.push('%' + filters.search + '%', '%' + filters.search + '%'); }
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const cnt = await db.prepare('SELECT COUNT(*) as total FROM parts WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM parts WHERE ' + c.join(' AND ') + ' ORDER BY part_number ASC LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, parts: (rows || []).map(_row), total: cnt ? cnt.total : 0 };
}

// ═══════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════

async function createOrder(db, params) {
    if (!params.org_id || !params.po_number || !params.supplier_id || !params.actor_user_id) {
        return { success: false, error: 'org_id_po_number_supplier_actor_required' };
    }
    // Verify supplier exists and belongs to org
    const sup = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND org_id = ?').get(params.supplier_id, params.org_id);
    if (!sup) return { success: false, error: 'supplier_not_found' };

    try {
        const now = _now();
        const ins = await db.prepare(
            'INSERT INTO purchase_orders (org_id, po_number, supplier_id, status, total_value, currency, required_date, notes, metadata_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(params.org_id, params.po_number, params.supplier_id, 'DRAFT',
            params.total_value || 0, params.currency || 'USD', params.required_date || null,
            params.notes || null, _js(params.metadata), params.actor_user_id, now, now);
        const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
        await entityHistory.record(db, {
            org_id: params.org_id, entity_type: 'purchase_order', entity_id: id,
            action: 'CREATE', actor_user_id: params.actor_user_id,
            new_values: { po_number: params.po_number, supplier_id: params.supplier_id, status: 'DRAFT' },
        });
        metrics.increment('orders.created');
        return { success: true, order_id: id };
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) return { success: false, error: 'po_number_exists' };
        return { success: false, error: err.message };
    }
}

async function getOrder(db, id, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const row = await db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!row) return { success: false, error: 'order_not_found' };
    // Get line items
    const lines = await db.prepare('SELECT li.*, p.part_number FROM po_line_items li LEFT JOIN parts p ON li.part_id = p.id WHERE li.po_id = ? AND li.org_id = ?').all(id, orgId);
    return { success: true, order: _row(row), line_items: lines || [] };
}

async function listOrders(db, filters = {}) {
    if (!filters.org_id) return { success: false, error: 'org_id_required' };
    const c = ['org_id = ?']; const p = [filters.org_id];
    if (filters.status) { c.push('status = ?'); p.push(filters.status); }
    if (filters.supplier_id) { c.push('supplier_id = ?'); p.push(filters.supplier_id); }
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const cnt = await db.prepare('SELECT COUNT(*) as total FROM purchase_orders WHERE ' + c.join(' AND ')).get(...p);
    const rows = await db.prepare('SELECT * FROM purchase_orders WHERE ' + c.join(' AND ') + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...p, limit, offset);
    return { success: true, orders: (rows || []).map(_row), total: cnt ? cnt.total : 0 };
}

async function updateOrderStatus(db, id, params) {
    if (!params.org_id || !params.actor_user_id || !params.status) return { success: false, error: 'org_id_actor_status_required' };

    // Only CANCELLED requires governance (destructive)
    if (params.status === 'CANCELLED') {
        const gate = await enforceGovernance(db, {
            org_id: params.org_id, actor_user_id: params.actor_user_id,
            target_type: 'purchase_order', target_id: String(id), action_type: 'delete',
            is_destructive: true,
        });
        if (gate.status !== GATE_STATUS.CLEAR) {
            return { success: false, error: 'governance_blocked', gate_status: gate.status, approval_request_id: gate.approval_request_id };
        }
    }

    const prev = await db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND org_id = ?').get(id, params.org_id);
    if (!prev) return { success: false, error: 'order_not_found' };

    await db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND org_id = ?').run(params.status, _now(), id, params.org_id);
    await entityHistory.record(db, {
        org_id: params.org_id, entity_type: 'purchase_order', entity_id: id,
        action: 'STATUS_CHANGE', actor_user_id: params.actor_user_id,
        field_changes: { status: { from: prev.status, to: params.status } },
    });
    metrics.increment('orders.status_changed');
    return { success: true };
}

// ═══════════════════════════════════════════════════════════
// BULK IMPORT (governed — DUAL approval for bulk operations)
// ═══════════════════════════════════════════════════════════

async function bulkImportSuppliers(db, params) {
    if (!params.org_id || !params.actor_user_id || !params.suppliers) {
        return { success: false, error: 'org_id_actor_suppliers_required' };
    }
    if (!Array.isArray(params.suppliers) || params.suppliers.length === 0) {
        return { success: false, error: 'suppliers_must_be_nonempty_array' };
    }

    // Bulk operations require DUAL approval via governance gate
    const gate = await enforceGovernance(db, {
        org_id: params.org_id, actor_user_id: params.actor_user_id,
        target_type: 'supplier', target_id: 'bulk', action_type: 'import',
        is_bulk: true,
        payload: { count: params.suppliers.length },
    });
    if (gate.status !== GATE_STATUS.CLEAR) {
        return {
            success: false, error: 'governance_blocked', gate_status: gate.status,
            approval_request_id: gate.approval_request_id,
            message: 'Bulk import of ' + params.suppliers.length + ' suppliers requires DUAL approval',
        };
    }

    // Import each supplier
    const results = { imported: 0, skipped: 0, errors: [] };
    for (const s of params.suppliers) {
        if (!s.supplier_code || !s.name) { results.errors.push({ supplier_code: s.supplier_code, error: 'missing_required_fields' }); results.skipped++; continue; }
        const r = await createSupplier(db, { ...s, org_id: params.org_id, actor_user_id: params.actor_user_id, source: 'bulk_import' });
        if (r.success) results.imported++;
        else { results.skipped++; results.errors.push({ supplier_code: s.supplier_code, error: r.error }); }
    }
    metrics.increment('suppliers.bulk_imported', { count: results.imported });
    return { success: true, results };
}



// ═══════════════════════════════════════════════════════════
// SHIPMENTS
// ═══════════════════════════════════════════════════════════

async function createShipment(db, params) {
    if (!params.org_id || !params.shipment_number || !params.po_id || !params.actor_user_id) {
        return { success: false, error: 'org_id_shipment_number_po_actor_required' };
    }
    const po = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(params.po_id, params.org_id);
    if (!po) return { success: false, error: 'order_not_found' };
    try {
        const now = _now();
        const ins = await db.prepare(
            'INSERT INTO shipments (org_id, shipment_number, po_id, carrier, tracking_number, status, ship_date, eta, metadata_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        ).run(params.org_id, params.shipment_number, params.po_id, params.carrier || null,
            params.tracking_number || null, 'PENDING', params.ship_date || null, params.eta || null,
            _js(params.metadata), params.actor_user_id, now, now);
        const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
        await entityHistory.record(db, { org_id: params.org_id, entity_type: 'shipment', entity_id: id, action: 'CREATE', actor_user_id: params.actor_user_id, new_values: { shipment_number: params.shipment_number, po_id: params.po_id } });
        metrics.increment('shipments.created');
        return { success: true, shipment_id: id };
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) return { success: false, error: 'shipment_number_exists' };
        return { success: false, error: err.message };
    }
}

async function getShipment(db, id, orgId) {
    if (!orgId) return { success: false, error: 'org_id_required' };
    const row = await db.prepare('SELECT * FROM shipments WHERE id = ? AND org_id = ?').get(id, orgId);
    if (!row) return { success: false, error: 'shipment_not_found' };
    return { success: true, shipment: _row(row) };
}

// ═══════════════════════════════════════════════════════════
// INSPECTIONS
// ═══════════════════════════════════════════════════════════

async function createInspection(db, params) {
    if (!params.org_id || !params.shipment_id || !params.inspector_user_id || !params.result) {
        return { success: false, error: 'org_id_shipment_inspector_result_required' };
    }
    const sh = await db.prepare('SELECT id FROM shipments WHERE id = ? AND org_id = ?').get(params.shipment_id, params.org_id);
    if (!sh) return { success: false, error: 'shipment_not_found' };
    const now = _now();
    const ins = await db.prepare(
        'INSERT INTO inspections (org_id, shipment_id, inspector_user_id, result, defect_count, notes, inspection_date, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(params.org_id, params.shipment_id, params.inspector_user_id, params.result,
        params.defect_count || 0, params.notes || null, params.inspection_date || now.split(' ')[0],
        _js(params.metadata), now);
    const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
    await entityHistory.record(db, { org_id: params.org_id, entity_type: 'inspection', entity_id: id, action: 'CREATE', actor_user_id: params.inspector_user_id, new_values: { result: params.result, defect_count: params.defect_count || 0 } });
    metrics.increment('inspections.created');
    return { success: true, inspection_id: id };
}

// ═══════════════════════════════════════════════════════════
// CERTIFICATIONS
// ═══════════════════════════════════════════════════════════

async function createCertification(db, params) {
    if (!params.org_id || !params.supplier_id || !params.cert_type || !params.actor_user_id) {
        return { success: false, error: 'org_id_supplier_cert_type_actor_required' };
    }
    const sup = await db.prepare('SELECT id FROM suppliers WHERE id = ? AND org_id = ?').get(params.supplier_id, params.org_id);
    if (!sup) return { success: false, error: 'supplier_not_found' };
    const now = _now();
    const ins = await db.prepare(
        'INSERT INTO certifications (org_id, supplier_id, cert_type, cert_number, issuer, issue_date, expiry_date, status, document_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(params.org_id, params.supplier_id, params.cert_type, params.cert_number || null,
        params.issuer || null, params.issue_date || null, params.expiry_date || null,
        params.status || 'ACTIVE', params.document_ref || null, now);
    const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;
    await entityHistory.record(db, { org_id: params.org_id, entity_type: 'certification', entity_id: id, action: 'CREATE', actor_user_id: params.actor_user_id, new_values: { cert_type: params.cert_type, supplier_id: params.supplier_id } });
    metrics.increment('certifications.created');
    return { success: true, certification_id: id };
}

// ═══════════════════════════════════════════════════════════
// PO LINE ITEMS
// ═══════════════════════════════════════════════════════════

async function addLineItem(db, params) {
    if (!params.org_id || !params.po_id || !params.part_id || !params.quantity || !params.unit_price) {
        return { success: false, error: 'org_id_po_part_qty_price_required' };
    }
    const po = await db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?').get(params.po_id, params.org_id);
    if (!po) return { success: false, error: 'order_not_found' };
    const part = await db.prepare('SELECT id FROM parts WHERE id = ? AND org_id = ?').get(params.part_id, params.org_id);
    if (!part) return { success: false, error: 'part_not_found' };

    const lineTotal = params.quantity * params.unit_price;
    const ins = await db.prepare(
        'INSERT INTO po_line_items (org_id, po_id, part_id, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?)'
    ).run(params.org_id, params.po_id, params.part_id, params.quantity, params.unit_price, lineTotal);
    const id = ins.lastInsertRowid ? Number(ins.lastInsertRowid) : null;

    // Update PO total
    await db.prepare('UPDATE purchase_orders SET total_value = (SELECT COALESCE(SUM(line_total),0) FROM po_line_items WHERE po_id = ?), updated_at = ? WHERE id = ?').run(params.po_id, _now(), params.po_id);

    return { success: true, line_item_id: id, line_total: lineTotal };
}

module.exports = {
    createSupplier, getSupplier, listSuppliers, updateSupplier, deleteSupplier,
    createPart, getPart, listParts,
    createOrder, getOrder, listOrders, updateOrderStatus,
    createShipment, getShipment,
    createInspection,
    createCertification,
    addLineItem,
    bulkImportSuppliers,
};
