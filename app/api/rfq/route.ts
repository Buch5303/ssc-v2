import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rfqs } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { markStart, markEnd } from '@/lib/perf';

// 2026-06-16: switched from @neondatabase/serverless neon() (HTTP driver) to the
// shared Drizzle pg-Pool client used by every sibling route (/api/rfq/[id], the
// RFQ pages, /api/health/db). The neon() HTTP driver 500'd against this
// DATABASE_URL (a standard pg TCP connection) — "Failed to fetch RFQs" on every
// GET/POST — while the TCP-based Drizzle client connects fine (health/db = 200).
// This route is now consistent with the rest of the app.
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    markStart('db');
    const result = await db
      .select({ id: rfqs.id, status: rfqs.status, updated_at: rfqs.updated_at })
      .from(rfqs)
      .orderBy(desc(rfqs.updated_at));
    const dbDur = markEnd('db');

    const response = NextResponse.json({ data: result, count: result.length });
    response.headers.set('Server-Timing', `db;dur=${dbDur}`);
    return response;
  } catch (error) {
    console.error('[API] RFQ fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch RFQs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body ?? {};

    if (!id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, status' },
        { status: 400 }
      );
    }

    markStart('db');
    const inserted = await db
      .insert(rfqs)
      .values({ id, status })
      .returning({ id: rfqs.id, status: rfqs.status, updated_at: rfqs.updated_at });
    const dbDur = markEnd('db');

    const response = NextResponse.json({
      data: inserted[0],
      message: 'RFQ created successfully',
    });
    response.headers.set('Server-Timing', `db;dur=${dbDur}`);
    return response;
  } catch (error) {
    console.error('[API] RFQ creation error:', error);
    return NextResponse.json({ error: 'Failed to create RFQ' }, { status: 500 });
  }
}
