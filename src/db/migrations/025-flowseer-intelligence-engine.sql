-- ============================================================
-- Migration 025: FlowSeer Continuous Intelligence Engine
-- Supplier discovery, market pricing, tier classification
-- ============================================================

-- -------------------------------------------------------
-- 1. SUPPLIER TIERS — classify all suppliers T1–T4
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_tiers (
    id                  SERIAL PRIMARY KEY,
    supplier_name       TEXT NOT NULL,
    domain              TEXT,
    apollo_org_id       TEXT,
    tier                INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
    tier_rationale      TEXT,
    bop_category        TEXT,           -- which BOP system they serve
    sub_category        TEXT,           -- specific part/system within category
    revenue_usd         BIGINT,
    employee_count      INTEGER,
    hq_country          TEXT,
    hq_city             TEXT,
    phone               TEXT,
    linkedin_url        TEXT,
    website             TEXT,
    certifications      TEXT[],         -- ISO9001, AS9100, ASME, API614, etc.
    capabilities        TEXT[],         -- what they make/do
    active              BOOLEAN DEFAULT true,
    source              TEXT DEFAULT 'manual', -- manual | web_search | apollo | auto_discovery
    last_enriched_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_tiers_category ON supplier_tiers(bop_category);
CREATE INDEX IF NOT EXISTS idx_supplier_tiers_tier ON supplier_tiers(tier);
CREATE INDEX IF NOT EXISTS idx_supplier_tiers_domain ON supplier_tiers(domain);

-- -------------------------------------------------------
-- 2. MARKET PRICING — indicative pricing by part category
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing (
    id                  SERIAL PRIMARY KEY,
    bop_category        TEXT NOT NULL,  -- e.g. "Reduction_Gearbox"
    sub_category        TEXT,           -- e.g. "Turbo Parallel Shaft Gearbox 50MW"
    part_description    TEXT NOT NULL,
    part_number         TEXT,
    unit_of_measure     TEXT DEFAULT 'each',
    quantity_basis      INTEGER DEFAULT 1,
    price_low_usd       NUMERIC(18,2),
    price_mid_usd       NUMERIC(18,2),
    price_high_usd      NUMERIC(18,2),
    currency            TEXT DEFAULT 'USD',
    price_basis         TEXT,           -- e.g. "CIF, 50MW class, new manufacture"
    lead_time_weeks_low INTEGER,
    lead_time_weeks_high INTEGER,
    source_supplier     TEXT,
    source_type         TEXT DEFAULT 'web_research', -- web_research | rfq | published | estimated
    source_url          TEXT,
    confidence          TEXT DEFAULT 'indicative' CHECK (confidence IN ('indicative','quoted','contracted','published')),
    valid_from          DATE,
    valid_to            DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_pricing_category ON market_pricing(bop_category);
CREATE INDEX IF NOT EXISTS idx_market_pricing_sub ON market_pricing(sub_category);

-- -------------------------------------------------------
-- 3. PRICING HISTORY — track changes over time
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_history (
    id                  SERIAL PRIMARY KEY,
    pricing_id          INTEGER REFERENCES market_pricing(id) ON DELETE CASCADE,
    bop_category        TEXT NOT NULL,
    part_description    TEXT NOT NULL,
    price_mid_usd       NUMERIC(18,2),
    price_low_usd       NUMERIC(18,2),
    price_high_usd      NUMERIC(18,2),
    change_pct          NUMERIC(8,2),   -- % change from previous
    source_type         TEXT,
    recorded_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_history_pricing_id ON pricing_history(pricing_id);
CREATE INDEX IF NOT EXISTS idx_pricing_history_recorded ON pricing_history(recorded_at DESC);

-- -------------------------------------------------------
-- 4. DISCOVERY JOBS — log of all automated discovery runs
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_jobs (
    id                  SERIAL PRIMARY KEY,
    job_type            TEXT NOT NULL,  -- supplier_search | price_research | apollo_enrich | full_sweep
    bop_category        TEXT,           -- NULL = all categories
    search_query        TEXT,
    status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed')),
    suppliers_found     INTEGER DEFAULT 0,
    suppliers_new       INTEGER DEFAULT 0,
    prices_updated      INTEGER DEFAULT 0,
    run_duration_ms     INTEGER,
    error_message       TEXT,
    triggered_by        TEXT DEFAULT 'cron', -- cron | manual | api
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status ON discovery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_created ON discovery_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_category ON discovery_jobs(bop_category);

-- -------------------------------------------------------
-- 5. DISCOVERY RESULTS — what each job found
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_results (
    id                  SERIAL PRIMARY KEY,
    job_id              INTEGER REFERENCES discovery_jobs(id) ON DELETE CASCADE,
    result_type         TEXT NOT NULL,  -- supplier | pricing | contact
    supplier_name       TEXT,
    domain              TEXT,
    bop_category        TEXT,
    tier                INTEGER,
    revenue_usd         BIGINT,
    phone               TEXT,
    price_low_usd       NUMERIC(18,2),
    price_mid_usd       NUMERIC(18,2),
    price_high_usd      NUMERIC(18,2),
    part_description    TEXT,
    source_url          TEXT,
    raw_data            JSONB,
    is_new              BOOLEAN DEFAULT true,  -- was this supplier/price new?
    promoted_to_db      BOOLEAN DEFAULT false, -- moved to supplier_tiers / market_pricing?
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_results_job ON discovery_results(job_id);
CREATE INDEX IF NOT EXISTS idx_discovery_results_category ON discovery_results(bop_category);

-- -------------------------------------------------------
-- 6. BOP CATEGORY REGISTRY — master list of categories to monitor
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bop_categories (
    id                  SERIAL PRIMARY KEY,
    category_key        TEXT UNIQUE NOT NULL,   -- "Reduction_Gearbox"
    category_name       TEXT NOT NULL,          -- "Reduction Gearbox"
    category_group      TEXT,                   -- "Mechanical" | "Electrical" | "Fuel" | "Utility"
    discovery_keywords  TEXT[],                 -- keywords for web search
    discovery_enabled   BOOLEAN DEFAULT true,
    pricing_enabled     BOOLEAN DEFAULT true,
    last_discovery_run  TIMESTAMPTZ,
    last_pricing_run    TIMESTAMPTZ,
    supplier_count      INTEGER DEFAULT 0,
    pricing_record_count INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- 7. Seed BOP Category Registry
-- -------------------------------------------------------
INSERT INTO bop_categories (category_key, category_name, category_group, discovery_keywords) VALUES
('Reduction_Gearbox',       'Reduction Gearbox',                'Mechanical',   ARRAY['gas turbine reduction gearbox manufacturer','turbo gearbox power generation','API 613 gearbox supplier']),
('Starting_Package',        'Starting Package / Torque Converter','Mechanical',  ARRAY['gas turbine torque converter manufacturer','GT starting system diesel','turbine starting package supplier']),
('Coupling_Joints',         'Coupling Joints',                  'Mechanical',   ARRAY['gas turbine coupling flexible disc manufacturer','GT drive coupling supplier','ARPEX coupling']),
('Bleed_Air_System',        'Bleed Air System',                 'Mechanical',   ARRAY['gas turbine bleed air system manufacturer','compressor bleed valve supplier','GT auxiliary air']),
('Atomizing_Air_System',    'Atomizing & Instrument Air System','Mechanical',   ARRAY['gas turbine atomizing air compressor','instrument air package power generation']),
('Cooling_Air_System',      'Cooling Air System',               'Mechanical',   ARRAY['gas turbine cooling air system','turbine cooling air fan manufacturer']),
('Lube_Oil_System',         'Lube Oil System',                  'Mechanical',   ARRAY['gas turbine lube oil console skid','API 614 lube oil system manufacturer','turbine lube oil pump skid']),
('Fuel_Gas_System',         'Fuel Gas System',                  'Fuel',         ARRAY['fuel gas conditioning skid manufacturer','gas turbine fuel gas system','GT fuel gas pressure regulation']),
('DLN_Fuel_Gas_System',     'DLN Fuel Gas System',              'Fuel',         ARRAY['DLN dry low nox fuel gas system','gas turbine DLN fuel skid']),
('Fuel_Oil_System',         'Fuel Oil System',                  'Fuel',         ARRAY['gas turbine fuel oil system','GT fuel oil pump skid manufacturer']),
('Fuel_Oil_Drain_System',   'Fuel Oil Drain System',            'Fuel',         ARRAY['gas turbine fuel oil drain system manufacturer']),
('DLN_Fuel_Oil_System',     'DLN Fuel Oil System',              'Fuel',         ARRAY['DLN fuel oil system manufacturer','gas turbine dual fuel DLN']),
('Control_Oil_System',      'Control Oil System',               'Mechanical',   ARRAY['gas turbine control oil system hydraulic','GT hydraulic control oil skid']),
('Water_Injection_System',  'Water Injection System',           'Utility',      ARRAY['gas turbine water injection system DLN','turbine water injection skid manufacturer']),
('Machinery_Cooling_Water', 'Machinery Cooling Water',          'Utility',      ARRAY['gas turbine cooling water system','machinery cooling water heat exchanger skid']),
('Compressor_Washing',      'Compressor Online Washing System', 'Mechanical',   ARRAY['gas turbine compressor washing system','online compressor wash manufacturer','Turbotect compressor cleaning']),
('HFO_System',              'HFO Fuel System',                  'Fuel',         ARRAY['heavy fuel oil HFO gas turbine system','HFO treatment skid manufacturer']),
('Additivation_System',     'Additivation System',              'Fuel',         ARRAY['fuel additive dosing skid gas turbine','vanadium inhibitor additive system']),
('Turbine_Washing_System',  'Turbine Washing System',           'Mechanical',   ARRAY['gas turbine offline wash system','turbine washing skid manufacturer']),
('Electrical_Heating',      'Electrical Heating System',        'Electrical',   ARRAY['gas turbine fuel oil electrical heater','heat tracing system power generation']),
('Steam_Heating_HFO',       'Steam Heating HFO System',         'Utility',      ARRAY['gas turbine HFO steam heating system']),
('Inlet_Air_Filtering',     'Inlet Air Filtering System',       'Mechanical',   ARRAY['gas turbine inlet air filter manufacturer','GT air intake filtration system','turbine inlet filter house']),
('Inlet_Air_Duct',          'Inlet Air Duct',                   'Mechanical',   ARRAY['gas turbine inlet air duct manufacturer','GT intake duct fabricator']),
('Exhaust_System',          'Exhaust System',                   'Mechanical',   ARRAY['gas turbine exhaust system manufacturer','GT expansion joint supplier','turbine exhaust duct silencer']),
('Fire_Fighting',           'Fire Fighting System',             'Safety',       ARRAY['gas turbine fire suppression system','GT enclosure fire fighting manufacturer']),
('Enclosures',              'Enclosures',                       'Mechanical',   ARRAY['gas turbine acoustic enclosure manufacturer','GT weatherproof enclosure supplier']),
('MV_System',               'MV Electrical System',             'Electrical',   ARRAY['gas turbine MV transformer switchgear manufacturer','medium voltage power generation package']),
('LV_MCC_System',           'LV/MCC Panels 380V',              'Electrical',   ARRAY['motor control center MCC gas turbine','380V power distribution board manufacturer']),
('DC_Battery_System',       '110V DC Battery System',           'Electrical',   ARRAY['110V DC battery system power plant','industrial VRLA battery UPS 110V']),
('Vibration_Monitoring',    'Vibration Monitoring System',      'Instrumentation',ARRAY['gas turbine vibration monitoring Bently Nevada','turbine vibration protection system manufacturer']),
('Gas_Detection',           'Gas Detection System',             'Safety',       ARRAY['gas turbine gas detection system manufacturer','GT enclosure gas detector supplier']),
('Lighting_System',         'Lighting & Sockets',               'Electrical',   ARRAY['industrial power plant lighting manufacturer','ATEX zone 2 lighting gas turbine']),
('Black_Start_Equipment',   'Black Start Equipment',            'Electrical',   ARRAY['black start diesel generator gas turbine','GT black start package manufacturer']),
('Piperack_Platforms',      'Internal Piperack & Platforms',    'Civil',        ARRAY['gas turbine piperack fabricator','power plant pipe rack steel structure']),
('Painting_Insulation',     'Painting Insulation Accessories',  'Civil',        ARRAY['gas turbine insulation cladding manufacturer','power plant insulation contractor']),
('Gas_Treatment_Station',   'Gas Treatment Station',            'Fuel',         ARRAY['gas treatment station manufacturer','natural gas metering pressure regulation station'])
ON CONFLICT (category_key) DO NOTHING;

-- -------------------------------------------------------
-- 8. Updated_at triggers
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS supplier_tiers_updated_at ON supplier_tiers;
CREATE TRIGGER supplier_tiers_updated_at BEFORE UPDATE ON supplier_tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS market_pricing_updated_at ON market_pricing;
CREATE TRIGGER market_pricing_updated_at BEFORE UPDATE ON market_pricing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
