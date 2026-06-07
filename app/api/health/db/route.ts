import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

// Live DB connectivity check — must run per request, never at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const start = performance.now();
    
    // Simple connectivity check
    await db.execute(sql`SELECT 1`);
    
    const latency_ms = Math.round(performance.now() - start);
    
    // Log successful health check for monitoring
    logger.info({
      directive: 'AUTO-026',
      endpoint: '/api/health/db',
      latency_ms,
      status: 'connected',
      timestamp: new Date().toISOString()
    });
    
    return NextResponse.json({
      connected: true,
      latency_ms
    }, { status: 200 });
    
  } catch (err) {
    const error = err as Error;
    
    logger.error({
      directive: 'AUTO-026',
      endpoint: '/api/health/db',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return NextResponse.json({
      connected: false,
      latency_ms: null,
      error: 'DB_UNREACHABLE'
    }, { status: 503 });
  }
}