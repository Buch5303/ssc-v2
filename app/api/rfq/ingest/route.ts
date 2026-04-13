import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rfq_id, supplier, contact = '', quoted_price, date, notes = '' } = body;
  if (!rfq_id || !supplier || !quoted_price) {
    return NextResponse.json({ error: 'Required: rfq_id, supplier, quoted_price' }, { status: 400 });
  }
  const RFQ_FILE = join(process.cwd(), 'tools/rfq-generator/rfq_status.json');
  try {
    const data = JSON.parse(readFileSync(RFQ_FILE, 'utf8'));
    const rfq  = (data.rfqs ?? []).find((r: { id: string }) => r.id === rfq_id);
    if (!rfq) return NextResponse.json({ error: `RFQ ${rfq_id} not found` }, { status: 404 });
    const est      = rfq.est_value_usd ?? 0;
    const variance = est > 0 ? Math.round(((quoted_price - est) / est) * 1000) / 10 : 0;
    rfq.status        = 'RESPONDED';
    rfq.response_date = date ?? new Date().toISOString().split('T')[0];
    rfq.quoted_price  = Math.round(quoted_price);
    rfq.variance_pct  = variance;
    if (notes) rfq.notes = notes;
    writeFileSync(RFQ_FILE, JSON.stringify(data, null, 2));
    try {
      execSync('python3 tools/dashboard/generate_dashboard_data.py', { cwd: process.cwd(), timeout: 10_000 });
    } catch { /* non-fatal */ }
    return NextResponse.json({ success: true, rfq_id, supplier, quoted_price, variance_pct: variance });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const data = JSON.parse(readFileSync(join(process.cwd(), 'tools/rfq-generator/rfq_status.json'), 'utf8'));
    return NextResponse.json(data);
  } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503 }); }
}
