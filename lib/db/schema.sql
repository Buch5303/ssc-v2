-- Initial schema for FlowSeer application with EQS compliance
-- Financial precision using DECIMAL(15,4) for ±0.1% accuracy
-- Audit trails on all tables with immutable records

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    industry VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Financial metrics table with DECIMAL precision
CREATE TABLE financial_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL,
    value DECIMAL(15,4) NOT NULL, -- EQS requirement: DECIMAL for financial precision
    currency VARCHAR(3) DEFAULT 'USD',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    fiscal_year INTEGER NOT NULL,
    fiscal_quarter INTEGER CHECK (fiscal_quarter BETWEEN 1 AND 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Cash flow data with DECIMAL precision
CREATE TABLE cash_flows (
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

-- Immutable audit log table (append-only)
CREATE TABLE audit_logs (
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

-- Make audit_logs truly immutable (no updates or deletes)
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Indexes for performance (< 100ms query requirement)
CREATE INDEX idx_companies_code ON companies(code);
CREATE INDEX idx_financial_metrics_company_id ON financial_metrics(company_id);
CREATE INDEX idx_financial_metrics_type_period ON financial_metrics(metric_type, period_start, period_end);
CREATE INDEX idx_cash_flows_company_id ON cash_flows(company_id);
CREATE INDEX idx_cash_flows_period ON cash_flows(period_start, period_end);
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to all tables
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_financial_metrics_updated_at BEFORE UPDATE ON financial_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_cash_flows_updated_at BEFORE UPDATE ON cash_flows
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
$$ language 'plpgsql';

-- Apply audit triggers to all tables
CREATE TRIGGER companies_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON companies
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    
CREATE TRIGGER financial_metrics_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON financial_metrics
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    
CREATE TRIGGER cash_flows_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON cash_flows
    FOR EACH ROW EXECUTE FUNCTION log_audit_changes();