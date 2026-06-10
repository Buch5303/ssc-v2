import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { markStart, markEnd } from '@/lib/perf';

const sql = neon(process.env.DATABASE_URL!);

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