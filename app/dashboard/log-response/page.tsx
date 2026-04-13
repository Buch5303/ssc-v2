'use client';
import { useState } from 'react';
import { useQuery }  from '@tanstack/react-query';
import { fetchRFQPipeline, fmtCurrency } from '../../../lib/api/flowseer';
import { Panel }    from '../../../components/ui/Panel';
import { TierLabel } from '../../../components/ui/TierLabel';
import { Badge }    from '../../../components/ui/Badge';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';

export default function LogResponsePage() {
  const [form, setForm]       = useState({ rfq_id:'', supplier:'', contact:'', quoted_price:'', date:'', notes:'' });
  const [result, setResult]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: rfqs, refetch } = useQuery({
    queryKey: ['rfqs'], queryFn: fetchRFQPipeline, refetchInterval: 30_000,
  });

  const drafted = (rfqs?.rfqs ?? []).filter((r: { status: string }) => r.status === 'DRAFTED' || r.status === 'SENT');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setResult(null); setError(null);
    try {
      const res = await fetch('/api/rfq/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, quoted_price: parseFloat(form.quoted_price) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(`Logged: ${data.rfq_id} — $${Number(data.quoted_price).toLocaleString()} (${data.variance_pct > 0 ? '+' : ''}${data.variance_pct}% vs estimate)`);
      setForm({ rfq_id:'', supplier:'', contact:'', quoted_price:'', date:'', notes:'' });
      refetch();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const inp = {
    width:'100%', background:'var(--bg2)', border:'1px solid var(--edge)',
    color:'var(--t0)', fontFamily:'IBM Plex Mono, monospace', fontSize:12, padding:'9px 12px', outline:'none',
  };

  const lbl = {
    display:'block' as const, fontFamily:'IBM Plex Mono, monospace', fontSize:9,
    letterSpacing:'1.5px', textTransform:'uppercase' as const, color:'var(--t2)', marginBottom:6,
  };

  return (
    <>
      <ConditionBanner state="mono" tag="Log Response"
        items={[
          { label: 'Purpose:', value: 'Log a supplier RFQ response — updates pipeline and confidence' },
          { label: 'Drafted:', value: `${drafted.length} RFQs awaiting response after May 25` },
        ]}
      />
      <div className="p-6 max-w-[900px]">
        <TierLabel>Ingest Supplier Response</TierLabel>
        <div className="grid grid-cols-2 gap-5">
          <Panel title="Response Details">
            <form onSubmit={handleSubmit}>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={lbl}>RFQ Package</label>
                  <select value={form.rfq_id}
                    onChange={e => {
                      const rfq = (rfqs?.rfqs ?? []).find((r: {id:string}) => r.id === e.target.value) as Record<string,unknown>|undefined;
                      setForm(f => ({ ...f, rfq_id: e.target.value, supplier: String(rfq?.company ?? f.supplier), contact: String(rfq?.contact ?? f.contact) }));
                    }}
                    required style={{ ...inp, cursor:'pointer' }}>
                    <option value="">Select RFQ…</option>
                    {(drafted as any[]).map((r: any) => (
                      <option key={r.id} value={r.id}>{r.id} — {r.company} ({r.category})</option>
                    ))}
                  </select>
                </div>
                <div><label style={lbl}>Supplier</label><input type="text" value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} required style={inp}/></div>
                <div><label style={lbl}>Contact Name</label><input type="text" value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} style={inp}/></div>
                <div><label style={lbl}>Quoted Price (USD)</label><input type="number" value={form.quoted_price} onChange={e=>setForm(f=>({...f,quoted_price:e.target.value}))} required min="0" step="1000" style={inp}/></div>
                <div><label style={lbl}>Response Date</label><input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={inp}/></div>
                <div><label style={lbl}>Notes</label><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={3} style={{...inp, resize:'vertical'}} /></div>
                {result && <div style={{fontFamily:'IBM Plex Mono,monospace',fontSize:11,color:'var(--t0)',padding:'10px 12px',background:'var(--bg2)',borderLeft:'2px solid var(--t2)'}}>{result}</div>}
                {error  && <div style={{fontFamily:'IBM Plex Mono,monospace',fontSize:11,color:'var(--red)',padding:'10px 12px',background:'var(--red-bg)',border:'1px solid var(--red-bd)'}}>{error}</div>}
                <button type="submit" disabled={loading} style={{background:loading?'var(--bg3)':'var(--brand-blue)',color:loading?'var(--t2)':'#fff',border:'none',fontFamily:'IBM Plex Sans,sans-serif',fontSize:12,fontWeight:600,padding:'11px 0',cursor:loading?'default':'pointer',letterSpacing:'0.5px'}}>
                  {loading ? 'Logging…' : 'Log Response'}
                </button>
              </div>
            </form>
          </Panel>
          <Panel title="Pipeline Status" meta={<Badge>{rfqs?.total ?? 13} packages</Badge>}>
            <div>
              {((rfqs?.rfqs ?? []) as any[]).map((r: any, i:number) => (
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--line)',fontSize:11}}>
                  <div><span style={{fontFamily:'IBM Plex Mono,monospace',fontSize:10,color:'var(--t3)',marginRight:8}}>{r.id}</span><span style={{color:'var(--t1)'}}>{r.company}</span></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontFamily:'IBM Plex Mono,monospace',fontSize:10,color:'var(--t2)'}}>{fmtCurrency(r.quoted_price??r.est_value_usd,0)}</span>
                    <Badge variant={r.status==='RESPONDED'?'verified':'pending'}>{r.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
