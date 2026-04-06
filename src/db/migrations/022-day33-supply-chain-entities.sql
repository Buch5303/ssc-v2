-- Day 33: Supply Chain Entity Models
-- Suppliers, parts, purchase orders, shipments, inspections, certifications
-- Full data lineage via entity_history table

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    supplier_code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
    category TEXT,
    country TEXT,
    rating REAL DEFAULT 0,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, supplier_code)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_status ON suppliers(org_id, status);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_country ON suppliers(org_id, country);

CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    criticality TEXT CHECK (criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    supplier_id INTEGER,
    lead_time_days INTEGER DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, part_number),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);
CREATE INDEX IF NOT EXISTS idx_parts_org_supplier ON parts(org_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_parts_org_criticality ON parts(org_id, criticality);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    po_number TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','APPROVED','ORDERED','RECEIVED','CANCELLED')),
    total_value REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    required_date TEXT,
    notes TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, po_number),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);
CREATE INDEX IF NOT EXISTS idx_po_org_status ON purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_po_org_supplier ON purchase_orders(org_id, supplier_id);

CREATE TABLE IF NOT EXISTS po_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    po_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (part_id) REFERENCES parts(id)
);
CREATE INDEX IF NOT EXISTS idx_po_lines_org_po ON po_line_items(org_id, po_id);

CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    shipment_number TEXT NOT NULL,
    po_id INTEGER,
    carrier TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_TRANSIT','DELIVERED','DELAYED','CANCELLED')),
    eta TEXT,
    delivered_at TEXT,
    tracking_number TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, shipment_number),
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_shipments_org_status ON shipments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_org_po ON shipments(org_id, po_id);

CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    shipment_id INTEGER NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('PASS','FAIL','HOLD')),
    inspector_user_id TEXT NOT NULL,
    defects_count INTEGER DEFAULT 0,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inspections_org_shipment ON inspections(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    cert_type TEXT NOT NULL,
    cert_number TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
    issued_at TEXT,
    expires_at TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);
CREATE INDEX IF NOT EXISTS idx_certs_org_supplier ON certifications(org_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_certs_org_status ON certifications(org_id, status);

CREATE TABLE IF NOT EXISTS entity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    previous_values TEXT,
    new_values TEXT,
    field_changes TEXT,
    correlation_id TEXT,
    source TEXT DEFAULT 'app',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entity_history_lookup ON entity_history(org_id, entity_type, entity_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_entity_history_no_update
BEFORE UPDATE ON entity_history
BEGIN
    SELECT RAISE(ABORT, 'entity_history_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_history_no_delete
BEFORE DELETE ON entity_history
BEGIN
    SELECT RAISE(ABORT, 'entity_history_append_only');
END;
