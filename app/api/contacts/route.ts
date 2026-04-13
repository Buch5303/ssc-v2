import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  const p = join(process.cwd(), 'tools/dashboard/data/contact_stats.json');
  if (!existsSync(p)) return NextResponse.json({ total: 0, verified: 0 });
  try {
    return NextResponse.json(JSON.parse(readFileSync(p, 'utf8')), {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503 }); }
}
