-- 030_suppliers_lineitems.sql (2026-06-26)
-- DB home for TG20 / W251 procurement scope + qualified supplier base.
-- Idempotent; mirrored by the bootstrap DDL in app/api/suppliers/ingest.

CREATE TABLE IF NOT EXISTS line_items (
  id              TEXT PRIMARY KEY,
  program         TEXT NOT NULL DEFAULT 'TG20',
  item_no         TEXT NOT NULL,
  system_category TEXT,
  equipment       TEXT,
  note            TEXT,
  responsibility  TEXT,
  source_page     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS line_items_program_idx ON line_items (program);

CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program          TEXT NOT NULL DEFAULT 'TG20',
  system_no        TEXT,
  system           TEXT,
  line_item_no     TEXT NOT NULL,
  line_item        TEXT,
  supplier_rank    TEXT,
  supplier         TEXT NOT NULL,
  website          TEXT,
  contact_note     TEXT,
  usa_first_status TEXT,
  location         TEXT,
  confidence       TEXT,
  fit_rationale    TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_program_line_item_no_idx ON suppliers (program, line_item_no);
