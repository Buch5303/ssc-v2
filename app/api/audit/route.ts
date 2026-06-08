import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { auditLogs } from '@/db/schema/auditLog';

const AuditPayloadSchema = z.object({
  entity_type: z.string().min(1).max(64),
  entity_id: z.string().min(1).max(128),
  action: z.string().min(1).max(64),
  actor_id: z.string().min(1).max(128),
  payload: z.record(z.unknown()).optional()
});

export async function POST(request: Request) {
  let body;
  
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { 
        status: 400,
        headers: { 'Cache-Control': 'no-store' }
      }
    );
  }

  const result = AuditPayloadSchema.safeParse(body);
  
  if (!result.success) {
    return NextResponse.json(
      { 
        error: 'Validation failed', 
        details: result.error.flatten() 
      },
      { 
        status: 400,
        headers: { 'Cache-Control': 'no-store' }
      }
    );
  }

  try {
    const rows = await db
      .insert(auditLogs)
      .values({ ...result.data })
      .returning({ id: auditLogs.id });

    return NextResponse.json(
      { id: rows[0].id },
      { 
        status: 201,
        headers: { 'Cache-Control': 'no-store' }
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { 
        status: 500,
        headers: { 'Cache-Control': 'no-store' }
      }
    );
  }
}