// app/api/pricing-directives/master/route.ts
// GET  -> current Master Ruleset (the base rules layered on every directive)
// PUT  -> replace the Master Ruleset
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrInternal } from '@/lib/api-guard';
import pool from '@/lib/db/connection';
import { ensureTables } from '@/lib/pricing/schema';
import { DEFAULT_MASTER_RULESET, type MasterRuleset } from '@/lib/pricing/masterRuleset';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const r = await pool.query('SELECT rules, updated_at FROM pd_master_ruleset WHERE id = 1');
    const rules: MasterRuleset = r.rows[0]?.rules ?? DEFAULT_MASTER_RULESET;
    return NextResponse.json({ rules, updated_at: r.rows[0]?.updated_at ?? null });
  } catch (e: any) {
    console.error('[pd/master] GET error:', e);
    return NextResponse.json({ error: 'Failed to load master ruleset' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const body = await req.json();
    const rules = body?.rules;
    if (!rules || typeof rules !== 'object') {
      return NextResponse.json({ error: 'Body must include a "rules" object' }, { status: 400 });
    }
    const merged: MasterRuleset = { ...DEFAULT_MASTER_RULESET, ...rules };
    const r = await pool.query(
      `INSERT INTO pd_master_ruleset (id, rules, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules, updated_at = now()
       RETURNING rules, updated_at`,
      [JSON.stringify(merged)]
    );
    return NextResponse.json({ rules: r.rows[0].rules, updated_at: r.rows[0].updated_at });
  } catch (e: any) {
    console.error('[pd/master] PUT error:', e);
    return NextResponse.json({ error: 'Failed to save master ruleset' }, { status: 500 });
  }
}
