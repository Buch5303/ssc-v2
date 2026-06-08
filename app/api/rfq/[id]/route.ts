import { db } from '@/lib/db';
import { rfqs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const id = params?.id;
  
  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      { error: 'Invalid id format' },
      { status: 400 }
    );
  }

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { error: 'Invalid id format' },
      { status: 400 }
    );
  }

  const record = await db
    .select()
    .from(rfqs)
    .where(eq(rfqs.id, id))
    .limit(1);

  if (record.length === 0) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(record[0], {
    status: 200,
    headers: {
      'X-Data-Source': 'drizzle/rfq_requests',
      'Cache-Control': 'no-store'
    }
  });
}