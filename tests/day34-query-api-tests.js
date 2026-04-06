'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const scs = require('../src/services/supply-chain-service');
const qs = require('../src/services/query-service');
const entityHistory = require('../src/services/entity-history');
const policyRegistry = require('../src/services/approval-policy-registry');
const logger = require('../src/common/logger');
const metrics = require('../src/common/metrics');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d34'; const OX = 'org-x-d34';
const UA = 'ua-d34'; const UB = 'ub-d34';

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

// Seed test data: suppliers, parts, orders, shipments, inspections, certifications
async function seed(db) {
    // Suppliers
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'S1', name: 'Alpha Metals', category: 'Metals', country: 'US', rating: 4.5, actor_user_id: UA });
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'S2', name: 'Beta Electronics', category: 'Electronics', country: 'JP', rating: 3.8, actor_user_id: UA });
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'S3', name: 'Gamma Fasteners', category: 'Fasteners', country: 'DE', rating: 4.9, actor_user_id: UA });
    // Parts
    await scs.createPart(db, { org_id: ORG, part_number: 'P1', description: 'Steel Plate', category: 'Metals', supplier_id: 1, criticality: 'STANDARD', lead_time_days: 14, actor_user_id: UA });
    await scs.createPart(db, { org_id: ORG, part_number: 'P2', description: 'Safety Relay', category: 'Electronics', supplier_id: 2, criticality: 'SAFETY', lead_time_days: 30, actor_user_id: UA });
    await scs.createPart(db, { org_id: ORG, part_number: 'P3', description: 'Hex Bolt M12', category: 'Fasteners', supplier_id: 1, criticality: 'STANDARD', lead_time_days: 7, actor_user_id: UA });
    // Orders
    await scs.createOrder(db, { org_id: ORG, po_number: 'PO-100', supplier_id: 1, actor_user_id: UA, total_value: 5000, required_date: '2026-06-01' });
    await scs.createOrder(db, { org_id: ORG, po_number: 'PO-101', supplier_id: 2, actor_user_id: UA, total_value: 12000, required_date: '2026-07-15' });
    // Line items
    await scs.addLineItem(db, { org_id: ORG, po_id: 1, part_id: 1, quantity: 100, unit_price: 25 });
    await scs.addLineItem(db, { org_id: ORG, po_id: 1, part_id: 3, quantity: 500, unit_price: 2 });
    await scs.addLineItem(db, { org_id: ORG, po_id: 2, part_id: 2, quantity: 10, unit_price: 450 });
    // Status changes
    await scs.updateOrderStatus(db, 1, { org_id: ORG, actor_user_id: UA, status: 'SUBMITTED' });
    await scs.updateOrderStatus(db, 1, { org_id: ORG, actor_user_id: UA, status: 'ACKNOWLEDGED' });
    // Shipments
    await scs.createShipment(db, { org_id: ORG, shipment_number: 'SH-001', po_id: 1, carrier: 'FedEx', tracking_number: 'FX123', eta: '2026-05-20', actor_user_id: UA });
    await scs.createShipment(db, { org_id: ORG, shipment_number: 'SH-002', po_id: 2, carrier: 'UPS', eta: '2026-07-01', actor_user_id: UA });
    // Inspections
    await scs.createInspection(db, { org_id: ORG, shipment_id: 1, inspector_user_id: UB, result: 'PASS', defect_count: 0 });
    await scs.createInspection(db, { org_id: ORG, shipment_id: 1, inspector_user_id: UB, result: 'CONDITIONAL', defect_count: 3, notes: 'Minor scratches' });
    // Certifications
    await scs.createCertification(db, { org_id: ORG, supplier_id: 1, cert_type: 'ISO9001', cert_number: 'C-001', issuer: 'BSI', expiry_date: '2027-12-31', actor_user_id: UA });
    await scs.createCertification(db, { org_id: ORG, supplier_id: 1, cert_type: 'AS9100', cert_number: 'C-002', issuer: 'SAI', expiry_date: '2026-06-30', actor_user_id: UA });
    await scs.createCertification(db, { org_id: ORG, supplier_id: 2, cert_type: 'ISO9001', cert_number: 'C-003', issuer: 'TUV', expiry_date: '2028-01-01', actor_user_id: UA });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 34: Supply Chain Query & API Expansion');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true }); metrics.reset();

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) { try { db.exec(s + ';'); } catch {} }
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '022-day33-supply-chain-entities.sql'), 'utf-8')); } catch {}
    policyRegistry.clearOrgPolicies();

    await seed(db);
    console.log('  [seed] Test data loaded');

    // ── 1. ADVANCED SUPPLIER QUERIES ───────────────────────
    console.log('\n--- 1. Advanced Supplier Queries ---');

    await test('query all suppliers', async () => {
        const r = await qs.querySuppliers(db, ORG);
        assert.strictEqual(r.success, true); assert.strictEqual(r.total, 3);
    });
    await test('filter by category', async () => {
        const r = await qs.querySuppliers(db, ORG, { category: 'Electronics' });
        assert.strictEqual(r.total, 1); assert.strictEqual(r.suppliers[0].name, 'Beta Electronics');
    });
    await test('filter by country', async () => {
        const r = await qs.querySuppliers(db, ORG, { country: 'DE' });
        assert.strictEqual(r.total, 1);
    });
    await test('filter by min rating', async () => {
        const r = await qs.querySuppliers(db, ORG, { min_rating: '4.0' });
        assert.strictEqual(r.total, 2); // Alpha 4.5, Gamma 4.9
    });
    await test('search by name', async () => {
        const r = await qs.querySuppliers(db, ORG, { search: 'Alpha' });
        assert.strictEqual(r.total, 1);
    });
    await test('suppliers include relationship counts', async () => {
        const r = await qs.querySuppliers(db, ORG, { search: 'Alpha' });
        assert.strictEqual(r.suppliers[0].part_count, 2);
        assert.strictEqual(r.suppliers[0].cert_count, 2);
        assert.strictEqual(r.suppliers[0].order_count, 1);
    });
    await test('sort by rating desc', async () => {
        const r = await qs.querySuppliers(db, ORG, { sort_by: 'rating', sort_dir: 'desc' });
        assert.ok(r.suppliers[0].rating >= r.suppliers[1].rating);
    });
    await test('pagination works', async () => {
        const r = await qs.querySuppliers(db, ORG, { limit: '2', offset: '0' });
        assert.strictEqual(r.suppliers.length, 2); assert.strictEqual(r.total, 3);
        const r2 = await qs.querySuppliers(db, ORG, { limit: '2', offset: '2' });
        assert.strictEqual(r2.suppliers.length, 1);
    });
    await test('cross-tenant empty', async () => {
        assert.strictEqual((await qs.querySuppliers(db, OX)).total, 0);
    });
    await test('missing org rejected', async () => {
        assert.strictEqual((await qs.querySuppliers(db, null)).success, false);
    });

    // ── 2. PART QUERIES ────────────────────────────────────
    console.log('\n--- 2. Part Queries ---');

    await test('query all parts', async () => {
        assert.strictEqual((await qs.queryParts(db, ORG)).total, 3);
    });
    await test('filter by criticality', async () => {
        const r = await qs.queryParts(db, ORG, { criticality: 'SAFETY' });
        assert.strictEqual(r.total, 1); assert.strictEqual(r.parts[0].part_number, 'P2');
    });
    await test('filter by supplier', async () => {
        const r = await qs.queryParts(db, ORG, { supplier_id: '1' });
        assert.strictEqual(r.total, 2);
    });
    await test('filter by max lead time', async () => {
        const r = await qs.queryParts(db, ORG, { max_lead_time: '14' });
        assert.strictEqual(r.total, 2); // P1=14, P3=7
    });
    await test('parts include supplier name', async () => {
        const r = await qs.queryParts(db, ORG, { search: 'Safety' });
        assert.strictEqual(r.parts[0].supplier_name, 'Beta Electronics');
    });

    // ── 3. ORDER QUERIES ───────────────────────────────────
    console.log('\n--- 3. Order Queries ---');

    await test('query orders with value range', async () => {
        const r = await qs.queryOrders(db, ORG, { min_value: '4000' });
        assert.strictEqual(r.total, 1);
    });
    await test('query orders by status', async () => {
        const r = await qs.queryOrders(db, ORG, { status: 'ACKNOWLEDGED' });
        assert.strictEqual(r.total, 1);
    });
    await test('query orders by date range', async () => {
        const r = await qs.queryOrders(db, ORG, { required_before: '2026-06-30' });
        assert.strictEqual(r.total, 1); // PO-100 due 2026-06-01
    });
    await test('orders include shipment count', async () => {
        const r = await qs.queryOrders(db, ORG);
        const po100 = r.orders.find(o => o.po_number === 'PO-100');
        assert.strictEqual(po100.shipment_count, 1);
    });

    // ── 4. SHIPMENT QUERIES ────────────────────────────────
    console.log('\n--- 4. Shipment Queries ---');

    await test('query shipments by carrier', async () => {
        const r = await qs.queryShipments(db, ORG, { carrier: 'FedEx' });
        assert.strictEqual(r.total, 1);
    });
    await test('query shipments by ETA range', async () => {
        const r = await qs.queryShipments(db, ORG, { eta_before: '2026-06-01' });
        assert.strictEqual(r.total, 1);
    });
    await test('shipments include inspection count', async () => {
        const r = await qs.queryShipments(db, ORG);
        const sh1 = r.shipments.find(s => s.shipment_number === 'SH-001');
        assert.strictEqual(sh1.inspection_count, 2);
    });

    // ── 5. CERTIFICATION QUERIES ───────────────────────────
    console.log('\n--- 5. Certification Queries ---');

    await test('query certs by type', async () => {
        const r = await qs.queryCertifications(db, ORG, { cert_type: 'ISO9001' });
        assert.strictEqual(r.total, 2);
    });
    await test('query certs expiring before date', async () => {
        const r = await qs.queryCertifications(db, ORG, { expiring_before: '2027-01-01' });
        assert.strictEqual(r.total, 1); // AS9100 expires 2026-06-30
    });
    await test('query certs by supplier', async () => {
        const r = await qs.queryCertifications(db, ORG, { supplier_id: '1' });
        assert.strictEqual(r.total, 2);
    });

    // ── 6. INSPECTION QUERIES ──────────────────────────────
    console.log('\n--- 6. Inspection Queries ---');

    await test('query inspections by result', async () => {
        const r = await qs.queryInspections(db, ORG, { result: 'PASS' });
        assert.strictEqual(r.total, 1);
    });
    await test('query inspections with defects', async () => {
        const r = await qs.queryInspections(db, ORG, { min_defects: '1' });
        assert.strictEqual(r.total, 1);
    });

    // ── 7. RELATIONSHIP TRAVERSAL ──────────────────────────
    console.log('\n--- 7. Relationship Traversal ---');

    await test('supplier → parts', async () => {
        const r = await qs.getSupplierParts(db, ORG, 1);
        assert.strictEqual(r.parts.length, 2);
    });
    await test('supplier → certifications', async () => {
        const r = await qs.getSupplierCertifications(db, ORG, 1);
        assert.strictEqual(r.certifications.length, 2);
    });
    await test('supplier → orders', async () => {
        const r = await qs.getSupplierOrders(db, ORG, 1);
        assert.strictEqual(r.orders.length, 1);
    });
    await test('order → line items', async () => {
        const r = await qs.getOrderLineItems(db, ORG, 1);
        assert.strictEqual(r.line_items.length, 2);
        assert.ok(r.line_items[0].part_number);
    });
    await test('order → shipments', async () => {
        const r = await qs.getOrderShipments(db, ORG, 1);
        assert.strictEqual(r.shipments.length, 1);
    });
    await test('shipment → inspections', async () => {
        const r = await qs.getShipmentInspections(db, ORG, 1);
        assert.strictEqual(r.inspections.length, 2);
    });
    await test('cross-org traversal blocked', async () => {
        assert.strictEqual((await qs.getSupplierParts(db, OX, 1)).parts.length, 0);
        assert.strictEqual((await qs.getOrderLineItems(db, OX, 1)).success, false);
        assert.strictEqual((await qs.getOrderShipments(db, OX, 1)).success, false);
        assert.strictEqual((await qs.getShipmentInspections(db, OX, 1)).success, false);
    });

    // ── 8. TIMELINE AND HISTORY ────────────────────────────
    console.log('\n--- 8. Timeline & History ---');

    await test('entity timeline for supplier', async () => {
        const r = await qs.getEntityTimeline(db, ORG, 'supplier', 1);
        assert.ok(r.total >= 1);
        assert.ok(r.events[0].action);
    });
    await test('entity timeline for all suppliers', async () => {
        const r = await qs.getEntityTimeline(db, ORG, 'supplier', null);
        assert.ok(r.total >= 3);
    });
    await test('timeline filter by action', async () => {
        const r = await qs.getEntityTimeline(db, ORG, 'supplier', null, { action: 'CREATE' });
        assert.ok(r.total >= 3);
        assert.ok(r.events.every(e => e.action === 'CREATE'));
    });
    await test('timeline filter by actor', async () => {
        const r = await qs.getEntityTimeline(db, ORG, 'supplier', null, { actor: UA });
        assert.ok(r.events.every(e => e.actor_user_id === UA));
    });
    await test('status changes for order', async () => {
        const r = await qs.getStatusChanges(db, ORG, 'purchase_order', 1);
        assert.ok(r.changes.length >= 2);
        assert.strictEqual(r.changes[0].from, 'DRAFT');
        assert.strictEqual(r.changes[0].to, 'SUBMITTED');
        assert.strictEqual(r.changes[1].from, 'SUBMITTED');
        assert.strictEqual(r.changes[1].to, 'ACKNOWLEDGED');
    });
    await test('timeline cross-tenant empty', async () => {
        assert.strictEqual((await qs.getEntityTimeline(db, OX, 'supplier', 1)).total, 0);
    });
    await test('timeline pagination', async () => {
        const r = await qs.getEntityTimeline(db, ORG, 'supplier', null, { limit: '2' });
        assert.strictEqual(r.events.length, 2);
        assert.ok(r.total >= 3);
    });

    // ── 9. SORT SAFETY ─────────────────────────────────────
    console.log('\n--- 9. Sort & Pagination Safety ---');

    await test('invalid sort field defaults to created_at', async () => {
        const r = await qs.querySuppliers(db, ORG, { sort_by: 'DROP TABLE suppliers--' });
        assert.strictEqual(r.success, true); // didn't crash, used safe default
    });
    await test('negative limit clamped', async () => {
        const r = await qs.querySuppliers(db, ORG, { limit: '-5' });
        assert.strictEqual(r.limit, 1);
    });
    await test('excessive limit clamped', async () => {
        const r = await qs.querySuppliers(db, ORG, { limit: '9999' });
        assert.strictEqual(r.limit, 200);
    });
    await test('negative offset clamped', async () => {
        const r = await qs.querySuppliers(db, ORG, { offset: '-10' });
        assert.strictEqual(r.offset, 0);
    });
    await test('valid sort fields are whitelisted', async () => {
        assert.ok(qs.VALID_SORT_FIELDS.supplier.includes('name'));
        assert.ok(qs.VALID_SORT_FIELDS.supplier.includes('rating'));
        assert.ok(!qs.VALID_SORT_FIELDS.supplier.includes('password'));
    });

    // ── 10. FILES ──────────────────────────────────────────
    console.log('\n--- 10. File Integrity ---');

    await test('query-service.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'query-service.js'))); });
    await test('routes include query paths', async () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'supply-chain.js'), 'utf-8');
        assert.ok(routes.includes('/query/suppliers'));
        assert.ok(routes.includes('/query/orders'));
        assert.ok(routes.includes('/suppliers/:id/parts'));
        assert.ok(routes.includes('/orders/:id/line-items'));
        assert.ok(routes.includes('/timeline/'));
    });

    // Cleanup
    logger.configure({ silent: false }); if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 34 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
