import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { markStart, markEnd } from '@/lib/perf';

// 2026-06-16: lazy neon client. A module-scope `neon(process.env.DATABASE_URL!)`
// throws during `next build` page-data collection when DATABASE_URL isn't in the
// build env, failing the whole production build (this was the second route to
// crash the first real build after the auto-build loop was halted). Deferring
// client creation to first query keeps the build env-free.
let _sql: ReturnType<typeof makeSql> | null = null;
function makeSql() {
  return neon<false, false>(process.env.DATABASE_URL!);
}
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    _sql = makeSql();
  }
  return _sql(strings, ...values);
}

export async function GET(request: NextRequest) {
  try {
    // Start timing the database query
    markStart('db');
    
    const result = await sql`
      SELECT id, status, updated_at 
      FROM rfqs 
      ORDER BY updated_at DESC
    `;
    
    // End timing and capture duration
    const dbDur = markEnd('db');
    
    const response = NextResponse.json({
      data: result,
      count: result.length
    });
    
    // Add Server-Timing header for performance observability
    response.headers.set('Server-Timing', `db;dur=${dbDur}`);
    
    return response;
  } catch (error) {
    console.error('[API] RFQ fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch RFQs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body;
    
    if (!id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, status' },
        { status: 400 }
      );
    }
    
    markStart('db');
    
    const result = await sql`
      INSERT INTO rfqs (id, status, updated_at)
      VALUES (${id}, ${status}, NOW())
      RETURNING id, status, updated_at
    `;
    
    const dbDur = markEnd('db');
    
    const response = NextResponse.json({
      data: result[0],
      message: 'RFQ created successfully'
    });
    
    response.headers.set('Server-Timing', `db;dur=${dbDur}`);
    
    return response;
  } catch (error) {
    console.error('[API] RFQ creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create RFQ' },
      { status: 500 }
    );
  }
}