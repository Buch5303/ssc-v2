'use strict';
/**
 * FlowSeer Demo Seed Script
 * Populates the database with realistic industrial power generation supply chain data.
 * Run: node scripts/seed-demo.js
 */

require('dotenv').config();
const { initDatabase } = require('../src/db/database');

const SUPPLIERS = [
  { name: 'Siemens Energy AG', category: 'OEM', status: 'active', country: 'DE', risk_score: 15 },
  { name: 'GE Vernova', category: 'OEM', status: 'active', country: 'US', risk_score: 12 },
  { name: 'Sulzer Ltd', category: 'Aftermarket', status: 'active', country: 'CH', risk_score: 22 },
  { name: 'Chromalloy Gas Turbine', category: 'Repair', status: 'active', country: 'US', risk_score: 18 },
  { name: 'MTU Maintenance', category: 'MRO', status: 'active', country: 'DE', risk_score: 14 },
  { name: 'Parker Hannifin', category: 'Components', status: 'active', country: 'US', risk_score: 20 },
  { name: 'Honeywell Process', category: 'Controls', status: 'active', country: 'US', risk_score: 16 },
  { name: 'Turbine Truck Engines', category: 'Aftermarket', status: 'active', country: 'US', risk_score: 35 },
  { name: 'TransDigm Group', category: 'Components', status: 'active', country: 'US', risk_score: 28 },
  { name: 'Howmet Aerospace', category: 'Castings', status: 'active', country: 'US', risk_score: 19 },
  { name: 'API Technologies', category: 'Electronics', status: 'watch', country: 'US', risk_score: 42 },
  { name: 'Heico Corporation', category: 'Aftermarket', status: 'active', country: 'US', risk_score: 21 },
];

const PARTS = [
  { part_number: 'W251-HP-BLADE-001', name: 'HP Turbine Blade Stage 1', category: 'Hot Section', unit_cost: 28500, status: 'active' },
  { part_number: 'W251-HP-BLADE-002', name: 'HP Turbine Blade Stage 2', category: 'Hot Section', unit_cost: 24200, status: 'active' },
  { part_number: 'W251-NOZZLE-001', name: 'First Stage Nozzle Assembly', category: 'Hot Section', unit_cost: 85000, status: 'active' },
  { part_number: 'W251-COMB-001', name: 'Combustion Liner', category: 'Combustor', unit_cost: 42000, status: 'active' },
  { part_number: 'W251-FUEL-NOZZLE', name: 'Fuel Nozzle Assembly', category: 'Combustor', unit_cost: 12800, status: 'active' },
  { part_number: 'W251-COMP-BLADE-R1', name: 'Compressor Blade Row 1', category: 'Cold Section', unit_cost: 8400, status: 'active' },
  { part_number: 'W251-COMP-BLADE-R2', name: 'Compressor Blade Row 2', category: 'Cold Section', unit_cost: 7800, status: 'active' },
  { part_number: 'W251-BEARING-1', name: 'Forward Journal Bearing', category: 'Mechanical', unit_cost: 15200, status: 'active' },
  { part_number: 'W251-BEARING-2', name: 'Aft Journal Bearing', category: 'Mechanical', unit_cost: 14800, status: 'active' },
  { part_number: 'W251-SEAL-HP', name: 'HP Turbine Seal Pack', category: 'Seals', unit_cost: 6200, status: 'active' },
  { part_number: 'W251-INLET-GUIDE', name: 'Inlet Guide Vane Assembly', category: 'Cold Section', unit_cost: 38000, status: 'active' },
  { part_number: 'W251-CTRL-VALVE', name: 'Fuel Control Valve', category: 'Controls', unit_cost: 9800, status: 'active' },
  { part_number: 'W251-FILTER-ASSY', name: 'Oil Filter Assembly', category: 'Lube System', unit_cost: 1200, status: 'active' },
  { part_number: 'W251-CONN-ROD', name: 'Connecting Rod Assembly', category: 'Mechanical', unit_cost: 4500, status: 'obsolete' },
  { part_number: 'GE7FA-BLADE-001', name: 'GE 7FA Stage 1 Bucket', category: 'Hot Section', unit_cost: 52000, status: 'active' },
  { part_number: 'GE7FA-SHROUD-001', name: 'GE 7FA Blade Shroud', category: 'Hot Section', unit_cost: 18500, status: 'active' },
  { part_number: 'CTRL-PLC-MKVI', name: 'MK VI Control Card', category: 'Controls', unit_cost: 28000, status: 'active' },
  { part_number: 'SENSOR-EGT-001', name: 'EGT Thermocouple Assembly', category: 'Instrumentation', unit_cost: 2400, status: 'active' },
];

const WAREHOUSES = [
  { name: 'TWP Houston Hub', location: 'Houston, TX', status: 'active', capacity: 50000 },
  { name: 'TWP Newark MRO Center', location: 'Newark, NJ', status: 'active', capacity: 35000 },
  { name: 'TWP Dubai Depot', location: 'Dubai, UAE', status: 'active', capacity: 20000 },
];

