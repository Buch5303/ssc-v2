-- ============================================================
-- Migration 026: Perplexity Integrity Check Layer
-- Stores all AI-powered validation results for suppliers,
-- pricing records, and market intelligence.
-- ============================================================

-- -------------------------------------------------------
-- 1. INTEGRITY CHECKS — log of all Perplexity validations
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrity_checks (
    id                  SERIAL PRIMARY KEY,
    check_type          TEXT NOT NULL,      -- supplier | pricing | contact | market_briefing | supplier_discovery
    subject_id          INTEGER,            -- FK to supplier_tiers.id or market_pricing.id
    subject_name        TEXT NOT NULL,      -- human-readable name of what was checked
    bop_category        TEXT,
    perplexity_model    TEXT DEFAULT 'sonar',
    prompt_summary      TEXT,               -- short description of what was asked
    response_content    TEXT,               -- full Perplexity response
    citations           JSONB DEFAULT '[]', -- array of citation URLs
    integrity_score     TEXT,               -- HIGH | MEDIUM | LOW | VALIDATED | REASONABLE | QUESTIONABLE | ACTIVE | UNKNOWN
    flags               TEXT[],             -- e.g. ['ownership_changed', 'financial_distress', 'pricing_high']
    tokens_used         INTEGER,
    model_cost_usd      NUMERIC(10,6),
    triggered_by        TEXT DEFAULT 'manual', -- manual | cron | api
    status              TEXT DEFAULT 'complete' CHECK (status IN ('pending','running','complete','failed')),
    error_message       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_checks_type     ON integrity_checks(check_type);
CREATE INDEX IF NOT EXISTS idx_integrity_checks_score    ON integrity_checks(integrity_score);
CREATE INDEX IF NOT EXISTS idx_integrity_checks_category ON integrity_checks(bop_category);
CREATE INDEX IF NOT EXISTS idx_integrity_checks_created  ON integrity_checks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integrity_checks_subject  ON integrity_checks(subject_id, check_type);

-- -------------------------------------------------------
-- 2. INTEGRITY SUMMARY — per-supplier/pricing score rollup
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrity_summary (
    id                  SERIAL PRIMARY KEY,
    entity_type         TEXT NOT NULL,      -- supplier | pricing
    entity_id           INTEGER,
    entity_name         TEXT NOT NULL,
    bop_category        TEXT,
    overall_score       TEXT,               -- HIGH | MEDIUM | LOW
    score_numeric       INTEGER,            -- 0-100 for sorting
    last_checked_at     TIMESTAMPTZ,
    check_count         INTEGER DEFAULT 0,
    flags               TEXT[],
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_summary_type    ON integrity_summary(entity_type);
CREATE INDEX IF NOT EXISTS idx_integrity_summary_score   ON integrity_summary(score_numeric DESC);
CREATE INDEX IF NOT EXISTS idx_integrity_summary_entity  ON integrity_summary(entity_id, entity_type);

-- -------------------------------------------------------
-- 3. MARKET BRIEFINGS — Perplexity market intel cache
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_briefings (
    id                  SERIAL PRIMARY KEY,
    bop_category        TEXT NOT NULL,
    category_name       TEXT,
    briefing_content    TEXT NOT NULL,
    citations           JSONB DEFAULT '[]',
    perplexity_model    TEXT DEFAULT 'sonar-pro',
    tokens_used         INTEGER,
    valid_until         TIMESTAMPTZ,        -- briefings expire after 7 days
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_briefings_category ON market_briefings(bop_category);
CREATE INDEX IF NOT EXISTS idx_market_briefings_created  ON market_briefings(created_at DESC);

-- -------------------------------------------------------
-- 4. PERPLEXITY DISCOVERIES — net-new suppliers found
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS perplexity_discoveries (
    id                  SERIAL PRIMARY KEY,
    bop_category        TEXT NOT NULL,
    discovery_content   TEXT NOT NULL,      -- full Perplexity response
    citations           JSONB DEFAULT '[]',
    suppliers_extracted JSONB DEFAULT '[]', -- parsed supplier list
    promoted_count      INTEGER DEFAULT 0,  -- how many moved to supplier_tiers
    perplexity_model    TEXT DEFAULT 'sonar-pro',
    tokens_used         INTEGER,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perplexity_discoveries_category ON perplexity_discoveries(bop_category);
