import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Create connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV !== 'development' ? { rejectUnauthorized: false } : false
});

// Create singleton db instance
export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

// Graceful shutdown helper
export async function closePool() {
  await pool.end();
}
