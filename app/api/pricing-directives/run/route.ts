// app/api/pricing-directives/run/route.ts
// POST { line_item_key, directive_text, mode } where mode = 'free' | 'api'
//
// Assembles the layered directive automatically:
//   [ Master Ruleset header ]  <- always on top
//   [ Auto-loaded data-point ledger for this line item ]
//   [ The user's custom directive ]
//   [ The line item + task ]
//
// mode 'free' -> returns the assembled prompt + deep links to Claude / ChatGPT /
//   Perplexity (runs on the user's own subscriptions, $0 to the app).
// mode 'api'  -> ALSO calls the existing researcher agent (metered) and returns
//   its sourced result. The researcher route is used as-is, never modified.
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrInternal } from '@/lib/api-guard';
import pool from '@/lib/db/connection';
import { ensureTables } from '@/lib/pricing/schema';
import {
  DEFAULT_MASTER_RULESET,
  rulesetToDirectiveHeader,
  type MasterRuleset,
} from '@/lib/pricing/masterRuleset';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const URL_LIMIT = 1800;

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrInternal(req);
  if (denied) return denied;
  try {
    await ensureTables();
    const b = await req.json();
    const key = (b?.line_item_key || '').toString().trim();
    const directive = (b?.directive_text || '').toString().trim();
    const mode = b?.mode === 'api' ? 'api' : 'free';
    if (!key) return NextResponse.json({ error: 'line_item_key is required' }, { status: 400 });

    const rulesRow = await pool.query('SELECT rules FROM pd_master_ruleset WHERE id = 1');
    const rules: MasterRuleset = rulesRow.rows[0]?.rules ?? DEFAULT_MASTER_RULESET;

    const pr = await pool.query(
      `SELECT price_usd::float8 AS price_usd, to_char(source_date,'YYYY-MM-DD') AS source_date,
              source, confidence FROM pd_data_points WHERE line_item_key = $1
        ORDER BY source_date DESC`,
      [key]
    );

    const li = await pool.query(
      `SELECT item_no, system_category, equipment, note FROM line_items WHERE id = $1 OR item_no = $1 LIMIT 1`,
      [key]
    );
    const item = li.rows[0];
    const itemDesc = item
      ? `${item.item_no || key} — ${item.system_category || ''} ${item.equipment || ''}`.trim()
      : key;

    const ledger =
      pr.rows.length > 0
        ? pr.rows
            .map((p: any) => `- $${Math.round(p.price_usd).toLocaleString()} (${p.source_date}, ${p.confidence}, ${p.source})`)
            .join('\n')
        : '(no data points yet — this is the first search for this line item)';

    const prompt = [
      rulesetToDirectiveHeader(rules),
      '',
      `LINE ITEM: ${itemDesc}`,
      '',
      'EXISTING DATA POINTS (already normalized rules apply on top of these):',
      ledger,
      '',
      'CUSTOM DIRECTIVE FOR THIS SEARCH:',
      directive || '(none — apply master ruleset only)',
      '',
      'TASK: Find new market pricing data points for this line item. For each, give price (USD), the source, and the date. Then apply the master ruleset to the full set and state the resulting indicative low / mid / high with your reasoning. Cite every source. Indicative only — no fabricated RFQ quotes.',
    ].join('\n');

    const enc = encodeURIComponent(prompt);
    const tooLong = enc.length > URL_LIMIT;
    const shortEnc = encodeURIComponent(
      `${directive || 'Market pricing'} for W251 BOP line item: ${itemDesc}. Give price (USD), source, and date for each data point found. Indicative only, cite sources.`
    );
    const q = tooLong ? shortEnc : enc;

    const deepLinks = {
      claude: `https://claude.ai/new?q=${q}`,
      chatgpt: `https://chatgpt.com/?q=${q}`,
      perplexity: `https://www.perplexity.ai/search?q=${q}`,
    };

    const payload: any = {
      line_item_key: key,
      prompt,
      deepLinks,
      promptTooLongForUrl: tooLong,
      note: tooLong
        ? 'The full ledger is too long for a URL. The links carry a short query; copy the full assembled prompt into a Claude Project / Custom GPT / Perplexity Space to run it with all data points.'
        : 'Links carry the full assembled prompt.',
    };

    if (mode === 'api') {
      try {
        const origin = req.nextUrl.origin;
        const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET || '';
        const rr = await fetch(`${origin}/api/orchestrator/researcher`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ queries: [prompt], context: `W251 BOP line item ${itemDesc}` }),
        });
        payload.metered = await rr.json();
      } catch (e: any) {
        payload.metered = { status: 'error', error: e.message };
      }
    }

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[pd/run] error:', e);
    return NextResponse.json({ error: 'Failed to assemble directive' }, { status: 500 });
  }
}
