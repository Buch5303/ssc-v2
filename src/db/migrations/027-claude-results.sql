-- ============================================================
-- Migration 027: Claude Intelligence Results Store
-- ============================================================

CREATE TABLE IF NOT EXISTS claude_results (
    id              SERIAL PRIMARY KEY,
    analysis_type   TEXT NOT NULL,  -- pricing_analysis | rfq_draft | supplier_comparison | cross_validation | procurement_summary | outreach_strategy
    subject_name    TEXT NOT NULL,
    content         TEXT NOT NULL,
    input_tokens    INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    model_cost_usd  NUMERIC(10,6) DEFAULT 0,
    model           TEXT DEFAULT 'claude-sonnet-4-6',
    triggered_by    TEXT DEFAULT 'api',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_results_type    ON claude_results(analysis_type);
CREATE INDEX IF NOT EXISTS idx_claude_results_created ON claude_results(created_at DESC);
