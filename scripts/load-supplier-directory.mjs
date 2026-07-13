/**
 * load-supplier-directory.mjs — deploy-time supplier directory loader.
 *
 * Loads tools/dashboard/data/supplier_directory.json into the `suppliers`
 * table under program 'TG20-DIRECTORY' (one row per supplier x line-item).
 * The curated 'TG20' qualified supplier base is never touched.
 *
 * Idempotent: the directory's content_sha256 is recorded in
 * supplier_directory_manifest; an already-loaded hash is a no-op.
 *
 * NEVER fails the build: every exit path is code 0 with a loud log line.
 * Manual fallback: POST /api/suppliers/ingest {"source":"bundle"} (admin-gated).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const TAG = '[supplier-directory-loader]';
const PROGRAM = 'TG20-DIRECTORY';

const done = (msg) => { console.log(`${TAG} ${msg}`); process.exit(0); };

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) done('SKIP — DATABASE_URL not set in this environment. Load via POST /api/suppliers/ingest {"source":"bundle"} instead.');

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(here, '..', 'tools', 'dashboard', 'data', 'supplier_directory.json');

let directory;
try {
  directory = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (e) {
  done(`SKIP — could not read ${jsonPath}: ${e.message}`);
}

const hash = directory?.meta?.content_sha256;
const suppliers = Array.isArray(directory?.suppliers) ? directory.suppliers : [];
if (!hash || suppliers.length === 0) done('SKIP — bundle missing content_sha256 or suppliers.');

// Map one directory record -> N supplier rows (one per line-item association).
function mapDirectoryToRows(suppliersArr, program = PROGRAM) {
  const rows = [];
  for (const s of suppliersArr) {
    const contactBits = [];
    if (s.phone_number) contactBits.push(`Tel: ${s.phone_number}`);
    for (const c of s.contacts || []) {
      const line = [c.name, c.title, c.details].filter(Boolean).join(' — ');
      if (line) contactBits.push(line);
    }
    const location = [s.street_address, s.city_state_country_postal].filter(Boolean).join('; ') || null;
    for (const li of s.line_items || []) {
      rows.push({
        program,
        line_item_no: String(li),
        supplier: s.heading || s.company,
        website: s.web_address || null,
        contact_note: contactBits.join(' | ') || null,
        location,
        confidence: s.verification_status || null,
        fit_rationale: s.blurb || null,
      });
    }
  }
  return rows;
}

const rows = mapDirectoryToRows(suppliers);

const DDL = `
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program TEXT NOT NULL DEFAULT 'TG20',
  system_no TEXT, system TEXT,
  line_item_no TEXT NOT NULL, line_item TEXT,
  supplier_rank TEXT, supplier TEXT NOT NULL,
  website TEXT, contact_note TEXT, usa_first_status TEXT,
  location TEXT, confidence TEXT, fit_rationale TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_program_line_item_no_idx ON suppliers (program, line_item_no);
CREATE TABLE IF NOT EXISTS supplier_directory_manifest (
  content_sha256 TEXT PRIMARY KEY,
  program TEXT NOT NULL,
  supplier_rows INT NOT NULL,
  loaded_at TIMESTAMP NOT NULL DEFAULT now()
);`;

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(DDL);

  const seen = await client.query('SELECT 1 FROM supplier_directory_manifest WHERE content_sha256 = $1', [hash]);
  if (seen.rowCount > 0) {
    await client.end();
    done(`NO-OP — directory ${hash.slice(0, 12)}… already loaded (${rows.length} rows).`);
  }

  await client.query('BEGIN');
  await client.query('DELETE FROM suppliers WHERE program = $1', [PROGRAM]);

  // Batched multi-row insert, 200 rows per statement.
  const COLS = ['program','line_item_no','supplier','website','contact_note','location','confidence','fit_rationale'];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const base = j * COLS.length;
      values.push(`(${COLS.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(r.program, r.line_item_no, r.supplier, r.website, r.contact_note, r.location, r.confidence, r.fit_rationale);
    });
    await client.query(
      `INSERT INTO suppliers (${COLS.join(',')}) VALUES ${values.join(',')}`,
      params
    );
  }

  await client.query(
    'INSERT INTO supplier_directory_manifest (content_sha256, program, supplier_rows) VALUES ($1,$2,$3)',
    [hash, PROGRAM, rows.length]
  );

  // Audit trail — table may not exist in every environment; never fatal.
  try {
    await client.query(
      'INSERT INTO audit_logs (entity_type, entity_id, action, payload) VALUES ($1,$2,$3,$4)',
      ['supplier_import', PROGRAM, 'DIRECTORY_LOAD',
        JSON.stringify({ hash, rows: rows.length, suppliers: suppliers.length, at: new Date().toISOString() })]
    );
  } catch { /* audit_logs absent — manifest row is the record */ }

  await client.query('COMMIT');
  await client.end();
  done(`LOADED — ${suppliers.length} suppliers → ${rows.length} rows under program ${PROGRAM} (${hash.slice(0, 12)}…).`);
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  try { await client.end(); } catch {}
  done(`SKIP — load failed non-fatally: ${e.message}. Fallback: POST /api/suppliers/ingest {"source":"bundle"}.`);
}
