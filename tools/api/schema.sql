-- FlowSeer SSC V2 — Neon PostgreSQL Schema
-- Project Jupiter W251 BOP Intelligence Platform
-- Run this against your Neon database to initialize all tables

-- ═══════════════════════════════════════════
-- CONTACTS
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contacts (
    id              SERIAL PRIMARY KEY,
    full_name       VARCHAR(120) NOT NULL,
    first_name      VARCHAR(60),
    last_name       VARCHAR(60),
    company         VARCHAR(120),
    company_domain  VARCHAR(120),
    title           VARCHAR(120),
    email           VARCHAR(120),
    phone           VARCHAR(40),
    linkedin_url    VARCHAR(255),
    priority        VARCHAR(20)  DEFAULT 'NORMAL',  -- ACTIVE_RFQ | TIER1 | NORMAL
    category        VARCHAR(40),                     -- BOP category code
    rfq_status      VARCHAR(20)  DEFAULT 'NONE',     -- NONE | DRAFTED | SENT | RESPONDED
    verification_status VARCHAR(20) DEFAULT 'UNVERIFIED',
    verification_score  INTEGER DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_priority ON contacts(priority);
CREATE INDEX IF NOT EXISTS idx_contacts_company  ON contacts(company);
CREATE INDEX IF NOT EXISTS idx_contacts_rfq      ON contacts(rfq_status);

-- ═══════════════════════════════════════════
-- SUPPLIERS
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS suppliers (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    tier            INTEGER DEFAULT 3,               -- 1 | 2 | 3
    bop_categories  TEXT[],                          -- array of category codes
    domain          VARCHAR(120),
    hq_location     VARCHAR(120),
    annual_revenue  BIGINT,
    employee_count  INTEGER,
    avoid_flag      BOOLEAN DEFAULT FALSE,
    avoid_reason    TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tier   ON suppliers(tier);
CREATE INDEX IF NOT EXISTS idx_suppliers_avoid  ON suppliers(avoid_flag);

-- ═══════════════════════════════════════════
-- BOP PRICING
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bop_pricing (
    id               SERIAL PRIMARY KEY,
    category         VARCHAR(120) NOT NULL,
    category_code    VARCHAR(20)  UNIQUE NOT NULL,
    spend_tier       VARCHAR(20),                    -- STRATEGIC | TARGETED | STANDARD
    bom_low          BIGINT,
    bom_mid          BIGINT,
    bom_high         BIGINT,
    rfq_quoted       BIGINT,
    rfq_variance_pct DECIMAL(6,2),
    confidence_label VARCHAR(40) DEFAULT 'COMPONENT_BUILDUPS',
    confidence_score INTEGER     DEFAULT 65,
    preferred_supplier VARCHAR(120),
    avoid_supplier   VARCHAR(120),
    scenario_optimistic BIGINT,
    scenario_base    BIGINT,
    scenario_pessimistic BIGINT,
    last_updated     TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- RFQ PIPELINE
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rfq_pipeline (
    id               SERIAL PRIMARY KEY,
    rfq_id           VARCHAR(20) UNIQUE NOT NULL,
    contact_name     VARCHAR(120),
    company          VARCHAR(120),
    category         VARCHAR(120),
    category_code    VARCHAR(20),
    est_value_usd    BIGINT,
    status           VARCHAR(20) DEFAULT 'DRAFTED',  -- DRAFTED|SENT|RESPONDED|AWARDED|DECLINED
    sent_date        DATE,
    response_date    DATE,
    quoted_price     BIGINT,
    variance_pct     DECIMAL(6,2),
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_pipeline(status);

-- ═══════════════════════════════════════════
-- PROGRAM EVENTS LOG
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS program_events (
    id          SERIAL PRIMARY KEY,
    event_type  VARCHAR(40) NOT NULL,               -- RFQ_SENT | QUOTE_RECEIVED | PO_ISSUED | etc.
    category    VARCHAR(120),
    supplier    VARCHAR(120),
    value_usd   BIGINT,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- SEED DATA — BOP Pricing (19 categories)
-- ═══════════════════════════════════════════
INSERT INTO bop_pricing (category, category_code, spend_tier, bom_low, bom_mid, bom_high,
  rfq_quoted, rfq_variance_pct, confidence_label, confidence_score,
  preferred_supplier, avoid_supplier, scenario_optimistic, scenario_base, scenario_pessimistic)
VALUES
  ('Generator and Electrical Switchgear','GENERATOR','STRATEGIC',1781273,2093850,2408628,NULL,NULL,'COMPONENT_BUILDUPS',65,'GE Vernova','',1692209,2093850,2649491),
  ('Emissions Control (SCR / CO Catalyst)','EMISSIONS','STRATEGIC',757988,891750,1025513,NULL,NULL,'COMPONENT_BUILDUPS',65,'CECO Environmental','',720088,891750,1128064),
  ('Step-up Transformer (GSU)','TRANSFORMER','STRATEGIC',646000,760000,874000,NULL,NULL,'COMPONENT_BUILDUPS',65,'ABB Power Grids','',613700,760000,961400),
  ('Fuel Gas System','FUEL_GAS','STRATEGIC',595510,700600,805690,NULL,NULL,'COMPONENT_BUILDUPS',65,'Emerson','',565735,700600,886259),
  ('Electrical Distribution (Auxiliary)','ELEC_DIST','STRATEGIC',454793,535050,615308,NULL,NULL,'COMPONENT_BUILDUPS',65,'Eaton','',432053,535050,676839),
  ('Inlet Air Filtering System','INLET_AIR','STRATEGIC',446378,525150,603923,NULL,NULL,'COMPONENT_BUILDUPS',65,'Donaldson','',423959,525150,664315),
  ('Piping and Valves (BOP interconnect)','PIPING_VALVES','STRATEGIC',431460,507600,583740,NULL,NULL,'COMPONENT_BUILDUPS',65,'Flowserve','Trillium Flow Technologies',409887,507600,642114),
  ('Controls / DCS Integration','CONTROLS_DCS','STRATEGIC',428910,504600,580290,NULL,NULL,'COMPONENT_BUILDUPS',65,'Emerson','',407465,504600,638319),
  ('Exhaust System','EXHAUST','TARGETED',366053,430650,495248,NULL,NULL,'COMPONENT_BUILDUPS',65,'CECO','',347750,430650,544773),
  ('Civil and Structural Works','CIVIL_STRUCT','TARGETED',285813,336250,386688,NULL,NULL,'COMPONENT_BUILDUPS',65,'Local EPC','',271522,336250,425357),
  ('Acoustic Enclosure / Noise Control','ACOUSTIC','TARGETED',259335,305100,350865,NULL,NULL,'COMPONENT_BUILDUPS',65,'CECO','',246368,305100,385952),
  ('Lube Oil System','LUBE_OIL','TARGETED',245565,288900,332235,NULL,NULL,'COMPONENT_BUILDUPS',65,'Parker Hannifin','',233287,288900,365459),
  ('Vibration Monitoring System','VIB_MON','TARGETED',228013,268250,308488,340000,26.7,'RFQ_VERIFIED',100,'Baker Hughes','',216612,268250,339337),
  ('Starting System','STARTING','TARGETED',203108,238950,274793,NULL,NULL,'COMPONENT_BUILDUPS',65,'Koenig','',192953,238950,302272),
  ('Fire Fighting System','FIRE_FIGHT','TARGETED',194990,229400,263810,NULL,NULL,'COMPONENT_BUILDUPS',65,'Amerex','',185241,229400,290191),
  ('Cooling / Cooling Water System','COOLING','TARGETED',191633,225450,259268,NULL,NULL,'COMPONENT_BUILDUPS',65,'SPX Cooling','',182051,225450,285195),
  ('Fuel Oil / Backup Fuel System','FUEL_OIL','TARGETED',166388,195750,225113,NULL,NULL,'COMPONENT_BUILDUPS',65,'Parker','',158068,195750,247624),
  ('Compressor Washing System','WATER_WASH','STANDARD',112455,132300,152145,NULL,NULL,'COMPONENT_BUILDUPS',65,'Turbotect','',106832,132300,167360),
  ('Telecommunications / Plant Network','TELECOMS','STANDARD',88740,104400,120060,NULL,NULL,'COMPONENT_BUILDUPS',65,'Cisco','',84303,104400,132066)
ON CONFLICT (category_code) DO NOTHING;

-- ═══════════════════════════════════════════
-- SEED DATA — RFQ Pipeline
-- ═══════════════════════════════════════════
INSERT INTO rfq_pipeline (rfq_id, contact_name, company, category, category_code, est_value_usd, status, response_date, quoted_price, variance_pct)
VALUES
  ('RFQ-001','Lorenzo Simonelli','Baker Hughes','Vibration Monitoring System','VIB_MON',268250,'RESPONDED','2026-04-10',340000,26.7),
  ('RFQ-002','Bob Yeager','Emerson','Fuel Gas System','FUEL_GAS',700600,'DRAFTED',NULL,NULL,NULL),
  ('RFQ-003','Tod Carpenter','Donaldson Company','Inlet Air Filtering System','INLET_AIR',525150,'DRAFTED',NULL,NULL,NULL),
  ('RFQ-004','Michael Wynblatt','Donaldson Company','Controls / DCS Integration','CONTROLS_DCS',504600,'DRAFTED',NULL,NULL,NULL),
  ('RFQ-005','Rod Christie','Baker Hughes','Exhaust System','EXHAUST',430650,'DRAFTED',NULL,NULL,NULL),
  ('RFQ-006','Harrison K','Amerex Corporation','Fire Fighting System','FIRE_FIGHT',229400,'DRAFTED',NULL,NULL,NULL),
  ('RFQ-007','Neil Ashford','Turbotect Ltd.','Compressor Washing System','WATER_WASH',132300,'DRAFTED',NULL,NULL,NULL)
ON CONFLICT (rfq_id) DO NOTHING;

-- Verify
SELECT 'bop_pricing' as table_name, COUNT(*) as rows FROM bop_pricing
UNION ALL
SELECT 'rfq_pipeline', COUNT(*) FROM rfq_pipeline;
