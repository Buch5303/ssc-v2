/**
 * /api/live — Live data endpoint
 * Reads from JSON data files (GitHub-synced).
 * When DATABASE_URL is set, the Neon DB layer activates server-side via neon_api.py.
 */
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'tools/dashboard/data');

function readJson(filename: string) {
  const p = join(DATA_DIR, filename);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export async function GET() {
  const summary  = readJson('program_summary.json');
  const rfqData  = readJson('rfq_pipeline.json');
  const pricing  = readJson('pricing_data.json');
  const contacts = readJson('contact_stats.json');
  const kpi      = readJson('kpi_band.json');
  const suppliers= readJson('supplier_network.json');

  // Compute derived metrics
  const rfqs         = (rfqData?.rfqs ?? []) as Array<{status:string; est_value_usd:number}>;
  const responded    = rfqs.filter(r => r.status === 'RESPONDED').length;
  const drafted      = rfqs.filter(r => r.status === 'DRAFTED').length;
  const pipelineVal  = rfqs.reduce((s, r) => s + (r.est_value_usd || 0), 0);
  const daysToSend   = Math.ceil((new Date('2026-05-25').getTime() - Date.now()) / 86_400_000);

  return NextResponse.json({
    source:         'json_files',
    db_enabled:     Boolean(process.env.DATABASE_URL),
    summary,
    rfqs:           rfqData,
    pricing,
    contacts,
    kpi,
    suppliers,
    computed: {
      responded,
      drafted,
      pipeline_value: pipelineVal,
      days_to_send:   daysToSend,
    },
    ts: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' },
  });
}
