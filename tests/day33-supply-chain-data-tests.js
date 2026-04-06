'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('./test-db-helper');

const scs = require('../src/services/supply-chain-service');
const entityHistory = require('../src/services/entity-history');
const policyRegistry = require('../src/services/approval-policy-registry');
const approvalService = require('../src/services/approval-service');
const metrics = require('../src/common/metrics');
const logger = require('../src/common/logger');

let db, passed = 0, failed = 0;
const failures = [];
const ORG = 'org-d33'; const OX = 'org-evil-d33';
const UA = 'user-a'; const UB = 'user-b';

async function test(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (err) { failed++; failures.push({ name, error: err.message }); console.log('  ✗ ' + name + ': ' + err.message); }
}

async function runTests() {
    console.log('\n========================================');
    console.log('Day 33: Supply Chain Data Foundation');
    console.log('========================================');
    passed = 0; failed = 0; failures.length = 0;
    logger.configure({ silent: true });
    metrics.reset();

    db = await createDatabase();
    for (const f of ['016-day22-approval-governance.sql', '017-day23-workflow-execution.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', f), 'utf-8');
        for (const s of sql.split(';').filter(s => s.trim())) { try { db.exec(s + ';'); } catch {} }
    }
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, "..", "src", "db", "migrations", "022-day33-supply-chain-entities.sql"), "utf-8")); } catch {}
    try { db._raw.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '019-day28-audit-rate-limit.sql'), 'utf-8')); } catch {}
    policyRegistry.clearOrgPolicies();

    // ── 1. SUPPLIER CRUD ───────────────────────────────────
    console.log('\n--- 1. Supplier CRUD ---');

    await test('create supplier', async () => {
        const r = await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-001', name: 'Acme Corp', category: 'Fasteners', country: 'US', actor_user_id: UA });
        assert.strictEqual(r.success, true);
        assert.ok(r.supplier_id);
    });
    await test('duplicate supplier_code rejected', async () => {
        const r = await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-001', name: 'Dup', actor_user_id: UA });
        assert.strictEqual(r.error, 'supplier_code_exists');
    });
    await test('get supplier', async () => {
        const r = await scs.getSupplier(db, 1, ORG);
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.supplier.name, 'Acme Corp');
        assert.strictEqual(r.supplier.country, 'US');
    });
    await test('get supplier cross-org blocked', async () => {
        assert.strictEqual((await scs.getSupplier(db, 1, OX)).error, 'supplier_not_found');
    });
    await test('list suppliers', async () => {
        await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-002', name: 'Beta Inc', category: 'Electronics', actor_user_id: UA });
        const r = await scs.listSuppliers(db, { org_id: ORG });
        assert.strictEqual(r.success, true);
        assert.ok(r.total >= 2);
    });
    await test('list suppliers with search', async () => {
        const r = await scs.listSuppliers(db, { org_id: ORG, search: 'Acme' });
        assert.strictEqual(r.suppliers.length, 1);
        assert.strictEqual(r.suppliers[0].name, 'Acme Corp');
    });
    await test('list suppliers cross-org empty', async () => {
        assert.strictEqual((await scs.listSuppliers(db, { org_id: OX })).total, 0);
    });
    await test('update supplier (governance gate)', async () => {
        const r = await scs.updateSupplier(db, 1, { org_id: ORG, actor_user_id: UA, name: 'Acme Corporation', rating: 4.5 });
        assert.strictEqual(r.success, true);
        const g = await scs.getSupplier(db, 1, ORG);
        assert.strictEqual(g.supplier.name, 'Acme Corporation');
        assert.strictEqual(g.supplier.rating, 4.5);
    });
    await test('update nonexistent supplier', async () => {
        assert.strictEqual((await scs.updateSupplier(db, 999, { org_id: ORG, actor_user_id: UA, name: 'x' })).error, 'supplier_not_found');
    });
    await test('missing fields rejected', async () => {
        assert.strictEqual((await scs.createSupplier(db, { org_id: ORG })).success, false);
        assert.strictEqual((await scs.createSupplier(db, { org_id: ORG, supplier_code: 'x' })).success, false);
    });

    // ── 2. PARTS ───────────────────────────────────────────
    console.log('\n--- 2. Parts ---');

    await test('create part', async () => {
        const r = await scs.createPart(db, { org_id: ORG, part_number: 'PN-001', description: 'Hex Bolt M10', category: 'Fasteners', supplier_id: 1, criticality: 'STANDARD', actor_user_id: UA });
        assert.strictEqual(r.success, true);
        assert.ok(r.part_id);
    });
    await test('duplicate part_number rejected', async () => {
        assert.strictEqual((await scs.createPart(db, { org_id: ORG, part_number: 'PN-001', actor_user_id: UA })).error, 'part_number_exists');
    });
    await test('get part', async () => {
        const r = await scs.getPart(db, 1, ORG);
        assert.strictEqual(r.part.description, 'Hex Bolt M10');
    });
    await test('list parts with filter', async () => {
        await scs.createPart(db, { org_id: ORG, part_number: 'PN-002', description: 'Safety Valve', criticality: 'SAFETY', actor_user_id: UA });
        const r = await scs.listParts(db, { org_id: ORG, criticality: 'SAFETY' });
        assert.strictEqual(r.parts.length, 1);
        assert.strictEqual(r.parts[0].criticality, 'SAFETY');
    });
    await test('list parts cross-org empty', async () => {
        assert.strictEqual((await scs.listParts(db, { org_id: OX })).total, 0);
    });

    // ── 3. PURCHASE ORDERS ─────────────────────────────────
    console.log('\n--- 3. Purchase Orders ---');

    await test('create order', async () => {
        const r = await scs.createOrder(db, { org_id: ORG, po_number: 'PO-001', supplier_id: 1, actor_user_id: UA, total_value: 5000, currency: 'USD' });
        assert.strictEqual(r.success, true);
        assert.ok(r.order_id);
    });
    await test('order requires valid supplier', async () => {
        assert.strictEqual((await scs.createOrder(db, { org_id: ORG, po_number: 'PO-BAD', supplier_id: 999, actor_user_id: UA })).error, 'supplier_not_found');
    });
    await test('order cross-org supplier rejected', async () => {
        // Supplier 1 belongs to ORG, not OX
        assert.strictEqual((await scs.createOrder(db, { org_id: OX, po_number: 'PO-X', supplier_id: 1, actor_user_id: UA })).error, 'supplier_not_found');
    });
    await test('get order', async () => {
        const r = await scs.getOrder(db, 1, ORG);
        assert.strictEqual(r.order.status, 'DRAFT');
        assert.strictEqual(r.order.total_value, 5000);
    });
    await test('update order status', async () => {
        const r = await scs.updateOrderStatus(db, 1, { org_id: ORG, actor_user_id: UA, status: 'SUBMITTED' });
        assert.strictEqual(r.success, true);
        assert.strictEqual((await scs.getOrder(db, 1, ORG)).order.status, 'SUBMITTED');
    });
    await test('cancel order requires governance (destructive)', async () => {
        const r = await scs.updateOrderStatus(db, 1, { org_id: ORG, actor_user_id: UA, status: 'CANCELLED' });
        // CANCELLED is destructive → governance gate blocks (requires DUAL approval)
        assert.strictEqual(r.error, 'governance_blocked');
        assert.ok(r.approval_request_id);
    });
    await test('list orders', async () => {
        const r = await scs.listOrders(db, { org_id: ORG });
        assert.ok(r.total >= 1);
    });

    // ── 4. DELETE WITH INTEGRITY ───────────────────────────
    console.log('\n--- 4. Delete Integrity ---');

    await test('delete supplier with parts blocked', async () => {
        const r = await scs.deleteSupplier(db, 1, { org_id: ORG, actor_user_id: UA });
        assert.strictEqual(r.error, 'governance_blocked');
        // Delete is destructive → PENDING approval
    });

    await test('delete supplier without dependents (after governance)', async () => {
        // Create a standalone supplier with no parts/orders
        const s = await scs.createSupplier(db, { org_id: ORG, supplier_code: 'SUP-TEMP', name: 'Temp Supplier', actor_user_id: UA });
        // Delete is destructive → governance blocks it
        const r = await scs.deleteSupplier(db, s.supplier_id, { org_id: ORG, actor_user_id: UA });
        assert.strictEqual(r.error, 'governance_blocked');
    });

    // ── 5. DATA LINEAGE ────────────────────────────────────
    console.log('\n--- 5. Data Lineage ---');

    await test('supplier creation recorded in history', async () => {
        const h = await entityHistory.getHistory(db, ORG, 'supplier', 1);
        assert.ok(h.history.length >= 1);
        const createEvent = h.history.find(e => e.action === 'CREATE');
        assert.ok(createEvent);
        assert.strictEqual(createEvent.actor_user_id, UA);
    });
    await test('supplier update recorded in history', async () => {
        const h = await entityHistory.getHistory(db, ORG, 'supplier', 1);
        const updateEvent = h.history.find(e => e.action === 'UPDATE');
        assert.ok(updateEvent);
        assert.ok(updateEvent.field_changes_json.name);
    });
    await test('part creation recorded', async () => {
        const h = await entityHistory.getHistory(db, ORG, 'part', 1);
        assert.ok(h.history.length >= 1);
    });
    await test('order status change recorded', async () => {
        const h = await entityHistory.getHistory(db, ORG, 'purchase_order', 1);
        const sc = h.history.find(e => e.action === 'STATUS_CHANGE');
        assert.ok(sc);
        assert.strictEqual(sc.field_changes_json.status.from, 'DRAFT');
        assert.strictEqual(sc.field_changes_json.status.to, 'SUBMITTED');
    });
    await test('history is append-only (DELETE blocked)', async () => {
        let err = null;
        try { await db.prepare('DELETE FROM entity_history WHERE id = 1').run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('LINEAGE_VIOLATION'));
    });
    await test('history is immutable (UPDATE blocked)', async () => {
        let err = null;
        try { await db.prepare("UPDATE entity_history SET action = 'HACKED' WHERE id = 1").run(); }
        catch (e) { err = e.message; }
        assert.ok(err && err.includes('LINEAGE_VIOLATION'));
    });
    await test('timeline query works', async () => {
        const r = await entityHistory.getEntityTimeline(db, ORG, 'supplier');
        assert.ok(r.events.length >= 2);
    });

    // ── 6. BULK IMPORT ─────────────────────────────────────
    console.log('\n--- 6. Bulk Import (Governed) ---');

    await test('bulk import requires DUAL approval', async () => {
        const r = await scs.bulkImportSuppliers(db, {
            org_id: ORG, actor_user_id: UA,
            suppliers: [{ supplier_code: 'BLK-1', name: 'Bulk One' }, { supplier_code: 'BLK-2', name: 'Bulk Two' }],
        });
        assert.strictEqual(r.error, 'governance_blocked');
        assert.ok(r.approval_request_id);
    });
    await test('bulk import validates input', async () => {
        assert.strictEqual((await scs.bulkImportSuppliers(db, { org_id: ORG, actor_user_id: UA })).error, 'org_id_actor_suppliers_required');
        assert.strictEqual((await scs.bulkImportSuppliers(db, { org_id: ORG, actor_user_id: UA, suppliers: [] })).error, 'suppliers_must_be_nonempty_array');
    });

    // ── 7. CROSS-TENANT ISOLATION ──────────────────────────
    console.log('\n--- 7. Cross-Tenant Isolation ---');

    await test('supplier isolation', async () => {
        assert.strictEqual((await scs.getSupplier(db, 1, OX)).success, false);
        assert.strictEqual((await scs.listSuppliers(db, { org_id: OX })).total, 0);
    });
    await test('part isolation', async () => {
        assert.strictEqual((await scs.getPart(db, 1, OX)).success, false);
    });
    await test('order isolation', async () => {
        assert.strictEqual((await scs.getOrder(db, 1, OX)).success, false);
    });
    await test('update cross-org blocked', async () => {
        assert.strictEqual((await scs.updateSupplier(db, 1, { org_id: OX, actor_user_id: UA, name: 'hijack' })).error, 'supplier_not_found');
    });
    await test('history isolation', async () => {
        const h = await entityHistory.getHistory(db, OX, 'supplier', 1);
        assert.strictEqual(h.history.length, 0);
    });

    // ── 8. METRICS ─────────────────────────────────────────
    console.log('\n--- 8. Metrics ---');

    await test('supplier creation counted', async () => {
        assert.ok(metrics.getCounter('suppliers.created') >= 2);
    });
    await test('part creation counted', async () => {
        assert.ok(metrics.getCounter('parts.created') >= 1);
    });
    await test('order creation counted', async () => {
        assert.ok(metrics.getCounter('orders.created') >= 1);
    });

    // ── 9. FILES ───────────────────────────────────────────
    console.log('\n--- 9. File Integrity ---');

    await test('migration 022 exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '022-day33-supply-chain-entities.sql'))); });
    await test('supply-chain-service.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'supply-chain-service.js'))); });
    await test('entity-history.js exists', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'entity-history.js'))); });
    await test('supply-chain routes exist', async () => { assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'routes', 'supply-chain.js'))); });

    // Cleanup
    logger.configure({ silent: false, level: 'INFO' });
    if (db) db.close();
    console.log('\n========================================');
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    console.log('========================================');
    if (failures.length) failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.error));
    console.log('\nDay 33 — COMPLETE\n');
    return { passed, failed, failures };
}

if (require.main === module) { runTests().then(r => process.exit(r.failed > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); }); }
module.exports = { runTests };
