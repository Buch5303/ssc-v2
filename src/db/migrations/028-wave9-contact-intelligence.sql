-- ============================================================
-- Migration 028: Wave 9 Contact Intelligence Tables
-- ============================================================
-- Prepares the contact intelligence layer for Apollo Basic activation.
-- supplier_contacts stores enriched exec contacts per supplier.
-- contact_tasks tracks outreach pipeline state per contact.

CREATE TABLE IF NOT EXISTS supplier_contacts (
    id              SERIAL PRIMARY KEY,
    supplier_tier_id INTEGER REFERENCES supplier_tiers(id) ON DELETE CASCADE,
    supplier_name   TEXT NOT NULL,
    bop_category    TEXT,
    first_name      TEXT,
    last_name       TEXT,
    full_name       TEXT,
    title           TEXT,
    seniority       TEXT,  -- c_suite | vp | director | manager
    linkedin_url    TEXT,
    email           TEXT,
    phone           TEXT,
    apollo_person_id TEXT UNIQUE,
    currency_status TEXT DEFAULT 'unverified',  -- verified | unverified | stale | invalid
    last_verified_at TIMESTAMPTZ,
    enriched_at     TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_category ON supplier_contacts(bop_category);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_seniority ON supplier_contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_currency ON supplier_contacts(currency_status);

-- Contact outreach pipeline
CREATE TABLE IF NOT EXISTS contact_outreach (
    id              SERIAL PRIMARY KEY,
    contact_id      INTEGER REFERENCES supplier_contacts(id) ON DELETE CASCADE,
    supplier_name   TEXT NOT NULL,
    outreach_type   TEXT DEFAULT 'rfq',  -- rfq | intro | follow_up | meeting_request
    status          TEXT DEFAULT 'draft',  -- draft | sent | replied | meeting_set | declined | dead
    rfq_category    TEXT,
    rfq_content     TEXT,
    sent_at         TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_outreach_status ON contact_outreach(status);
CREATE INDEX IF NOT EXISTS idx_contact_outreach_supplier ON contact_outreach(supplier_name);
