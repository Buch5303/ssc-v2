'use client';
// app/dashboard/pricing-directives/page.tsx
// Pricing Directives — a self-contained sandbox window. Additive and view-only:
// it computes an indicative price in its own ledger and NEVER writes to the live
// listing unless a promotion switch (deliberately disabled here) is turned on.
import { useEffect, useState } from 'react';
import { Panel } from '@/components/ui/Panel';

type Ruleset = any;
type Result = any;

const money = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString();

async function j(url: string, opts?: RequestInit) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data;
}

const btn =
  'font-mono text-[10px] tracking-[1px] uppercase px-3 py-2 border border-[--line] bg-[--bg2] text-[--t1] hover:bg-[--bg3] disabled:opacity-40 transition-colors';
const inp =
  'w-full bg-[--bg2] border border-[--line] text-[--t1] text-[13px] px-3 py-2 outline-none focus:border-[--t2]';
const lbl = 'font-mono text-[9px] tracking-[1.5px] uppercase text-[--t2] block mb-1';

export default function PricingDirectivesPage() {
  const [rules, setRules] = useState<Ruleset | null>(null);
  const [savingRules, setSavingRules] = useState(false);

  const [lineKey, setLineKey] = useState('');
  const [directive, setDirective] = useState('');
  const [points, setPoints] = useState<any[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [assembled, setAssembled] = useState<any | null>(null);
  const [runMode, setRunMode] = useState<'free' | 'api'>('free');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  // New-point form
  const [np, setNp] = useState({ price_usd: '', source: '', source_date: '', confidence: 'indicative', material_basis: '' });

  useEffect(() => {
    j('/api/pricing-directives/master').then((d) => setRules(d.rules)).catch((e) => setErr(e.message));
  }, []);

  const loadPoints = async (key: string) => {
    if (!key.trim()) return;
    try {
      const d = await j(`/api/pricing-directives/points?line_item_key=${encodeURIComponent(key.trim())}`);
      setPoints(d.points);
    } catch (e: any) { setErr(e.message); }
  };

  const saveRules = async () => {
    setSavingRules(true); setErr('');
    try {
      const d = await j('/api/pricing-directives/master', { method: 'PUT', body: JSON.stringify({ rules }) });
      setRules(d.rules);
    } catch (e: any) { setErr(e.message); } finally { setSavingRules(false); }
  };

  const recompute = async () => {
    if (!lineKey.trim()) { setErr('Enter a line item key first.'); return; }
    setBusy('compute'); setErr('');
    try {
      const d = await j('/api/pricing-directives/compute', { method: 'POST', body: JSON.stringify({ line_item_key: lineKey.trim() }) });
      setResult(d);
      await loadPoints(lineKey);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const addPoint = async () => {
    setBusy('addpoint'); setErr('');
    try {
      await j('/api/pricing-directives/points', {
        method: 'POST',
        body: JSON.stringify({ line_item_key: lineKey.trim(), ...np, price_usd: Number(np.price_usd) }),
      });
      setNp({ price_usd: '', source: '', source_date: '', confidence: 'indicative', material_basis: '' });
      await loadPoints(lineKey);
      await recompute();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const runDirective = async () => {
    if (!lineKey.trim()) { setErr('Enter a line item key first.'); return; }
    setBusy('run'); setErr('');
    try {
      const d = await j('/api/pricing-directives/run', {
        method: 'POST',
        body: JSON.stringify({ line_item_key: lineKey.trim(), directive_text: directive, mode: runMode }),
      });
      setAssembled(d);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const setR = (k: string, v: any) => setRules((r: any) => ({ ...r, [k]: v }));
  const setCW = (k: string, v: any) => setRules((r: any) => ({ ...r, confidenceWeights: { ...r.confidenceWeights, [k]: Number(v) } }));

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[--t1] text-[20px] font-semibold tracking-tight">Pricing Directives</h1>
          <p className="text-[--t2] text-[12px] mt-1">Author a directive; the master ruleset and this line item's data points load on top automatically.</p>
        </div>
        <span className="font-mono text-[9px] tracking-[1.5px] uppercase px-3 py-2 border border-[--line] text-[--t2] bg-[--bg2]">
          Sandbox · not promoted to live listing
        </span>
      </div>

      {err && (
        <div className="border border-[--red] bg-[--red-bg] text-[--red] text-[12px] px-3 py-2 font-mono">{err}</div>
      )}

      {/* MASTER RULESET */}
      <Panel title="Master Ruleset · applied on top of every directive" meta={
        <button className={btn} disabled={savingRules || !rules} onClick={saveRules}>{savingRules ? 'Saving…' : 'Save rules'}</button>
      }>
        {!rules ? <div className="text-[--t2] text-[12px]">Loading…</div> : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className={lbl}>Inflation %/yr</label>
              <input className={inp} type="number" step="0.1" value={rules.inflationAnnualPct} onChange={(e) => setR('inflationAnnualPct', Number(e.target.value))} /></div>
            <div><label className={lbl}>Recency half-life (mo)</label>
              <input className={inp} type="number" value={rules.recencyHalfLifeMonths} onChange={(e) => setR('recencyHalfLifeMonths', Number(e.target.value))} /></div>
            <div><label className={lbl}>Material multiplier</label>
              <input className={inp} type="number" step="0.05" value={rules.materialMultiplier} onChange={(e) => setR('materialMultiplier', Number(e.target.value))} /></div>
            <div><label className={lbl}>Weight · verified</label>
              <input className={inp} type="number" step="0.05" value={rules.confidenceWeights?.verified} onChange={(e) => setCW('verified', e.target.value)} /></div>
            <div><label className={lbl}>Weight · indicative</label>
              <input className={inp} type="number" step="0.05" value={rules.confidenceWeights?.indicative} onChange={(e) => setCW('indicative', e.target.value)} /></div>
            <div><label className={lbl}>Weight · estimated</label>
              <input className={inp} type="number" step="0.05" value={rules.confidenceWeights?.estimated} onChange={(e) => setCW('estimated', e.target.value)} /></div>
            <div><label className={lbl}>Band method</label>
              <select className={inp} value={rules.bandMethod} onChange={(e) => setR('bandMethod', e.target.value)}>
                <option value="spread">spread (P25/P75)</option>
                <option value="fixed">fixed %</option>
              </select></div>
            <div><label className={lbl}>Fixed band ± %</label>
              <input className={inp} type="number" value={rules.fixedBandPct} onChange={(e) => setR('fixedBandPct', Number(e.target.value))} /></div>
            <div><label className={lbl}>Min points for spread</label>
              <input className={inp} type="number" value={rules.minPointsForSpread} onChange={(e) => setR('minPointsForSpread', Number(e.target.value))} /></div>
          </div>
        )}
      </Panel>

      {/* DIRECTIVE WINDOW */}
      <Panel title="Directive window">
        <div className="space-y-3">
          <div><label className={lbl}>Line item key (line_items id or item_no)</label>
            <input className={inp} value={lineKey} placeholder="e.g. TG20-014" onChange={(e) => setLineKey(e.target.value)} onBlur={(e) => loadPoints(e.target.value)} /></div>
          <div><label className={lbl}>Custom directive (sits under the master ruleset)</label>
            <textarea className={inp + ' min-h-[90px] resize-y'} value={directive} placeholder="e.g. European suppliers only, ex-works, exclude reconditioned units." onChange={(e) => setDirective(e.target.value)} /></div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={btn} disabled={busy === 'compute'} onClick={recompute}>{busy === 'compute' ? 'Recomputing…' : 'Recompute indicative'}</button>
            <span className="w-px h-6 bg-[--line] mx-1" />
            <select className={inp + ' w-auto'} value={runMode} onChange={(e) => setRunMode(e.target.value as any)}>
              <option value="free">Free · Claude/GPT/Perplexity links</option>
              <option value="api">Metered · run in-app</option>
            </select>
            <button className={btn} disabled={busy === 'run'} onClick={runDirective}>{busy === 'run' ? 'Assembling…' : 'Assemble & run'}</button>
          </div>
        </div>
      </Panel>

      {/* RESULT */}
      {result && (
        <Panel title="Recomputed indicative price" meta={<span className="font-mono text-[9px] text-[--t2]">{result.pointsUsed} pts · {result.bandMethod}</span>}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            {(['low', 'mid', 'high'] as const).map((k) => (
              <div key={k} className="border border-[--line] bg-[--bg2] p-3">
                <div className="font-mono text-[9px] tracking-[1.5px] uppercase text-[--t2]">{k}</div>
                <div className="text-[--t1] text-[18px] font-semibold mt-1">{money(result[k])}</div>
              </div>
            ))}
          </div>
          <p className="text-[--t2] text-[12px] leading-relaxed">{result.reasoning}</p>
        </Panel>
      )}

      {/* LEDGER */}
      <Panel title={`Data-point ledger${lineKey ? ` · ${lineKey}` : ''}`}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <input className={inp} placeholder="Price USD" value={np.price_usd} onChange={(e) => setNp({ ...np, price_usd: e.target.value })} />
          <input className={inp} placeholder="Source" value={np.source} onChange={(e) => setNp({ ...np, source: e.target.value })} />
          <input className={inp} placeholder="Date YYYY-MM-DD" value={np.source_date} onChange={(e) => setNp({ ...np, source_date: e.target.value })} />
          <select className={inp} value={np.confidence} onChange={(e) => setNp({ ...np, confidence: e.target.value })}>
            <option value="verified">verified</option>
            <option value="indicative">indicative</option>
            <option value="estimated">estimated</option>
          </select>
          <button className={btn} disabled={busy === 'addpoint' || !lineKey.trim()} onClick={addPoint}>{busy === 'addpoint' ? 'Adding…' : '+ Add point'}</button>
        </div>
        {points.length === 0 ? (
          <div className="text-[--t2] text-[12px]">No data points for this line item yet. Add one above, or run a search to gather them.</div>
        ) : (
          <div className="divide-y divide-[--line]">
            {points.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 text-[12px]">
                <span className="text-[--t1] font-mono">{money(p.price_usd)}</span>
                <span className="text-[--t2]">{p.source_date} · {p.confidence}</span>
                <span className="text-[--t2] truncate max-w-[40%] text-right">{p.source}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ASSEMBLED / RUN OUTPUT */}
      {assembled && (
        <Panel title="Assembled directive" meta={
          <button className={btn} onClick={() => navigator.clipboard?.writeText(assembled.prompt)}>Copy prompt</button>
        }>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <a className={btn} href={assembled.deepLinks?.claude} target="_blank" rel="noreferrer">Open in Claude</a>
            <a className={btn} href={assembled.deepLinks?.chatgpt} target="_blank" rel="noreferrer">Open in ChatGPT</a>
            <a className={btn} href={assembled.deepLinks?.perplexity} target="_blank" rel="noreferrer">Open in Perplexity</a>
          </div>
          {assembled.promptTooLongForUrl && (
            <p className="text-[--t2] text-[11px] mb-2">{assembled.note}</p>
          )}
          <pre className="bg-[--bg2] border border-[--line] p-3 text-[11px] text-[--t1] whitespace-pre-wrap max-h-[280px] overflow-auto">{assembled.prompt}</pre>
          {assembled.metered && (
            <pre className="mt-3 bg-[--bg2] border border-[--line] p-3 text-[11px] text-[--t1] whitespace-pre-wrap max-h-[280px] overflow-auto">{JSON.stringify(assembled.metered, null, 2)}</pre>
          )}
        </Panel>
      )}
    </div>
  );
}
