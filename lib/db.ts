import { neon, neonConfig } from '@neondb/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { DatabaseError } from './db/errors';
import { connectionPool } from './db/connection-pool';

neonConfig.fetchConnectionCache = true;

if (!process.env.DATABASE_URL) {
  throw new DatabaseError('DATABASE_URL is required', 'MISSING_ENV');
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql);

// Health check function
export async function checkDatabaseHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency: number; timestamp: string }> {
  const start = Date.now();
  try {
    await sql`SELECT 1`;
    return {
      status: 'healthy',
      latency: Date.now() - start,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new DatabaseError(`Database health check failed: ${error}`, 'CONNECTION_FAILED');
  }
}

// Execute raw SQL with error handling
export async function executeQuery<T = any>(query: string, params: any[] = []): Promise<T[]> {
  try {
    const result = await sql(query, params);
    return result as T[];
  } catch (error) {
    throw new DatabaseError(`Query execution failed: ${error}`, 'QUERY_FAILED');
  }
}

// Transaction wrapper
export async function withTransaction<T>(callback: (tx: typeof sql) => Promise<T>): Promise<T> {
  try {
    return await sql.transaction(callback);
  } catch (error) {
    throw new DatabaseError(`Transaction failed: ${error}`, 'TRANSACTION_FAILED');
  }
}

export { sql };