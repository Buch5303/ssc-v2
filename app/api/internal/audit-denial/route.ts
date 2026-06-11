import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const AuditDenialSchema = z.object({
  userId: z.string().nullable(),
  role: z.enum(['admin', 'procurement_manager', 'viewer']).nullable(),
  pathname: z.string(),
  method: z.string(),
  timestamp: z.string(),
  requestId: z.string()
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate payload
    const payload = AuditDenialSchema.parse(body);
    
    // TODO: Insert into access_denied_audit table once schema is created
    // For now, just log the denial
    console.log('Access denied audit:', {
      timestamp: payload.timestamp,
      userId: payload.userId,
      role: payload.role,
      pathname: payload.pathname,
      method: payload.method,
      requestId: payload.requestId
    });
    
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    console.error('Failed to process audit denial:', error);
    return NextResponse.json(
      { error: 'Invalid payload' },
      { status: 400 }
    );
  }
}