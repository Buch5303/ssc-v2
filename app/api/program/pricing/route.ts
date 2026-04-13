import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const p = join(process.cwd(), 'tools/dashboard/data/pricing_data.json');
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json({ error: 'Data unavailable' }, { status: 503 });
  }
}
