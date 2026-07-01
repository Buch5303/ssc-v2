// app/api/pricing-directives/route.ts
// GET  -> list saved directives
// POST { name, directive_text, scope } -> save a directive for reuse
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrInternal } from '@/lib/api-guard';
import pool from '@/lib/db/connection';
import { ensureTables } from '@/lib/pricing/schema';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const r = await pool.query(
      'SELECT id, name, directive_text, scope, created_at FROM pd_directives ORDER BY created_at DESC'
    );
    return NextResponse.json({ directives: r.rows, count: r.rows.length });
  } catch (e: any) {
    console.error('[pd/directives] GET error:', e);
    return NextResponse.json({ error: 'Failed to load directives' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const b = await req.json();
    const name = (b?.name || '').toString().trim();
    const text = (b?.directive_text || '').toString().trim();
    const scope = (b?.scope || 'line_item').toString().trim();
    if (!name || !text) {
      return NextResponse.json({ error: 'name and directive_text are required' }, { status: 400 });
    }
    const r = await pool.query(
      `INSERT INTO pd_directives (name, directive_text, scope)
       VALUES ($1,$2,$3)
       RETURNING id, name, directive_text, scope, created_at`,
      [name, text, scope]
    );
    return NextResponse.json({ directive: r.rows[0] }, { status: 201 });
  } catch (e: any) {
    console.error('[pd/directives] POST error:', e);
    return NextResponse.json({ error: 'Failed to save directive' }, { status: 500 });
  }
}
