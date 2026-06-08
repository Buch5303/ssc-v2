import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity_type: varchar('entity_type', { length: 64 }).notNull(),
  entity_id: varchar('entity_id', { length: 128 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  actor_id: varchar('actor_id', { length: 128 }).notNull(),
  payload: jsonb('payload'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export default auditLogs;