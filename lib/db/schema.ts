import { pgEnum, pgTable, uuid, text, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

// Define the RFQ status enum
export const rfqStatusEnum = pgEnum('rfq_status_enum', ['draft', 'pending', 'awarded', 'closed']);

// RFQs table
export const rfqs = pgTable('rfqs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  status: rfqStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`)
});

// RFQ Line Items table
export const rfqLineItems = pgTable('rfq_line_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  rfqId: uuid('rfq_id').notNull().references(() => rfqs.id, { onDelete: 'cascade' }),
  description: text('description'),
  quantity: numeric('quantity', { precision: 12, scale: 4 }),
  unitPrice: numeric('unit_price', { precision: 12, scale: 4 })
});

// IMMUTABLE: No UPDATE or DELETE operations permitted on this table per EQS v1.0 audit clause
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tableName: text('table_name').notNull(),
  recordId: uuid('record_id'),
  action: text('action').notNull(),
  changedBy: text('changed_by').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().default(sql`now()`),
  payload: jsonb('payload')
});

// Export types
export type Rfq = InferSelectModel<typeof rfqs>;
export type NewRfq = InferInsertModel<typeof rfqs>;
export type RfqLineItem = InferSelectModel<typeof rfqLineItems>;
export type NewRfqLineItem = InferInsertModel<typeof rfqLineItems>;
export type AuditLog = InferSelectModel<typeof auditLog>;
export type NewAuditLog = InferInsertModel<typeof auditLog>;