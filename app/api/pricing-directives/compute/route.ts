// app/api/pricing-directives/compute/route.ts
// POST { line_item_key } -> loads the ledger + master ruleset, runs the engine,
// returns the recomputed indicative low/mid/high + reasoning. Read-only: it does
// NOT write to the live listing.
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrInternal } from '@/lib/api-guard';
import pool from '@/lib/db/connection';
import { ensureTables } from '@/lib/pricing/schema';
import { DEFAULT_MASTER_RULESET, type MasterRuleset, type DataPoint } from '@/lib/pricing/masterRuleset';
import { computeIndicative } from '@/lib/pricing/computeIndicative';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const b = await req.json();
    const key = (b?.line_item_key || '').toString().trim();
    if (!key) return NextResponse.json({ error: 'line_item_key is required' }, { status: 400 });

    const rulesRow = await pool.query('SELECT rules FROM pd_master_ruleset WHERE id = 1');
    const rules: MasterRuleset = rulesRow.rows[0]?.rules ?? DEFAULT_MASTER_RULESET;

    const pr = await pool.query(
      `SELECT line_item_key, price_usd::float8 AS price_usd,
              to_char(source_date,'YYYY-MM-DD') AS source_date, source, confidence, material_basis
         FROM pd_data_points WHERE line_item_key = $1`,
      [key]
    );
    const points: DataPoint[] = pr.rows;
    const result = computeIndicative(points, rules);
    return NextResponse.json({ line_item_key: key, ...result });
  } catch (e: any) {
    console.error('[pd/compute] error:', e);
    return NextResponse.json({ error: 'Failed to compute indicative price' }, { status: 500 });
  }
}
