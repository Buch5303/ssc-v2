'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRFQPipeline, fetchProgramSummary, daysToSend, fmtCurrency } from '../../../lib/api/flowseer';
import { KPI }             from '../../../components/ui/KPI';
import { Badge }           from '../../../components/ui/Badge';
import { Panel }           from '../../../components/ui/Panel';
import { AlertCard }       from '../../../components/ui/AlertCard';
import { TierLabel }       from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';
import { TableFilter }     from '../../../components/ui/TableFilter';
import { RFQDrawer }       from '../../../components/rfq/RFQDrawer';
import { clsx }            from 'clsx';
import type { RFQ }        from '../../../lib/types/flowseer';

const statusBadge = (status: string) => {
  if (status === 'RESPONDED') return <Badge variant="verified">Responded</Badge>;
  if (status === 'BLOCKED')   return <Badge variant="critical">Blocked</Badge>;
  return <Badge>Drafted</Badge>;
};

const criticalCodes = new Set(['GENERATOR','TRANSFORMER']);

export default function RFQPipelinePage() {
  const Q = { refetchInterval: 60_000 };
  const { data: rfqs }    = useQuery({ queryKey: ['rfqs'],    queryFn: fetchRFQPipeline,  ...Q });
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: fetchProgramSummary,...Q });

  const [search, setSearch]   = useState('');
  const [statusF, setStatusF] = useState('');
  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null);

  const days      = summary?.days_to_rfq_send ?? daysToSend();
  const items     = rfqs?.rfqs    ?? [];
  const responded = rfqs?.responded ?? 1;
  const drafted   = rfqs?.drafted   ?? 12;
  const pipelineV = rfqs?.pipeline_value ?? 9_898_000;

  const filtered = useMemo(() => items.filter(r => {
    const q = search.toLowerCase();
    const mQ = !q || r.company.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    const mS = !statusF || r.status === statusF;
    return mQ && mS;
  }), [items, search, statusF]);

  const exportCSV = () => {
    const rows = [['ID','Company','Contact','Category','Est. Value','Status','Notes']];
    items.forEach(r => rows.push([r.id, r.company, r.contact, r.category, fmtCurrency(r.est_value_usd), r.status, r.notes ?? '']));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv])); a.download = 'flowseer_rfq_pipeline.csv'; a.click();
  };

  const stages = [
    { label: 'Drafted',    count: drafted,   sub: fmtCurrency(items.filter(r=>r.status==='DRAFTED').reduce((s,r)=>s+r.est_value_usd,0)), active: false },
    { label: 'Send Day',   count: `${days}d`, sub: 'May 25, 2026', active: true  },
    { label: 'Sent',       count: 0,         sub: 'Awaiting May 25', active: false },
    { label: 'Responded',  count: responded, sub: '$340K — Baker Hughes', active: false },
    { label: 'Evaluated',  count: 0,         sub: 'Jul 15 – Aug 15', active: false },
    { label: 'Awarded',    count: 0,         sub: 'Target Aug 15, 2026', active: false },
  ];

  return (
    <>
      <ConditionBanner
        state="warning"
        tag="📋 RFQ"
        items={[
          { label: 'Stage:',     value: `1 Responded · ${drafted} Drafted · 0 Sent · 0 Awarded` },
          { label: 'Blocked:',   value: '$1.725M pending EthosEnergy ICD' },
          { label: 'Send Date:', value: `May 25, 2026 — ${days} days`, isAction: true },
        ]}
      />

      <div className="p-6 max-w-[1400px]">
        <TierLabel>Tier 1 — Pipeline Status</TierLabel>
        <div className="flex border border-[--line] mb-6">
          {stages.map((s, i) => (
            <div key={i} className={clsx('flex-1 px-4 py-4 border-r border-[--line] last:border-r-0 relative', s.active && 'bg-[--bg2]')}>
              <div className={clsx('font-mono text-[9px] tracking-[2px] uppercase mb-2', s.active ? 'text-[--brand-blue2]' : 'text-[--t3]')}>{s.label}</div>
              <div className={clsx('font-mono text-[28px] font-light leading-none', s.active ? 'text-[--t0]' : 'text-[--t2]', s.label === 'Responded' && responded > 0 && 'text-[--t0]')}>{s.count}</div>
              <div className="text-[10px] text-[--t2] mt-1">{s.sub}</div>
              {i < stages.length - 1 && (
                <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] bg-[--bg0] border border-[--line] rounded-full flex items-center justify-center z-10">
                  <span className="text-[7px] text-[--t3]">›</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI label="Total Pipeline"    value={fmtCurrency(pipelineV)} sub={`${items.length} packages · 11 suppliers`} />
          <KPI label="Days to Send"      value={days}                   sub="May 25, 2026 — FIXED" accent="warning" />
          <KPI label="Responses"         value={`${responded} / ${items.length}`} sub="Baker Hughes $340K · +26.7%" badge={<Badge>Live</Badge>} />
          <KPI label="Blocked Value"     value="$1.73M"                 sub="Transformer + Exhaust + Electrical" accent="critical" badge={<Badge variant="critical">ICD Req'd</Badge>} />
          <KPI label="Critical Path"     value="2"                      sub="Generator 40–56wk · Transformer 52–70wk" />
          <KPI label="Pre-Send Gates"    value="7 / 10"                 sub="3 manual gates need action" />
        </div>

        <TierLabel>Tier 2 — Bottlenecks</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Panel title="Pre-Send Gate Checks" meta={<Badge variant="warning">3 Pending</Badge>}>
            <div className="flex flex-col gap-2">
              <AlertCard severity="critical" title="G03 — EthosEnergy ICD not received" detail="Blocks 3 RFQs: Transformer (voltage/MVA), Exhaust (flange dims), Electrical Distribution. Cannot finalize without ICD." action="→ python3 tools/flowseer.py icd escalate" />
              <AlertCard severity="warning"  title="G07 — NM Environmental Permit Scope (CECO $892K)" detail="NOx/CO limits needed before CECO RFQ can be fully specified." action="→ Confirm with NM Environment Dept / regulatory counsel" />
            </div>
          </Panel>
          <Panel title="Response Forecast — Post May 25" meta={<Badge>Projected</Badge>}>
            <table>
              <thead><tr><th>Supplier</th><th>Prob.</th><th>Est. Response</th><th>Exp. Price</th><th>vs Est.</th></tr></thead>
              <tbody>
                {[['Baker Hughes','92%','Jun 6','$495K','+15%'],['Emerson','85%','Jun 12','$700K','at est.'],['Donaldson (×2)','88%','Jun 9','$1.03M','at est.'],['GE Vernova','80%','Jul 1','~$2.1M','+5–18%'],['Siemens Energy','72%','Jul 8','~$2.1M','+5–18%'],['ABB Power','75%','Jul 10','~$760K','+10–15%']].map(([sup,p,r,ep,v],i) => (
                  <tr key={i}><td>{sup}</td><td className="font-mono">{p}</td><td className="text-[--t2]">{r}</td><td className="font-mono">{ep}</td><td style={{ color: v.includes('+') ? 'var(--red)' : 'var(--t2)' }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <TierLabel>Tier 3 — Full Pipeline Detail</TierLabel>
        <Panel
          title="13-Package RFQ Pipeline"
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="verified">1 Responded</Badge>
              <Badge>12 Drafted</Badge>
              <button onClick={exportCSV} className="font-mono text-[9px] px-3 py-1 transition-colors" style={{ background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--t2)' }}>
                ↓ CSV
              </button>
            </div>
          }
        >
          <TableFilter
            placeholder="Search RFQs…"
            onSearch={setSearch}
            onFilter={(_, v) => setStatusF(v)}
            filters={[{ label: 'Status', options: [
              { label: 'Responded', value: 'RESPONDED' },
              { label: 'Drafted', value: 'DRAFTED' },
              { label: 'Blocked', value: 'BLOCKED' },
            ]}]}
            count={filtered.length}
            total={items.length}
          />
          <table>
            <thead>
              <tr><th>ID</th><th>Supplier</th><th>Contact</th><th>Category</th><th>Lead Time</th><th className="text-right">Est. Value</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedRFQ(r)}
                  className="cursor-pointer"
                  style={criticalCodes.has(r.category_code) ? { background: 'rgba(204,32,32,0.04)' } : {}}
                >
                  <td className="font-mono text-[--t2] text-[10px]">{r.id}</td>
                  <td className="font-semibold">{r.company}</td>
                  <td>{r.contact}</td>
                  <td>{r.category}</td>
                  <td className="text-[--t2] text-[10px]">{r.notes?.includes('wk') ? r.notes.match(/\d+–\d+ wk/)?.[0] : '—'}</td>
                  <td className="font-mono text-right">{fmtCurrency(r.est_value_usd)}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td className="text-[--t2] text-[10px] max-w-[160px] truncate">{r.notes}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--bg2)' }}>
                <td colSpan={5} className="font-mono text-[10px] font-semibold text-[--t2]">TOTAL PIPELINE</td>
                <td className="font-mono text-right font-light text-[13px]">{fmtCurrency(pipelineV)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>RFQ Pipeline · FlowSeer v2.1.0 · 13 packages · $9,898,000 total</span>
          <span>Click any row to view full RFQ detail</span>
        </div>
      </div>

      <RFQDrawer rfq={selectedRFQ} onClose={() => setSelectedRFQ(null)} />
    </>
  );
}
