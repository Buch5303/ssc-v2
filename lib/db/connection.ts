import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create connection pool with optimized settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Timeout connection attempts after 2s
  statement_timeout: 5000, // Statement timeout 5s
  query_timeout: 5000, // Query timeout 5s
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Pool error handling
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  pool.end(() => {
    console.log('PostgreSQL pool has ended');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('PostgreSQL pool has ended');
    process.exit(0);
  });
});

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

// Initialize database tables if they don't exist
export async function initializeTables(): Promise<void> {
  const client = await pool.connect();
  
  try {
    // Create audit_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        operation VARCHAR(10) NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
        before_snapshot JSONB,
        after_snapshot JSONB NOT NULL,
        changed_fields JSONB NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_ip INET NOT NULL,
        user_agent TEXT,
        audit_trail_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_table_record 
      ON audit_log(table_name, record_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp 
      ON audit_log(timestamp)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_audit_trail_id 
      ON audit_log(audit_trail_id)
    `);
    
    // Create pricing table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL CHECK (price > 0),
        currency CHAR(3) NOT NULL,
        effective_date TIMESTAMPTZ NOT NULL,
        tier VARCHAR(20),
        region VARCHAR(100) NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        company VARCHAR(100) NOT NULL,
        position VARCHAR(100),
        country CHAR(2) NOT NULL,
        industry VARCHAR(50),
        lead_source VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create rfq table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rfq (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rfq_number VARCHAR(50) NOT NULL UNIQUE,
        customer_id VARCHAR(100) NOT NULL,
        product_specs JSONB NOT NULL,
        delivery_date TIMESTAMPTZ NOT NULL,
        delivery_location VARCHAR(200) NOT NULL,
        budget_range JSONB,
        priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        contact_person VARCHAR(100) NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Initialize on import
initializeTables().catch(console.error);

export default pool;