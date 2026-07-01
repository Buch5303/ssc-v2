// lib/pricing/schema.ts
// ─────────────────────────────────────────────────────────────────────────────
// Idempotent bootstrap DDL for the Pricing Directives feature. Mirrors the
// pattern used by app/api/suppliers/ingest (CREATE TABLE IF NOT EXISTS at first
// use) so the feature is self-contained and does not depend on a migration
// runner. Purely additive — new tables only, prefixed `pd_`. Nothing existing
// is read or altered.

import pool from '@/lib/db/connection';
import { DEFAULT_MASTER_RULESET } from './masterRuleset';

let ensured = false;

export async function ensureTables(): Promise<void> {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pd_master_ruleset (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      rules       JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT pd_master_singleton CHECK (id = 1)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pd_directives (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT NOT NULL,
      directive_text TEXT NOT NULL,
      scope          TEXT NOT NULL DEFAULT 'line_item',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pd_data_points (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      line_item_key  TEXT NOT NULL,
      price_usd      NUMERIC(14,2) NOT NULL CHECK (price_usd > 0),
      source         TEXT NOT NULL,
      source_date    DATE NOT NULL,
      confidence     TEXT NOT NULL DEFAULT 'indicative',
      material_basis TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS pd_points_line_item_idx ON pd_data_points (line_item_key)`);

  // Seed the singleton master ruleset row with the default if empty.
  await pool.query(
    `INSERT INTO pd_master_ruleset (id, rules)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_MASTER_RULESET)]
  );

  ensured = true;
}
