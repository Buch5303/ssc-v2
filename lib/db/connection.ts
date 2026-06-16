import { Pool } from 'pg';

// 2026-06-16: Made pool lazy. Previously this module (a) threw at import scope
// if DATABASE_URL was unset and (b) ran initializeTables() as an import side
// effect — so `next build` page-data collection crashed/connected during build.
// That latent break surfaced the moment a real (non docs-only) commit forced a
// production build. The pool is now created on first use via a Proxy, so
// importing this module neither throws nor opens a connection at build time.
let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    query_timeout: 5000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  _pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
  });
  return _pool;
}

// Lazy proxy preserves the existing `import pool from '@/lib/db/connection'`
// interface (pool.query(...), pool.connect(...)) while deferring creation.
const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = (p as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(p) : value;
  },
});

// Graceful shutdown — only act if a pool was actually created.
process.on('SIGINT', () => {
  if (_pool) { _pool.end(() => process.exit(0)); } else { process.exit(0); }
});
process.on('SIGTERM', () => {
  if (_pool) { _pool.end(() => process.exit(0)); } else { process.exit(0); }
});

// Health check function
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

// Initialize database tables if they don't exist. Call explicitly — no longer
// run as an import side effect (that opened a DB connection during build).
export async function initializeTables(): Promise<void> {
  const client = await getPool().connect();
  try {
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

export default pool;
