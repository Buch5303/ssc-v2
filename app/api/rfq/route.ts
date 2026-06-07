import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rfqs } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

// Reads request.url and queries the DB on each call — never prerender.
export const dynamic = 'force-dynamic';

type RFQRecord = typeof rfqs.$inferSelect;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse and validate pagination parameters
    let page = parseInt(searchParams.get('page') || '1', 10);
    let limit = parseInt(searchParams.get('limit') || '20', 10);
    
    // Clamp values to valid ranges
    const originalPage = page;
    const originalLimit = limit;
    
    if (isNaN(page) || page < 1) {
      page = 1;
    }
    
    if (isNaN(limit) || limit < 1) {
      limit = 20;
    } else if (limit > 100) {
      limit = 100;
    }
    
    // Log if clamping occurred
    if (originalPage !== page || originalLimit !== limit) {
      logger.warn({
        directive: 'AUTO-026',
        endpoint: '/api/rfq',
        message: 'Parameter clamping applied',
        original: { page: originalPage, limit: originalLimit },
        clamped: { page, limit },
        timestamp: new Date().toISOString()
      });
    }
    
    const offset = (page - 1) * limit;
    
    // Execute queries in parallel for better performance
    const [data, totalResult] = await Promise.all([
      db.select().from(rfqs).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(rfqs)
    ]);
    
    const total = Number(totalResult[0].count);
    
    // Log successful query for audit trail
    logger.info({
      directive: 'AUTO-026',
      endpoint: '/api/rfq',
      query_params: { page, limit, offset },
      result_count: data.length,
      total_records: total,
      timestamp: new Date().toISOString()
    });
    
    return NextResponse.json({
      data: data as RFQRecord[],
      total,
      page
    }, { status: 200 });
    
  } catch (err) {
    const error = err as Error;
    
    logger.error({
      directive: 'AUTO-026',
      endpoint: '/api/rfq',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return NextResponse.json({
      error: 'Internal server error',
      code: 'RFQ_FETCH_FAILED'
    }, { status: 500 });
  }
}