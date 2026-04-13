import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  const DATA = join(process.cwd(), 'tools/dashboard/data');
  const checks: Record<string, boolean> = {
    pricing_data:    existsSync(join(DATA, 'pricing_data.json')),
    rfq_pipeline:    existsSync(join(DATA, 'rfq_pipeline.json')),
    program_summary: existsSync(join(DATA, 'program_summary.json')),
    contacts:        existsSync(join(DATA, 'contact_stats.json')),
  };
  const allOk = Object.values(checks).every(Boolean);
  let bopTotal: number | null = null;
  try {
    bopTotal = JSON.parse(readFileSync(join(DATA, 'pricing_data.json'), 'utf8')).total_mid;
  } catch {}
  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    platform: 'FlowSeer v2.1.0',
    program: 'TG20/W251', client: 'Borderplex',
    bop_total: bopTotal, checks,
    timestamp: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