const APPROVAL_REQUESTS = [
  { action_key: 'SUPPLIER_QUALIFY', risk_level: 'HIGH', status: 'APPROVED', org: 'twp', user: 'gbuchanan' },
  { action_key: 'PO_APPROVE_LARGE', risk_level: 'HIGH', status: 'APPROVED', org: 'twp', user: 'gbuchanan' },
  { action_key: 'PART_QUALIFY_NEW', risk_level: 'MEDIUM', status: 'APPROVED', org: 'twp', user: 'gbuchanan' },
  { action_key: 'SUPPLIER_QUALIFY', risk_level: 'MEDIUM', status: 'PENDING', org: 'twp', user: 'ops-team' },
  { action_key: 'PO_APPROVE_LARGE', risk_level: 'HIGH', status: 'PENDING', org: 'twp', user: 'ops-team' },
  { action_key: 'INVENTORY_ADJUST', risk_level: 'LOW', status: 'APPROVED', org: 'twp', user: 'warehouse-mgr' },
  { action_key: 'VENDOR_PAYMENT', risk_level: 'MEDIUM', status: 'APPROVED', org: 'twp', user: 'finance' },
  { action_key: 'PART_OBSOLETE', risk_level: 'LOW', status: 'REJECTED', org: 'twp', user: 'engineering' },
  { action_key: 'EMERGENCY_PO', risk_level: 'HIGH', status: 'APPROVED', org: 'twp', user: 'gbuchanan' },
  { action_key: 'SUPPLIER_DISQUALIFY', risk_level: 'HIGH', status: 'PENDING', org: 'twp', user: 'ops-team' },
  { action_key: 'INVENTORY_ADJUST', risk_level: 'LOW', status: 'APPROVED', org: 'twp', user: 'warehouse-mgr' },
  { action_key: 'PART_QUALIFY_NEW', risk_level: 'LOW', status: 'APPROVED', org: 'twp', user: 'engineering' },
];

async function seed() {
  console.log('🌱 FlowSeer Demo Seed — starting...');
  const db = await initDatabase();

  let suppliersInserted = 0;
  let partsInserted = 0;
  let warehousesInserted = 0;
  let approvalsInserted = 0;

  // Seed suppliers
  for (const s of SUPPLIERS) {
    try {
      await db.prepare(
        `INSERT INTO suppliers (org_id, name, category, status, country, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run('twp', s.name, s.category, s.status, s.country, JSON.stringify({ risk_score: s.risk_score }));
      suppliersInserted++;
    } catch (e) {
      if (!e.message?.includes('UNIQUE') && !e.message?.includes('unique')) {
        console.warn(`  Supplier skip: ${s.name} — ${e.message}`);
      }
    }
  }

  // Seed parts
  for (const p of PARTS) {
    try {
      await db.prepare(
        `INSERT INTO parts (org_id, part_number, name, category, unit_cost, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run('twp', p.part_number, p.name, p.category, p.unit_cost, p.status, JSON.stringify({}));
      partsInserted++;
    } catch (e) {
      if (!e.message?.includes('UNIQUE') && !e.message?.includes('unique')) {
        console.warn(`  Part skip: ${p.part_number} — ${e.message}`);
      }
    }
  }

  // Seed warehouses
  for (const w of WAREHOUSES) {
    try {
      await db.prepare(
        `INSERT INTO warehouses (org_id, name, location, status, capacity, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run('twp', w.name, w.location, w.status, w.capacity, JSON.stringify({}));
      warehousesInserted++;
    } catch (e) {
      if (!e.message?.includes('UNIQUE') && !e.message?.includes('unique')) {
        console.warn(`  Warehouse skip: ${w.name} — ${e.message}`);
      }
    }
  }

  // Seed approval requests
  for (const a of APPROVAL_REQUESTS) {
    try {
      // Get or create approval policy
      let policy = await db.prepare(
        `SELECT id FROM approval_policies WHERE org_id = ? AND action_key = ? LIMIT 1`
      ).get(a.org, a.action_key);

      if (!policy) {
        await db.prepare(
          `INSERT INTO approval_policies (org_id, action_key, approval_mode, risk_level, is_active)
           VALUES (?, ?, ?, ?, 1)`
        ).run(a.org, a.action_key, a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE', a.risk_level);
        policy = await db.prepare(
          `SELECT id FROM approval_policies WHERE org_id = ? AND action_key = ? LIMIT 1`
        ).get(a.org, a.action_key);
      }

      const requestResult = await db.prepare(
        `INSERT INTO approval_requests
         (org_id, target_type, target_id, action_key, request_status, approval_mode, risk_level,
          requested_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ABS(RANDOM() % 30) || ' days'), datetime('now'))`
      ).run(
        a.org, 'supply_chain_entity', 'demo-' + Math.random().toString(36).slice(2,8),
        a.action_key, a.status,
        a.risk_level === 'HIGH' ? 'DUAL' : 'SINGLE',
        a.risk_level, a.user
      );

      // Set approver for approved requests
      if (a.status === 'APPROVED' && requestResult.lastInsertRowid) {
        await db.prepare(
          `UPDATE approval_requests SET approved_by_user_id = ?, resolved_at = datetime('now')
           WHERE id = ?`
        ).run('gbuchanan', requestResult.lastInsertRowid);
      }

      approvalsInserted++;
    } catch (e) {
      console.warn(`  Approval skip: ${a.action_key} — ${e.message}`);
    }
  }

  console.log(`✅ Seed complete:`);
  console.log(`   Suppliers: ${suppliersInserted}/${SUPPLIERS.length}`);
  console.log(`   Parts: ${partsInserted}/${PARTS.length}`);
  console.log(`   Warehouses: ${warehousesInserted}/${WAREHOUSES.length}`);
  console.log(`   Approval requests: ${approvalsInserted}/${APPROVAL_REQUESTS.length}`);
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
