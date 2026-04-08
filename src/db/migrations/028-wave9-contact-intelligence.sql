-- ============================================================
-- Migration 028: Wave 9 Contact Intelligence Tables
-- ============================================================
-- Defensive: handles pre-existing supplier_contacts table
-- from earlier sessions that may lack columns.

CREATE TABLE IF NOT EXISTS supplier_contacts (
    id              SERIAL PRIMARY KEY,
    supplier_tier_id INTEGER,
    supplier_name   TEXT NOT NULL,
    first_name      TEXT,
    last_name       TEXT,
    full_name       TEXT,
    title           TEXT,
    seniority       TEXT,
    linkedin_url    TEXT,
    email           TEXT,
    phone           TEXT,
    apollo_person_id TEXT,
    currency_status TEXT DEFAULT 'unverified',
    last_verified_at TIMESTAMPTZ,
    enriched_at     TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

-- Add columns that may be missing from pre-existing table
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS bop_category TEXT;
ALTER TABLE supplier_contacts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ DEFAULT NOW();

-- Indexes — all IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier  ON supplier_contacts(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_category  ON supplier_contacts(bop_category);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_seniority ON supplier_contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_currency  ON supplier_contacts(currency_status);

-- Contact outreach pipeline
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

CREATE INDEX IF NOT EXISTS idx_contact_outreach_status   ON contact_outreach(status);
CREATE INDEX IF NOT EXISTS idx_contact_outreach_supplier ON contact_outreach(supplier_name);
