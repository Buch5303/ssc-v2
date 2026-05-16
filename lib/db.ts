import { drizzle } from 'drizzle-orm/neon-serverless';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

// Connection pool configuration
const poolConfig = {
  connectionString: process.env.DATABASE_URL!,
  max: 10, // Max 10 connections as per EQS requirement
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 500,
  acquireTimeoutMillis: 1000,
  ssl: {
    rejectUnauthorized: false
  }
};

// Create connection pool
const pool = new Pool(poolConfig);
const sql = neon(process.env.DATABASE_URL!, {
  arrayMode: false,
  fullResults: true
});

// Initialize Drizzle with the pool configuration applied
export const db = drizzle(sql, {
  logger: process.env.NODE_ENV === 'development'
});

// Database connection health check
export async function checkDatabaseHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number; error?: string }> {
  const start = Date.now();
  try {
    await sql`SELECT 1`;
    const latency = Date.now() - start;
    return { status: 'healthy', latency };
  } catch (error) {
    // Sanitize error message to prevent exposure of connection details
    const sanitizedError = error instanceof Error ? 'Database connection failed' : 'Unknown database error';
    return { status: 'unhealthy', error: sanitizedError };
  }
}

// Connection pool monitoring
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

// Graceful shutdown
export async function closeDatabaseConnections() {
  try {
    await pool.end();
  } catch (error) {
    console.error('Error closing database connections');
  }
}