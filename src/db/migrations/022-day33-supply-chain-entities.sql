-- Day 33: Supply Chain Entity Models
-- Suppliers, parts, purchase orders, shipments, inspections, certifications
-- Full data lineage via entity_history table

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    supplier_code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','BLACKLISTED')),
    category TEXT,
    country TEXT,
    contact_email TEXT,
    rating REAL,
    metadata_json TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(org_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    category TEXT,
    unit_of_measure TEXT DEFAULT 'EACH',
    supplier_id INTEGER,
    lead_time_days INTEGER,
    criticality TEXT DEFAULT 'STANDARD' CHECK (criticality IN ('STANDARD','CRITICAL','SAFETY')),
    metadata_json TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(org_id, part_number),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    po_number TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','ACKNOWLEDGED','IN_PRODUCTION','SHIPPED','DELIVERED','CLOSED','CANCELLED')),
    total_value REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    required_date TEXT,
    notes TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(org_id, po_number),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS po_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    po_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL,
    delivery_status TEXT DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','PARTIAL','DELIVERED','CANCELLED')),
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (part_id) REFERENCES parts(id)
);

CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    shipment_number TEXT NOT NULL,
    po_id INTEGER NOT NULL,
    carrier TEXT,
    tracking_number TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_TRANSIT','DELIVERED','EXCEPTION')),
    ship_date TEXT,
    eta TEXT,
    actual_delivery TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(org_id, shipment_number),
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
);

CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    shipment_id INTEGER NOT NULL,
    inspector_user_id TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('PASS','FAIL','CONDITIONAL','PENDING')),
    defect_count INTEGER DEFAULT 0,
    notes TEXT,
    inspection_date TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);

CREATE TABLE IF NOT EXISTS certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    cert_type TEXT NOT NULL,
    cert_number TEXT,
    issuer TEXT,
    issue_date TEXT,
    expiry_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','PENDING')),
    document_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- Data Lineage: immutable history of all entity changes
CREATE TABLE IF NOT EXISTS entity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','IMPORT','STATUS_CHANGE')),
    actor_user_id TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    field_changes_json TEXT DEFAULT '{}',
    previous_values_json TEXT DEFAULT '{}',
    new_values_json TEXT DEFAULT '{}',
    correlation_id TEXT,
    created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(org_id, status);
CREATE INDEX IF NOT EXISTS idx_parts_org ON parts(org_id);
CREATE INDEX IF NOT EXISTS idx_parts_supplier ON parts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_org ON purchase_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_poli_po ON po_line_items(po_id);
CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments(org_id);
CREATE INDEX IF NOT EXISTS idx_shipments_po ON shipments(po_id);
CREATE INDEX IF NOT EXISTS idx_inspections_shipment ON inspections(shipment_id);
CREATE INDEX IF NOT EXISTS idx_certs_supplier ON certifications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_history_entity ON entity_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_history_org ON entity_history(org_id);
CREATE INDEX IF NOT EXISTS idx_history_actor ON entity_history(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON entity_history(created_at);

-- Immutability: entity_history is append-only
CREATE TRIGGER IF NOT EXISTS trg_history_no_delete
BEFORE DELETE ON entity_history
BEGIN
    SELECT RAISE(ABORT, 'LINEAGE_VIOLATION: entity history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_history_no_update
BEFORE UPDATE ON entity_history
BEGIN
    SELECT RAISE(ABORT, 'LINEAGE_VIOLATION: entity history is immutable');
END;
