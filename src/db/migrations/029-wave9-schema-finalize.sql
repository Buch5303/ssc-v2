-- ============================================================
-- Migration 029: Wave 9 Schema Finalization
-- ============================================================
-- Ensures all Wave 9 columns exist regardless of prior migration state.
-- Safe to run multiple times (all operations are idempotent).

-- supplier_contacts extended columns (migration 028 may have failed)
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS bop_category     TEXT;
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS seniority        TEXT;
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS currency_status  TEXT DEFAULT 'unverified';
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS enriched_at      TIMESTAMPTZ DEFAULT NOW();

-- contact_outreach table (full creation, idempotent)
CREATE TABLE IF NOT EXISTS contact_outreach (
    id              SERIAL PRIMARY KEY,
    contact_id      INTEGER,
    supplier_name   TEXT NOT NULL,
    outreach_type   TEXT DEFAULT 'rfq',
    status          TEXT DEFAULT 'draft',
    rfq_category    TEXT,
    rfq_content     TEXT,
    sent_at         TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (all IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_sc_bop_category   ON supplier_contacts(bop_category);
CREATE INDEX IF NOT EXISTS idx_sc_seniority       ON supplier_contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_sc_currency        ON supplier_contacts(currency_status);
CREATE INDEX IF NOT EXISTS idx_co_status          ON contact_outreach(status);
CREATE INDEX IF NOT EXISTS idx_co_supplier        ON contact_outreach(supplier_name);
CREATE INDEX IF NOT EXISTS idx_co_contact         ON contact_outreach(contact_id);
