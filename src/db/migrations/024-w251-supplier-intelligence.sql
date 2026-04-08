-- Day 36: W251 Supplier Intelligence Layer
-- Full supplier database: 271 suppliers, 203 contacts, tier/system coverage

CREATE TABLE IF NOT EXISTS supplier_intelligence (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    supplier_code   TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    supplier_type   TEXT,
    country         TEXT,
    region          TEXT,
    tier            TEXT,
    system_group    TEXT,
    system_tags     TEXT,
    scope           TEXT,
    website         TEXT,
    summary         TEXT,
    metadata_json   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    supplier_code   TEXT NOT NULL,
    supplier_name   TEXT NOT NULL,
    contact_name    TEXT NOT NULL,
    title           TEXT,
    email           TEXT,
    phone           TEXT,
    metadata_json   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_si_org ON supplier_intelligence(org_id);
CREATE INDEX IF NOT EXISTS idx_si_tier ON supplier_intelligence(org_id, tier);
CREATE INDEX IF NOT EXISTS idx_si_group ON supplier_intelligence(org_id, system_group);
CREATE INDEX IF NOT EXISTS idx_sc_org ON supplier_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_sc_supplier ON supplier_contacts(org_id, supplier_code);
