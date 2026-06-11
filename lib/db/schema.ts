import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';

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
