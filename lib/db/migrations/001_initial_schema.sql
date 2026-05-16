-- Migration: Initial schema setup
-- Version: 001
-- Description: Create initial tables with audit logging and indexes
-- EQS Compliance: DECIMAL precision, audit trails, performance indexes

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    industry VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Financial metrics table with DECIMAL precision for EQS compliance
CREATE TABLE IF NOT EXISTS financial_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL,
    value DECIMAL(15,4) NOT NULL, -- EQS requirement: ±0.1% accuracy
    currency VARCHAR(3) DEFAULT 'USD',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    fiscal_year INTEGER NOT NULL,
    fiscal_quarter INTEGER CHECK (fiscal_quarter BETWEEN 1 AND 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Cash flow data with computed free cash flow
CREATE TABLE IF NOT EXISTS cash_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    operating_cash_flow DECIMAL(15,4) NOT NULL,
    investing_cash_flow DECIMAL(15,4) NOT NULL,
    financing_cash_flow DECIMAL(15,4) NOT NULL,
    free_cash_flow DECIMAL(15,4) GENERATED ALWAYS AS (operating_cash_flow + investing_cash_flow) STORED,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    fiscal_year INTEGER NOT NULL,
    fiscal_quarter INTEGER CHECK (fiscal_quarter BETWEEN 1 AND 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Immutable audit log table (EQS compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(64) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    user_id UUID,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Make audit_logs immutable (no updates or deletes allowed)
DROP RULE IF EXISTS audit_logs_no_update ON audit_logs;
DROP RULE IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Performance indexes (EQS requirement: < 100ms queries)
CREATE INDEX IF NOT EXISTS idx_companies_code ON companies(code);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

CREATE INDEX IF NOT EXISTS idx_financial_metrics_company_id ON financial_metrics(company_id);
CREATE INDEX IF NOT EXISTS idx_financial_metrics_type ON financial_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_financial_metrics_type_period ON financial_metrics(metric_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_financial_metrics_fiscal ON financial_metrics(fiscal_year, fiscal_quarter);

CREATE INDEX IF NOT EXISTS idx_cash_flows_company_id ON cash_flows(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_flows_period ON cash_flows(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_cash_flows_fiscal ON cash_flows(fiscal_year, fiscal_quarter);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_action ON audit_logs(table_name, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id) WHERE user_id IS NOT NULL;

-- Trigger function for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
DROP TRIGGER IF EXISTS update_financial_metrics_updated_at ON financial_metrics;
DROP TRIGGER IF EXISTS update_cash_flows_updated_at ON cash_flows;

CREATE TRIGGER update_companies_updated_at 
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_financial_metrics_updated_at 
    BEFORE UPDATE ON financial_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_cash_flows_updated_at 
    BEFORE UPDATE ON cash_flows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit logging trigger function
CREATE OR REPLACE FUNCTION log_audit_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- For INSERT operations
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_values)
        VALUES (TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(NEW));
        RETURN NEW;
    END IF;
    
    -- For UPDATE operations  
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_fields)
        VALUES (
            TG_TABLE_NAME, 
            NEW.id, 
            TG_OP, 
            to_jsonb(OLD), 
            to_jsonb(NEW),
            ARRAY(
                SELECT key 
                FROM jsonb_each(to_jsonb(OLD)) old_val
                JOIN jsonb_each(to_jsonb(NEW)) new_val ON old_val.key = new_val.key
                WHERE old_val.value != new_val.value
            )
        );
        RETURN NEW;
    END IF;
    
    -- For DELETE operations
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values)
        VALUES (TG_TABLE_NAME, OLD.id, TG_OP, to_jsonb(OLD));
        RETURN OLD;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply audit logging triggers
DROP TRIGGER IF EXISTS companies_audit_trigger ON companies;
DROP TRIGGER IF EXISTS financial_metrics_audit_trigger ON financial_metrics;
DROP TRIGGER IF EXISTS cash_flows_audit_trigger ON cash_flows;

CREATE TRIGGER companies_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON companies
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    
CREATE TRIGGER financial_metrics_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON financial_metrics
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    
CREATE TRIGGER cash_flows_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON cash_flows
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Insert migration record
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(20) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING;