-- Migration: 001_initial_tables
-- Created: 2024-12-28
-- Description: Initial database tables with EQS v1.0 compliance

-- Start transaction
BEGIN;

-- Check if migration already applied
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Exit if already applied
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1) THEN
    RAISE NOTICE 'Migration 001 already applied, skipping...';
    ROLLBACK;
    RETURN;
  END IF;
END $$;

-- Apply schema from schema.sql
\i lib/db/schema.sql

-- Insert sample data for testing (only in development)
DO $$
BEGIN
  IF current_setting('server_version_num')::integer >= 120000 AND 
     current_setting('log_statement', true) != 'none' THEN
    
    -- Insert test user
    INSERT INTO users (id, email, name, role) VALUES 
    ('550e8400-e29b-41d4-a716-446655440000', 'admin@flowseer.com', 'FlowSeer Admin', 'admin'),
    ('550e8400-e29b-41d4-a716-446655440001', 'user@example.com', 'Test User', 'user');
    
    -- Insert test accounts
    INSERT INTO accounts (id, user_id, name, account_type, balance, currency) VALUES 
    ('660e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001', 'Main Checking', 'checking', 15000.2500, 'USD'),
    ('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'Savings Account', 'savings', 45000.7500, 'USD');
    
    -- Insert test transactions
    INSERT INTO transactions (account_id, amount, transaction_type, description, category, transaction_date) VALUES 
    ('660e8400-e29b-41d4-a716-446655440000', -850.2500, 'debit', 'Grocery Store Purchase', 'groceries', CURRENT_DATE - INTERVAL '5 days'),
    ('660e8400-e29b-41d4-a716-446655440000', 3200.0000, 'credit', 'Salary Deposit', 'income', CURRENT_DATE - INTERVAL '3 days'),
    ('660e8400-e29b-41d4-a716-446655440001', 1000.0000, 'credit', 'Transfer from Checking', 'transfer', CURRENT_DATE - INTERVAL '1 day');
    
    RAISE NOTICE 'Sample data inserted for development environment';
  END IF;
END $$;

-- Create initial dashboard metrics cache
INSERT INTO dashboard_metrics (user_id, metric_type, metric_value, period_start, period_end, expires_at)
SELECT 
  u.id,
  'total_balance',
  COALESCE(SUM(a.balance), 0.0000),
  CURRENT_DATE - INTERVAL '30 days',
  CURRENT_DATE,
  NOW() + INTERVAL '1 hour'
FROM users u
LEFT JOIN accounts a ON u.id = a.user_id
WHERE u.is_active = true
GROUP BY u.id;

-- Verify data integrity
DO $$
DECLARE
  user_count INTEGER;
  account_count INTEGER;
  transaction_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM users;
  SELECT COUNT(*) INTO account_count FROM accounts;
  SELECT COUNT(*) INTO transaction_count FROM transactions;
  
  RAISE NOTICE 'Migration completed successfully:';
  RAISE NOTICE '  Users: %', user_count;
  RAISE NOTICE '  Accounts: %', account_count;
  RAISE NOTICE '  Transactions: %', transaction_count;
  
  -- Verify financial precision
  IF EXISTS (SELECT 1 FROM accounts WHERE balance::text !~ '^\d+\.\d{4}$') THEN
    RAISE EXCEPTION 'Financial precision validation failed - balance columns do not meet DECIMAL(15,4) requirement';
  END IF;
  
  RAISE NOTICE '  Financial precision validated: ✓';
END $$;

-- Record migration
INSERT INTO schema_migrations (version) VALUES (1);

-- Commit transaction
COMMIT;

RAISE NOTICE 'Migration 001_initial_tables completed successfully';