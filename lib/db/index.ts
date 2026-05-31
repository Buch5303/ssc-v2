import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import type { DrizzleDatabase } from 'drizzle-orm/pg-core';

type DrizzlePostgresDatabase = DrizzleDatabase<typeof schema>;

// Create connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV !== 'development' ? { rejectUnauthorized: false } : false
});

// Create singleton db instance
export const db: DrizzlePostgresDatabase = drizzle(pool, { schema });

// Graceful shutdown helper
export async function closePool() {
  await pool.end();
}