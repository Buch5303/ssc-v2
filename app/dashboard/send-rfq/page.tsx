'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '../../../components/ui/Panel';
import { Badge } from '../../../components/ui/Badge';
import { KPI }   from '../../../components/ui/KPI';
import { TierLabel } from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';

interface Template { rfq_id: string; to: string; company: string; category: string; value: number; }
interface DispatchStatus { total:number; send_date:string; days_until:number; method:string; templates:Template[]; }

export default function SendRFQPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dryRun,   setDryRun]   = useState(true);
  const [result,   setResult]   = useState<Record<string,unknown>|null>(null);
  const [loading,  setLoading]  = useState(false);

  const { data: status } = useQuery<DispatchStatus>({
    queryKey:        ['email-status'],
    queryFn:         () => fetch('/api/email/dispatch').then(r => r.json()),
    refetchInterval:  60_000,
  });

  const templates = status?.templates ?? [];
  const days      = status?.days_until ?? 42;
  const method    = status?.method ?? 'mailto_fallback';
  const allSelected = selected.size === templates.length;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(templates.map(t => t.rfq_id)));
  }

  async function dispatch() {
    if (selected.size === 0) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch('/api/email/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rfq_ids: Array.from(selected), dry_run: dryRun }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  const methodLabel = method === 'mailto_fallback'
    ? 'Mailto Links (no email server configured)'
    : method === 'mailgun' ? 'Mailgun' : 'SendGrid';

  const fmtVal = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : `$${(v/1e3).toFixed(0)}K`;

  return (
    <>
      <ConditionBanner
        state={days <= 7 ? 'critical' : 'warning'}
        tag="📤 Send RFQs"
        items={[
          { label: 'Send Date:', value: `May 25, 2026 — ${days} days away` },
          { label: 'Ready:',     value: `${templates.length} packages ready` },
          { label: 'Method:',    value: methodLabel, isAction: days <= 7 },
        ]}
      />

      <div className="p-6 max-w-[1200px]">
        <TierLabel>RFQ Dispatch Console</TierLabel>

        <div className="grid grid-cols-4 gap-px bg-[--line] mb-8">
          <KPI label="Packages Ready"  value={templates.length}    sub="Awaiting dispatch" />
          <KPI label="Days to May 25"  value={days}                sub="Fixed send date"   accent={days <= 14 ? 'warning' : 'none'} />
          <KPI label="Total Value"     value={fmtVal(templates.reduce((s,t)=>s+t.value,0))} sub="Going to market" />
          <KPI label="Email Method"    value={method === 'mailto_fallback' ? 'Manual' : method === 'mailgun' ? 'Mailgun' : 'SendGrid'} sub={method === 'mailto_fallback' ? 'Add MAILGUN_API_KEY to activate' : 'Configured'} />
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-5">

          {/* Package list */}
          <Panel title="Select RFQ Packages to Dispatch" meta={
            <button onClick={toggleAll} style={{ fontFamily:'IBM Plex Mono, monospace', fontSize:9, color:'var(--t2)', background:'none', border:'1px solid var(--line)', padding:'2px 8px', cursor:'pointer' }}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          }>
            <div>
              {templates.map((t) => {
                const sel = selected.has(t.rfq_id);
                return (
                  <div key={t.rfq_id}
                    onClick={() => {
                      const s = new Set(selected);
                      if (sel) s.delete(t.rfq_id); else s.add(t.rfq_id);
                      setSelected(s);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderBottom: '1px solid var(--line)', cursor: 'pointer',
                      background: sel ? 'rgba(30,111,204,0.08)' : 'transparent',
                    }}
                  >
                    <div style={{ width:14, height:14, border:`1px solid ${sel?'var(--brand-blue)':'var(--edge)'}`, background: sel?'var(--brand-blue)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flex:'0 0 auto' }}>
                      {sel && <span style={{ color:'#fff', fontSize:10, lineHeight:1 }}>✓</span>}
                    </div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontFamily:'IBM Plex Mono, monospace', fontSize:10, color:'var(--t3)', marginRight:8 }}>{t.rfq_id}</span>
                      <span style={{ fontSize:12, color:'var(--t0)' }}>{t.company}</span>
                      <span style={{ fontSize:11, color:'var(--t2)', marginLeft:8 }}>{t.category}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                      <span style={{ fontFamily:'IBM Plex Mono, monospace', fontSize:11, color:'var(--t1)' }}>{fmtVal(t.value)}</span>
                      <span style={{ fontFamily:'IBM Plex Mono, monospace', fontSize:9, color:'var(--t3)' }}>{t.to.split('@')[1] ?? '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Dispatch controls */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <Panel title="Dispatch Controls">
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

                <div style={{ padding:'12px', background:'var(--bg2)', fontFamily:'IBM Plex Mono, monospace', fontSize:10, color:'var(--t2)', lineHeight:1.8 }}>
                  Selected: <strong style={{color:'var(--t0)'}}>{selected.size}</strong> of {templates.length}<br/>
                  Value: <strong style={{color:'var(--t0)'}}>{fmtVal(Array.from(selected).reduce((s,id) => s + (templates.find(t=>t.rfq_id===id)?.value??0), 0))}</strong><br/>
                  Method: <strong style={{color:'var(--t0)'}}>{methodLabel}</strong>
                </div>

                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:11, color:'var(--t1)' }}>
                  <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
                    style={{ width:14, height:14, accentColor:'var(--brand-blue)' }} />
                  Dry Run (preview only — no emails sent)
                </label>

                <button
                  onClick={dispatch}
                  disabled={loading || selected.size === 0}
                  style={{
                    background: selected.size === 0 ? 'var(--bg3)' : dryRun ? 'var(--bg2)' : 'var(--brand-blue)',
                    color: selected.size === 0 ? 'var(--t3)' : dryRun ? 'var(--t1)' : '#fff',
                    border: `1px solid ${dryRun ? 'var(--edge)' : 'var(--brand-blue)'}`,
                    fontFamily: 'IBM Plex Sans, sans-serif', fontSize:12, fontWeight:600,
                    padding:'12px 0', cursor: selected.size === 0 ? 'default' : 'pointer',
                    letterSpacing:'0.5px',
                  }}
                >
                  {loading ? 'Processing…' : dryRun ? `Preview ${selected.size} RFQs` : `Send ${selected.size} RFQs`}
                </button>

                {method === 'mailto_fallback' && (
                  <div style={{ padding:'10px 12px', background:'var(--amb-bg)', border:'1px solid var(--amb-bd)', fontFamily:'IBM Plex Mono, monospace', fontSize:9, color:'var(--t2)', lineHeight:1.8 }}>
                    No email server configured.<br/>
                    Add to Vercel env vars:<br/>
                    <strong style={{color:'var(--amb)'}}>MAILGUN_API_KEY</strong><br/>
                    <strong style={{color:'var(--amb)'}}>MAILGUN_DOMAIN</strong><br/>
                    Or: SENDGRID_API_KEY
                  </div>
                )}
              </div>
            </Panel>

            {/* Result */}
            {result && (
              <Panel title="Dispatch Result">
                <div style={{ fontFamily:'IBM Plex Mono, monospace', fontSize:10, color:'var(--t1)', lineHeight:1.8 }}>
                  {(result as Record<string,unknown>).error ? (
                    <span style={{color:'var(--red)'}}>{String((result as Record<string,unknown>).error)}</span>
                  ) : (
                    <>
                      <div>Sent: <strong style={{color:'var(--t0)'}}>{String((result as Record<string,unknown>).sent ?? 0)}</strong></div>
                      <div>Method: {String((result as Record<string,unknown>).method ?? '—')}</div>
                      <div>Dry run: {String((result as Record<string,unknown>).dry_run ?? false)}</div>
                      {((result as Record<string,unknown>).mailto_links as string[] ?? []).slice(0,2).map((link, i) => (
                        <div key={i} style={{marginTop:6}}>
                          <a href={link.split(':').slice(1).join(':')} style={{color:'var(--brand-blue)',textDecoration:'none',fontSize:9}}>
                            Open {(link as string).split(':')[0]} →
                          </a>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
