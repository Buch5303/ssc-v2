import { NextRequest, NextResponse } from 'next/server';
import { requireInternal } from '@/lib/api-guard';
import { pool } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

// Bootstrap DDL — idempotent, mirrors lib/db/migrations/030_suppliers_lineitems.sql
const DDL = `
CREATE TABLE IF NOT EXISTS line_items (
  id TEXT PRIMARY KEY,
  program TEXT NOT NULL DEFAULT 'TG20',
  item_no TEXT NOT NULL,
  system_category TEXT,
  equipment TEXT,
  note TEXT,
  responsibility TEXT,
  source_page TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS line_items_program_idx ON line_items (program);
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program TEXT NOT NULL DEFAULT 'TG20',
  system_no TEXT,
  system TEXT,
  line_item_no TEXT NOT NULL,
  line_item TEXT,
  supplier_rank TEXT,
  supplier TEXT NOT NULL,
  website TEXT,
  contact_note TEXT,
  usa_first_status TEXT,
  location TEXT,
  confidence TEXT,
  fit_rationale TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_program_line_item_no_idx ON suppliers (program, line_item_no);
`;

interface LineItemRow {
  item_no?: string; system_category?: string; equipment?: string;
  note?: string; responsibility?: string; source_page?: string;
}
interface SupplierRow {
  system_no?: string; system?: string; line_item_no?: string; line_item?: string;
  supplier_rank?: string; supplier?: string; website?: string; contact_note?: string;
  usa_first_status?: string; location?: string; confidence?: string; fit_rationale?: string;
}

// Admin-gated bulk import for the procurement scope + supplier base.
// Auth: Authorization: Bearer <ADMIN_SECRET|CRON_SECRET>  (server-to-server only)
export async function POST(req: NextRequest) {
  const denied = requireInternal(req);
  if (denied) return denied;

  let body: { program?: string; mode?: string; source?: string; line_items?: LineItemRow[]; suppliers?: SupplierRow[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Bundle mode — {"source":"bundle"} loads the repo-bundled consolidated
  // supplier directory (tools/dashboard/data/supplier_directory.json) into
  // program 'TG20-DIRECTORY'. Same auth, same transaction path. Used as the
  // manual fallback for scripts/load-supplier-directory.mjs (deploy-time).
  if (body?.source === 'bundle') {
    try {
      const p = join(process.cwd(), 'tools', 'dashboard', 'data', 'supplier_directory.json');
      const dir = JSON.parse(readFileSync(p, 'utf8'));
      const mapped: SupplierRow[] = [];
      for (const s of dir?.suppliers ?? []) {
        const contactBits: string[] = [];
        if (s.phone_number) contactBits.push(`Tel: ${s.phone_number}`);
        for (const c of s.contacts ?? []) {
          const line = [c.name, c.title, c.details].filter(Boolean).join(' — ');
          if (line) contactBits.push(line);
        }
        const location = [s.street_address, s.city_state_country_postal].filter(Boolean).join('; ') || undefined;
        for (const li of s.line_items ?? []) {
          mapped.push({
            line_item_no: String(li),
            supplier: s.heading || s.company,
            website: s.web_address || undefined,
            contact_note: contactBits.join(' | ') || undefined,
            location,
            confidence: s.verification_status || undefined,
            fit_rationale: s.blurb || undefined,
          });
        }
      }
      body.program = body.program ?? 'TG20-DIRECTORY';
      body.suppliers = mapped;
      body.line_items = body.line_items ?? [];
    } catch (err) {
      return NextResponse.json({ error: `Bundle load failed: ${String(err)}` }, { status: 500 });
    }
  }

  const program = (body?.program ?? 'TG20').toString();
  const mode = (body?.mode ?? 'replace').toString(); // 'replace' | 'append'
  const lineItems = Array.isArray(body?.line_items) ? body.line_items : [];
  const suppliers = Array.isArray(body?.suppliers) ? body.suppliers : [];

  if (lineItems.length === 0 && suppliers.length === 0) {
    return NextResponse.json({ error: 'Provide line_items and/or suppliers' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);

    let liCount = 0;
    let supCount = 0;

    if (lineItems.length > 0) {
      if (mode === 'replace') await client.query('DELETE FROM line_items WHERE program = $1', [program]);
      for (const r of lineItems) {
        const id = `${program}-${String(r.item_no ?? '').padStart(3, '0')}`;
        await client.query(
          `INSERT INTO line_items (id, program, item_no, system_category, equipment, note, responsibility, source_page)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
             system_category = EXCLUDED.system_category,
             equipment       = EXCLUDED.equipment,
             note            = EXCLUDED.note,
             responsibility  = EXCLUDED.responsibility,
             source_page     = EXCLUDED.source_page`,
          [id, program, r.item_no ?? '', r.system_category ?? null, r.equipment ?? null,
            r.note ?? null, r.responsibility ?? null, r.source_page ?? null]
        );
        liCount++;
      }
    }

    if (suppliers.length > 0) {
      if (mode === 'replace') await client.query('DELETE FROM suppliers WHERE program = $1', [program]);
      for (const s of suppliers) {
        await client.query(
          `INSERT INTO suppliers (program, system_no, system, line_item_no, line_item, supplier_rank,
             supplier, website, contact_note, usa_first_status, location, confidence, fit_rationale)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [program, s.system_no ?? null, s.system ?? null, s.line_item_no ?? '', s.line_item ?? null,
            s.supplier_rank ?? null, s.supplier ?? '', s.website ?? null, s.contact_note ?? null,
            s.usa_first_status ?? null, s.location ?? null, s.confidence ?? null, s.fit_rationale ?? null]
        );
        supCount++;
      }
    }

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, payload) VALUES ($1,$2,$3,$4)`,
      ['supplier_import', program, 'INGEST',
        JSON.stringify({ mode, line_items: liCount, suppliers: supCount, at: new Date().toISOString() })]
    );

    await client.query('COMMIT');
    return NextResponse.json({
      success: true, program, mode,
      line_items_inserted: liCount, suppliers_inserted: supCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}

// Counts — admin-gated. Returns 503 until the tables exist (first POST creates them).
export async function GET(req: NextRequest) {
  const denied = requireInternal(req);
  if (denied) return denied;
  try {
    const li = await pool.query('SELECT COUNT(*)::int AS n FROM line_items');
    const sp = await pool.query('SELECT COUNT(*)::int AS n FROM suppliers');
    return NextResponse.json({ line_items: li.rows[0]?.n ?? 0, suppliers: sp.rows[0]?.n ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
