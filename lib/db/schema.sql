-- FlowSeer Database Schema
-- Production-grade schema with EQS v1.0 compliance
-- Financial precision: DECIMAL(15,4) for ±0.1% accuracy
-- Audit-ready design with immutable logs

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT valid_role CHECK (role IN ('admin', 'user', 'viewer'))
);

-- Financial accounts with audit trail
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) NOT NULL,
  balance DECIMAL(15,4) NOT NULL DEFAULT 0.0000,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  
  CONSTRAINT positive_balance CHECK (balance >= 0),
  CONSTRAINT valid_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT valid_account_type CHECK (account_type IN ('checking', 'savings', 'investment', 'credit'))
);

-- Financial transactions with precise decimal handling
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount DECIMAL(15,4) NOT NULL,
  transaction_type VARCHAR(20) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  transaction_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reference_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  
  CONSTRAINT non_zero_amount CHECK (amount != 0),
  CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('debit', 'credit', 'transfer'))
);

-- Immutable audit logs table - NO UPDATES OR DELETES ALLOWED
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  user_id UUID REFERENCES users(id),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  checksum VARCHAR(64) NOT NULL,
  
  CONSTRAINT valid_action CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  CONSTRAINT immutable_audit CHECK (false) -- Prevents direct modifications
);

-- Remove the constraint to allow inserts via triggers
ALTER TABLE audit_logs DROP CONSTRAINT immutable_audit;

-- Add constraint to prevent updates and deletes only
CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Dashboard metrics cache for sub-1.5s load times
CREATE TABLE dashboard_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  metric_value DECIMAL(15,4),
  metric_data JSONB DEFAULT '{}',
  period_start DATE,
  period_end DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT valid_period CHECK (period_end >= period_start OR (period_start IS NULL AND period_end IS NULL))
);

-- Performance indexes for dashboard queries
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active, created_at);

CREATE INDEX idx_accounts_user_created ON accounts(user_id, created_at DESC);
CREATE INDEX idx_accounts_type_balance ON accounts(account_type, balance DESC);

CREATE INDEX idx_transactions_account_date ON transactions(account_id, transaction_date DESC);
CREATE INDEX idx_transactions_date_type ON transactions(transaction_date DESC, transaction_type);
CREATE INDEX idx_transactions_category ON transactions(category, created_at DESC);

-- Audit log indexes for compliance queries
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp DESC);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Dashboard metrics indexes for fast retrieval
CREATE INDEX idx_dashboard_metrics_user_type ON dashboard_metrics(user_id, metric_type);
CREATE INDEX idx_dashboard_metrics_expires ON dashboard_metrics(expires_at);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, action, new_values, checksum)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), encode(digest(to_jsonb(NEW)::text, 'sha256'), 'hex'));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, checksum)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), encode(digest((to_jsonb(OLD)::text || to_jsonb(NEW)::text), 'sha256'), 'hex'));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_values, checksum)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), encode(digest(to_jsonb(OLD)::text, 'sha256'), 'hex'));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers for all auditable tables
CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_accounts AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Updated timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();