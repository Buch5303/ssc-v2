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
const ORG = 'org-d34';
const OX = 'org-evil-d34';
const UA = 'user-a';

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

async function seedData() {
    // Suppliers
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-A', name: 'Acme Supply', category: 'Fasteners', country: 'US', rating: 4.8, actor_user_id: UA });
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-B', name: 'Beta Electronics', category: 'Electronics', country: 'DE', rating: 4.2, actor_user_id: UA });
    await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-C', name: 'Cobra Logistics', category: 'Logistics', country: 'US', rating: 3.9, actor_user_id: UA });

    // Parts
    await scs.createPart(db, { org_id: ORG, part_number: 'PN-100', description: 'Hex Bolt', category: 'Fasteners', supplier_id: 1, lead_time_days: 5, criticality: 'STANDARD', actor_user_id: UA });
    await scs.createPart(db, { org_id: ORG, part_number: 'PN-200', description: 'Safety Valve', category: 'Valves', supplier_id: 2, lead_time_days: 30, criticality: 'SAFETY', actor_user_id: UA });
    await scs.createPart(db, { org_id: ORG, part_number: 'PN-300', description: 'Control Chip', category: 'Electronics', supplier_id: 2, lead_time_days: 45, criticality: 'CRITICAL', actor_user_id: UA });

    // Orders
    await scs.createOrder(db, { org_id: ORG, po_number: 'PO-100', supplier_id: 1, actor_user_id: UA, total_value: 1500, required_date: '2026-04-15' });
    await scs.createOrder(db, { org_id: ORG, po_number: 'PO-200', supplier_id: 2, actor_user_id: UA, total_value: 25000, required_date: '2026-05-01' });
    await scs.createOrder(db, { org_id: ORG, po_number: 'PO-300', supplier_id: 2, actor_user_id: UA, total_value: 500, required_date: '2026-04-10' });

    await scs.updateOrderStatus(db, 1, { org_id: ORG, actor_user_id: UA, status: 'SUBMITTED' });
    await scs.updateOrderStatus(db, 2, { org_id: ORG, actor_user_id: UA, status: 'APPROVED' });

    // Line items
    await scs.addLineItem(db, { org_id: ORG, po_id: 1, part_id: 1, quantity: 100, unit_price: 2.5 });
    await scs.addLineItem(db, { org_id: ORG, po_id: 2, part_id: 2, quantity: 10, unit_price: 1200 });
    await scs.addLineItem(db, { org_id: ORG, po_id: 2, part_id: 3, quantity: 20, unit_price: 400 });

    // Shipments
    await scs.createShipment(db, { org_id: ORG, shipment_number: 'SHIP-100', po_id: 1, carrier: 'UPS', eta: '2026-04-12', actor_user_id: UA });
    await scs.createShipment(db, { org_id: ORG, shipment_number: 'SHIP-200', po_id: 2, carrier: 'DHL', eta: '2026-04-20', actor_user_id: UA });

    // Certifications
    await scs.createCertification(db, { org_id: ORG, supplier_id: 1, cert_type: 'ISO9001', cert_number: 'ISO-001', status: 'ACTIVE', expiry_date: '2027-01-01', actor_user_id: UA });
    await scs.createCertification(db, { org_id: ORG, supplier_id: 2, cert_type: 'AS9100', cert_number: 'AS-001', status: 'ACTIVE', expiry_date: '2026-06-01', actor_user_id: UA });

    // Inspections
    await scs.createInspection(db, { org_id: ORG, shipment_id: 1, inspector_user_id: UA, result: 'PASS', defect_count: 0 });
    await scs.createInspection(db, { org_id: ORG, shipment_id: 2, inspector_user_id: UA, result: 'HOLD', defect_count: 3 });
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 34: Query & API Expansion');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true });
    metrics.reset();

    db = await createDatabase();
    // Load migrations
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) { try { db.exec(s + ';'); } catch {} }
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '022-day33-supply-chain-entities.sql'), 'utf-8')); } catch {}
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}
    policyRegistry.clearOrgPolicies();

    await seedData();

    // ── 1. ADVANCED SUPPLIER QUERIES ───────────────────────
    console.log('\n--- 1. Supplier Queries ---');
    await test('query by status', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, status: 'ACTIVE' });
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.total, 3);
    });
    await test('query by category', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, category: 'Electronics' });
        assert.strictEqual(r.suppliers.length, 1);
        assert.strictEqual(r.suppliers[0].name, 'Beta Electronics');
    });
    await test('query by country', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, country: 'US' });
        assert.strictEqual(r.suppliers.length, 2);
    });
    await test('query by min_rating', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, min_rating: 4.5 });
        assert.strictEqual(r.suppliers.length, 1);
        assert.strictEqual(r.suppliers[0].supplier_code, 'SUP-A');
    });
    await test('supplier search', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, search: 'Beta' });
        assert.strictEqual(r.suppliers.length, 1);
        assert.strictEqual(r.suppliers[0].supplier_code, 'SUP-B');
    });
    await test('supplier sort whitelist safety', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, sort_by: 'drop table suppliers', sort_dir: 'asc' });
        assert.strictEqual(r.success, true);
        assert.ok(Array.isArray(r.suppliers));
    });
    await test('supplier pagination clamp', async () => {
        const r = await qs.querySuppliers(db, { org_id: ORG, limit: 9999, offset: -5 });
        assert.ok(r.suppliers.length <= 200);
    });

    // ── 2. PART QUERIES ────────────────────────────────────
    console.log('\n--- 2. Part Queries ---');
    await test('query parts by category', async () => {
        const r = await qs.queryParts(db, { org_id: ORG, category: 'Electronics' });
        assert.strictEqual(r.parts.length, 1);
        assert.strictEqual(r.parts[0].part_number, 'PN-300');
    });
    await test('query parts by criticality', async () => {
        const r = await qs.queryParts(db, { org_id: ORG, criticality: 'CRITICAL' });
        assert.strictEqual(r.parts.length, 1);
        assert.strictEqual(r.parts[0].part_number, 'PN-300');
    });
    await test('query parts by supplier', async () => {
        const r = await qs.queryParts(db, { org_id: ORG, supplier_id: 2 });
        assert.strictEqual(r.parts.length, 2);
    });
    await test('query parts by lead time', async () => {
        const r = await qs.queryParts(db, { org_id: ORG, max_lead_time: 10 });
        assert.strictEqual(r.parts.length, 1);
        assert.strictEqual(r.parts[0].part_number, 'PN-100');
    });
    await test('part search', async () => {
        const r = await qs.queryParts(db, { org_id: ORG, search: 'Valve' });
        assert.strictEqual(r.parts.length, 1);
        assert.strictEqual(r.parts[0].part_number, 'PN-200');
    });

    // ── 3. ORDER QUERIES ───────────────────────────────────
    console.log('\n--- 3. Order Queries ---');
    await test('query orders by status', async () => {
        const r = await qs.queryOrders(db, { org_id: ORG, status: 'APPROVED' });
        assert.strictEqual(r.orders.length, 1);
        assert.strictEqual(r.orders[0].po_number, 'PO-200');
    });
    await test('query orders by supplier', async () => {
        const r = await qs.queryOrders(db, { org_id: ORG, supplier_id: 2 });
        assert.strictEqual(r.orders.length, 2);
    });
    await test('query orders by value range', async () => {
        const r = await qs.queryOrders(db, { org_id: ORG, min_value: 1000, max_value: 10000 });
        assert.strictEqual(r.orders.length, 1);
        assert.strictEqual(r.orders[0].po_number, 'PO-100');
    });
    await test('query orders by required date range', async () => {
        const r = await qs.queryOrders(db, { org_id: ORG, required_after: '2026-04-11', required_before: '2026-04-30' });
        assert.strictEqual(r.orders.length, 1);
        assert.strictEqual(r.orders[0].po_number, 'PO-100');
    });

    // ── 4. SHIPMENT / CERT / INSPECTION QUERIES ────────────
    console.log('\n--- 4. Shipment/Cert/Inspection Queries ---');
    await test('query shipments by carrier', async () => {
        const r = await qs.queryShipments(db, { org_id: ORG, carrier: 'DHL' });
        assert.strictEqual(r.shipments.length, 1);
        assert.strictEqual(r.shipments[0].shipment_number, 'SHIP-200');
    });
    await test('query shipments by eta range', async () => {
        const r = await qs.queryShipments(db, { org_id: ORG, eta_after: '2026-04-15', eta_before: '2026-04-25' });
        assert.strictEqual(r.shipments.length, 1);
        assert.strictEqual(r.shipments[0].shipment_number, 'SHIP-200');
    });
    await test('query certifications expiring before', async () => {
        const r = await qs.queryCertifications(db, { org_id: ORG, expiring_before: '2026-12-31' });
        assert.strictEqual(r.certifications.length, 1);
        assert.strictEqual(r.certifications[0].cert_type, 'AS9100');
    });
    await test('query inspections by result', async () => {
        const r = await qs.queryInspections(db, { org_id: ORG, result: 'HOLD' });
        assert.strictEqual(r.inspections.length, 1);
        assert.strictEqual(r.inspections[0].defect_count, 3);
    });
    await test('query inspections by min_defects', async () => {
        const r = await qs.queryInspections(db, { org_id: ORG, min_defects: 1 });
        assert.strictEqual(r.inspections.length, 1);
        assert.strictEqual(r.inspections[0].result, 'HOLD');
    });

    // ── 5. RELATIONSHIP TRAVERSAL ──────────────────────────
    console.log('\n--- 5. Relationship Traversal ---');
    await test('supplier -> parts', async () => {
        const r = await qs.getSupplierParts(db, 2, ORG);
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.parts.length, 2);
    });
    await test('supplier -> certifications', async () => {
        const r = await qs.getSupplierCertifications(db, 2, ORG);
        assert.strictEqual(r.certifications.length, 1);
        assert.strictEqual(r.certifications[0].cert_type, 'AS9100');
    });
    await test('supplier -> orders', async () => {
        const r = await qs.getSupplierOrders(db, 2, ORG);
        assert.strictEqual(r.orders.length, 2);
    });
    await test('order -> line items', async () => {
        const r = await qs.getOrderLineItems(db, 2, ORG);
        assert.strictEqual(r.line_items.length, 2);
    });
    await test('order -> shipments', async () => {
        const r = await qs.getOrderShipments(db, 2, ORG);
        assert.strictEqual(r.shipments.length, 1);
        assert.strictEqual(r.shipments[0].shipment_number, 'SHIP-200');
    });
    await test('shipment -> inspections', async () => {
        const r = await qs.getShipmentInspections(db, 2, ORG);
        assert.strictEqual(r.inspections.length, 1);
        assert.strictEqual(r.inspections[0].result, 'HOLD');
    });

    // ── 6. TIMELINE / HISTORY ──────────────────────────────
    console.log('\n--- 6. Timeline / History ---');
    await test('entity timeline by type', async () => {
        const r = await qs.getEntityTimeline(db, 'supplier', { org_id: ORG });
        assert.strictEqual(r.success, true);
        assert.ok(r.events.length >= 3);
    });
    await test('entity timeline scoped to entity', async () => {
        const r = await qs.getEntityTimeline(db, 'supplier', { org_id: ORG, entity_id: 1 });
        assert.ok(r.events.every(e => String(e.entity_id) === '1'));
    });
    await test('status changes query', async () => {
        const r = await qs.getStatusChanges(db, 'purchase_order', 1, ORG);
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.status_changes.length, 1);
        assert.strictEqual(r.status_changes[0].field_changes_json.status.to, 'SUBMITTED');
    });
    await test('import provenance query', async () => {
        // Create a provenance entry manually for test realism
        await entityHistory.recordHistory(db, {
            orgId: ORG, entityType: 'supplier', entityId: 99, action: 'CREATE', actorUserId: UA,
            source: 'bulk_import', newValues: { supplier_code: 'IMP-1' }
        });
        const r = await qs.getImportProvenance(db, 'supplier', { org_id: ORG });
        assert.strictEqual(r.success, true);
        assert.ok(r.imports.length >= 1);
    });

    // ── 7. TENANT SAFETY ───────────────────────────────────
    console.log('\n--- 7. Tenant Safety ---');
    await test('cross-tenant supplier query empty', async () => {
        const r = await qs.querySuppliers(db, { org_id: OX });
        assert.strictEqual(r.total, 0);
    });
    await test('cross-tenant traversal blocked', async () => {
        const r = await qs.getSupplierParts(db, 1, OX);
        assert.strictEqual(r.error, 'supplier_not_found');
    });
    await test('cross-tenant order traversal blocked', async () => {
        const r = await qs.getOrderLineItems(db, 1, OX);
        assert.strictEqual(r.error, 'order_not_found');
    });

    // ── 8. FILE PRESENCE ───────────────────────────────────
    console.log('\n--- 8. File Presence ---');
    await test('query-service.js exists', async () => {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'query-service.js')));
    });
    await test('day34 test file exists', async () => {
        assert.ok(fs.existsSync(path.join(__dirname, 'day34-query-api-tests.js')));
    });

    // Cleanup
    logger.configure({ silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 34 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
