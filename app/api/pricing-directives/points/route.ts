// app/api/pricing-directives/points/route.ts
// GET  ?line_item_key=... -> the data-point ledger for that line item
// POST { line_item_key, price_usd, source, source_date, confidence, material_basis }
//      -> append a new data point (this is what shifts the indicative price)
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
    const key = req.nextUrl.searchParams.get('line_item_key');
    if (!key) return NextResponse.json({ error: 'line_item_key is required' }, { status: 400 });
    const r = await pool.query(
      `SELECT id, line_item_key, price_usd::float8 AS price_usd, source,
              to_char(source_date,'YYYY-MM-DD') AS source_date, confidence, material_basis, created_at
         FROM pd_data_points
        WHERE line_item_key = $1
        ORDER BY source_date DESC, created_at DESC`,
      [key]
    );
    return NextResponse.json({ points: r.rows, count: r.rows.length });
  } catch (e: any) {
    console.error('[pd/points] GET error:', e);
    return NextResponse.json({ error: 'Failed to load data points' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const b = await req.json();
    const key = (b?.line_item_key || '').toString().trim();
    const price = Number(b?.price_usd);
    const source = (b?.source || '').toString().trim();
    const date = (b?.source_date || '').toString().trim();
    const confidence = ['verified', 'indicative', 'estimated'].includes(b?.confidence) ? b.confidence : 'indicative';
    const material = b?.material_basis ? b.material_basis.toString() : null;

    if (!key || !source || !date || !(price > 0)) {
      return NextResponse.json(
        { error: 'Requires line_item_key, price_usd (>0), source, and source_date (YYYY-MM-DD)' },
        { status: 400 }
      );
    }
    const r = await pool.query(
      `INSERT INTO pd_data_points (line_item_key, price_usd, source, source_date, confidence, material_basis)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, line_item_key, price_usd::float8 AS price_usd,
                 to_char(source_date,'YYYY-MM-DD') AS source_date, source, confidence, material_basis, created_at`,
      [key, price, source, date, confidence, material]
    );
    return NextResponse.json({ point: r.rows[0] }, { status: 201 });
  } catch (e: any) {
    console.error('[pd/points] POST error:', e);
    return NextResponse.json({ error: 'Failed to add data point' }, { status: 500 });
  }
}
