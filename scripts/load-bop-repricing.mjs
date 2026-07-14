/**
 * load-bop-repricing.mjs — deploy-time loader for the 2026 BOP repricing baseline.
 *
 * Loads tools/dashboard/data/bop_repricing.json into `bop_repricing`
 * (one row per line item, program 'TG20-REPRICING-2026'). Joinable to the
 * supplier directory via line_no = suppliers.line_item_no (TG20-DIRECTORY).
 *
 * Idempotent via content_sha256 in repricing_manifest. NEVER fails the build.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const TAG = '[bop-repricing-loader]';
const PROGRAM = 'TG20-REPRICING-2026';
const done = (msg) => { console.log(`${TAG} ${msg}`); process.exit(0); };

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
if (!DATABASE_URL) done('SKIP — DATABASE_URL not set in this environment.');

const here = dirname(fileURLToPath(import.meta.url));
let book;
try {
  book = JSON.parse(readFileSync(join(here, '..', 'tools', 'dashboard', 'data', 'bop_repricing.json'), 'utf8'));
} catch (e) {
  done(`SKIP — could not read bop_repricing.json: ${e.message}`);
}

const hash = book?.meta?.content_sha256;
const items = Array.isArray(book?.line_items) ? book.line_items : [];
if (!hash || items.length === 0) done('SKIP — bundle missing content_sha256 or line_items.');

const DDL = `
CREATE TABLE IF NOT EXISTS bop_repricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program TEXT NOT NULL,
  line_no INT NOT NULL,
  description TEXT NOT NULL,
  subsystem TEXT,
  tier TEXT,
  method TEXT,
  p25_usd BIGINT,
  point_usd BIGINT,
  p75_usd BIGINT,
  phase_f_verdict TEXT,
  pricing_date_lock DATE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bop_repricing_program_line_idx ON bop_repricing (program, line_no);
CREATE TABLE IF NOT EXISTS repricing_manifest (
  content_sha256 TEXT PRIMARY KEY,
  program TEXT NOT NULL,
  line_rows INT NOT NULL,
  point_total_usd BIGINT NOT NULL,
  loaded_at TIMESTAMP NOT NULL DEFAULT now()
);`;

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(DDL);

  const seen = await client.query('SELECT 1 FROM repricing_manifest WHERE content_sha256 = $1', [hash]);
  if (seen.rowCount > 0) {
    await client.end();
    done(`NO-OP — repricing ${hash.slice(0, 12)}… already loaded (${items.length} lines).`);
  }

  await client.query('BEGIN');
  await client.query('DELETE FROM bop_repricing WHERE program = $1', [PROGRAM]);

  const COLS = ['program','line_no','description','subsystem','tier','method','p25_usd','point_usd','p75_usd','phase_f_verdict','pricing_date_lock'];
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const base = j * COLS.length;
      values.push(`(${COLS.map((_, k) => `$${base + k + 1}`).join(',')})`);
      params.push(PROGRAM, r.line, r.description, r.subsystem, r.tier, r.method,
                  r.p25, r.point, r.p75, r.phase_f_verdict, book.meta.pricing_date_lock);
    });
    await client.query(`INSERT INTO bop_repricing (${COLS.join(',')}) VALUES ${values.join(',')}`, params);
  }

  const total = items.reduce((s, r) => s + (r.point || 0), 0);
  await client.query(
    'INSERT INTO repricing_manifest (content_sha256, program, line_rows, point_total_usd) VALUES ($1,$2,$3,$4)',
    [hash, PROGRAM, items.length, total]
  );

  try {
    await client.query(
      'INSERT INTO audit_logs (entity_type, entity_id, action, payload) VALUES ($1,$2,$3,$4)',
      ['pricing_import', PROGRAM, 'REPRICING_LOAD',
        JSON.stringify({ hash, lines: items.length, point_total_usd: total, at: new Date().toISOString() })]
    );
  } catch { /* audit_logs absent — manifest row is the record */ }

  await client.query('COMMIT');
  await client.end();
  done(`LOADED — ${items.length} lines, point total $${total.toLocaleString()} under ${PROGRAM} (${hash.slice(0, 12)}…).`);
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  try { await client.end(); } catch {}
  done(`SKIP — load failed non-fatally: ${e.message}. Re-run via npm run load:repricing or redeploy.`);
}
