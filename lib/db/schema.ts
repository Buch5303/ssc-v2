import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// User roles for route authorization (AUTO-050)
// Single source of truth — middleware, session, and permission maps all import from here
export type UserRole = 'admin' | 'procurement_manager' | 'viewer';

// RFQs table
export const rfqs = pgTable('rfqs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// Audit logs table - IMMUTABLE: No UPDATE/DELETE operations permitted
// Recommendation: Implement DB-level row security policy to enforce INSERT-only access
// This table maintains complete audit trail for data lineage and financial integrity
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  entityTypeIdIdx: index('audit_logs_entity_type_entity_id_idx').on(table.entity_type, table.entity_id),
}));

// Authorization audit log table - APPEND-ONLY: enforced at DB level via trigger and rules
// Tracks all authorization decisions for compliance and security audit trails
export const authorizationAuditLog = pgTable('authorization_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  role: text('role').notNull(),
  http_method: text('http_method').notNull(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  ip_address: text('ip_address'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

// Access denied audit table - APPEND-ONLY: enforced at DB level via REVOKE permissions
// Tracks all access denial events for security monitoring and compliance
export const accessDeniedAudit = pgTable('access_denied_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  path: text('path').notNull(),
  method: text('method').notNull(),
  ip: text('ip'),
  reason: text('reason'),
  deniedAt: timestamp('denied_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userDeniedAtIdx: index('access_denied_audit_user_denied_at_idx').on(table.userId, table.deniedAt),
}));

// Type exports for authorization audit log
export type InsertAuthorizationAuditLog = InferInsertModel<typeof authorizationAuditLog>;
export type SelectAuthorizationAuditLog = InferSelectModel<typeof authorizationAuditLog>;

// Type exports for access denied audit
export type InsertAccessDeniedAudit = InferInsertModel<typeof accessDeniedAudit>;
export type SelectAccessDeniedAudit = InferSelectModel<typeof accessDeniedAudit>;

// --- TG20 / W251 procurement scope + supplier base (2026-06-26) ---
// Gives the DOR line items and qualified supplier base a real DB home in Neon,
// replacing the file-based supplier_network.json store. Confidential procurement
// data lives here, never in the repo. Loaded via POST /api/suppliers/ingest (admin-gated).

export const lineItems = pgTable('line_items', {
  id: text('id').primaryKey(),                       // e.g. TG20-001
  program: text('program').notNull().default('TG20'),
  item_no: text('item_no').notNull(),
  system_category: text('system_category'),
  equipment: text('equipment'),
  note: text('note'),
  responsibility: text('responsibility'),
  source_page: text('source_page'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  programIdx: index('line_items_program_idx').on(table.program),
}));

export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  program: text('program').notNull().default('TG20'),
  system_no: text('system_no'),
  system: text('system'),
  line_item_no: text('line_item_no').notNull(),
  line_item: text('line_item'),
  supplier_rank: text('supplier_rank'),
  supplier: text('supplier').notNull(),
  website: text('website'),
  contact_note: text('contact_note'),
  usa_first_status: text('usa_first_status'),
  location: text('location'),
  confidence: text('confidence'),
  fit_rationale: text('fit_rationale'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  programLineIdx: index('suppliers_program_line_item_no_idx').on(table.program, table.line_item_no),
}));

export type InsertLineItem = InferInsertModel<typeof lineItems>;
export type SelectLineItem = InferSelectModel<typeof lineItems>;
export type InsertSupplier = InferInsertModel<typeof suppliers>;
export type SelectSupplier = InferSelectModel<typeof suppliers>;
