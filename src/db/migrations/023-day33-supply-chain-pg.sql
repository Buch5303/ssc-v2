-- Day 33: Supply Chain Entity Models — PostgreSQL version
-- Converts SQLite AUTOINCREMENT → SERIAL, TEXT dates → TIMESTAMPTZ, TEXT json → JSONB

CREATE TABLE IF NOT EXISTS suppliers (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    supplier_code   TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','BLACKLISTED')),
    category        TEXT,
    country         TEXT,
    contact_email   TEXT,
    rating          NUMERIC,
    metadata_json   JSONB DEFAULT '{}',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS parts (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    part_number     TEXT NOT NULL,
    description     TEXT,
    category        TEXT,
    unit_of_measure TEXT DEFAULT 'EACH',
    supplier_id     INTEGER REFERENCES suppliers(id),
    lead_time_days  INTEGER,
    criticality     TEXT DEFAULT 'STANDARD' CHECK (criticality IN ('STANDARD','CRITICAL','SAFETY')),
    metadata_json   JSONB DEFAULT '{}',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, part_number)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    po_number       TEXT NOT NULL,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','ACKNOWLEDGED','IN_PRODUCTION','SHIPPED','DELIVERED','CLOSED','CANCELLED')),
    total_value     NUMERIC DEFAULT 0,
    currency        TEXT DEFAULT 'USD',
    required_date   TIMESTAMPTZ,
    notes           TEXT,
    metadata_json   JSONB DEFAULT '{}',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, po_number)
);

CREATE TABLE IF NOT EXISTS po_line_items (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    po_id           INTEGER NOT NULL REFERENCES purchase_orders(id),
    part_id         INTEGER NOT NULL REFERENCES parts(id),
    quantity        NUMERIC NOT NULL,
    unit_price      NUMERIC NOT NULL,
    line_total      NUMERIC NOT NULL,
    delivery_status TEXT DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','PARTIAL','DELIVERED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS shipments (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    shipment_number TEXT NOT NULL,
    po_id           INTEGER NOT NULL REFERENCES purchase_orders(id),
    carrier         TEXT,
    tracking_number TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_TRANSIT','DELIVERED','EXCEPTION')),
    ship_date       TIMESTAMPTZ,
    eta             TIMESTAMPTZ,
    actual_delivery TIMESTAMPTZ,
    metadata_json   JSONB DEFAULT '{}',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, shipment_number)
);

CREATE TABLE IF NOT EXISTS inspections (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    shipment_id     INTEGER NOT NULL REFERENCES shipments(id),
    inspector       TEXT NOT NULL,
    result          TEXT NOT NULL CHECK (result IN ('PASS','FAIL','CONDITIONAL')),
    notes           TEXT,
    inspected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_json   JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS certifications (
    id              SERIAL PRIMARY KEY,
    org_id          TEXT NOT NULL,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
    cert_type       TEXT NOT NULL,
    cert_number     TEXT,
    issuer          TEXT,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
    metadata_json   JSONB DEFAULT '{}',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_parts_org ON parts(org_id);
CREATE INDEX IF NOT EXISTS idx_po_org_status ON purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(org_id);
