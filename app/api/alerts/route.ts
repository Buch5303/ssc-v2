import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  const p = join(process.cwd(), 'tools/notifications/current_alerts.json');
  if (!existsSync(p)) return NextResponse.json({ alerts: [], counts: {} });
  try {
    return NextResponse.json(JSON.parse(readFileSync(p, 'utf8')), {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    });
  } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503 }); }
}
