'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchRFQPipeline, fetchProgramSummary, daysToSend, fmtCurrency } from '../../../lib/api/flowseer';
import { KPI }             from '../../../components/ui/KPI';
import { Badge }           from '../../../components/ui/Badge';
import { Panel }           from '../../../components/ui/Panel';
import { AlertCard }       from '../../../components/ui/AlertCard';
import { TierLabel }       from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';
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

  const days      = summary?.days_to_rfq_send ?? daysToSend();
  const items     = rfqs?.rfqs               ?? [];
  const responded = rfqs?.responded          ?? 1;
  const drafted   = rfqs?.drafted            ?? 12;
  const total     = rfqs?.total              ?? 13;
  const pipelineV = rfqs?.pipeline_value     ?? 9_898_000;

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
          { label: 'Stage:',      value: `1 Responded · ${drafted} Drafted · 0 Sent · 0 Awarded` },
          { label: 'Blocked:',    value: '$1.725M pending EthosEnergy ICD' },
          { label: 'Send Date:',  value: `May 25, 2026 — ${days} days`, isAction: true },
        ]}
      />

      <div className="p-6 max-w-[1400px]">

        {/* Stage Flow */}
        <TierLabel>Tier 1 — Pipeline Status</TierLabel>
        <div className="flex border border-[--line] mb-6">
          {stages.map((s, i) => (
            <div key={i} className={clsx(
              'flex-1 px-4 py-4 border-r border-[--line] last:border-r-0 relative',
              s.active && 'bg-[--bg2]',
            )}>
              <div className={clsx(
                'font-mono text-[9px] tracking-[2px] uppercase mb-2',
                s.active ? 'text-[--brand-blue2]' : 'text-[--t3]',
              )}>{s.label}</div>
              <div className={clsx(
                'font-mono text-[28px] font-light leading-none',
                s.active ? 'text-[--t0]' : 'text-[--t2]',
                s.label === 'Responded' && responded > 0 && 'text-[--t0]',
              )}>{s.count}</div>
              <div className="text-[10px] text-[--t2] mt-1">{s.sub}</div>
              {i < stages.length - 1 && (
                <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] bg-[--bg0] border border-[--line] rounded-full flex items-center justify-center z-10">
                  <span className="text-[7px] text-[--t3]">›</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI label="Total Pipeline"     value={fmtCurrency(pipelineV)}   sub={`${total} packages · 11 suppliers`} />
          <KPI label="Days to Send"       value={days}                      sub="May 25, 2026 — FIXED"               accent="warning" />
          <KPI label="Responses Received" value={`${responded} / ${total}`} sub="Baker Hughes $340K · +26.7%"        badge={<Badge variant="verified">Live</Badge>} />
          <KPI label="Blocked Value"      value="$1.73M"                    sub="Transformer + Exhaust + Electrical"  accent="critical" badge={<Badge variant="critical">ICD Req'd</Badge>} />
          <KPI label="Critical Path RFQs" value="2"                         sub="Generator 40–56wk · Transformer 52–70wk" />
          <KPI label="Pre-Send Gates"     value="7 / 10"                    sub="3 manual gates need human action" />
        </div>

        {/* Tier 2 */}
        <TierLabel>Tier 2 — Bottlenecks & Decisions</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Panel title="Pre-Send Gate Checks" meta={<Badge variant="warning">3 Pending</Badge>}>
            <div className="flex flex-col gap-2">
              <AlertCard severity="critical" title="G03 — EthosEnergy ICD not received" detail="Blocks 3 RFQs: Transformer (voltage/MVA spec), Exhaust (flange dims), Electrical Distribution. Cannot finalize without it." action="→ tools/flowseer.py icd escalate" />
              <AlertCard severity="warning" title="G02 — Baker Hughes $340K decision pending" detail="Accept ($340K), negotiate (target ~$310K), or rebid. Quote within market range. PO template generated." action="→ tools/contracts/drafts/TWP-2026-0001_VIB_MON_Baker_Hughes.txt" />
              <AlertCard severity="warning" title="G07 — NM Environmental Permit Scope (CECO Emissions $892K)" detail="NOx/CO limits need NM Environment Dept confirmation before CECO RFQ can be fully specified." action="→ Confirm permit limits with NM EPC / regulatory counsel" />
            </div>
          </Panel>

          <Panel title="Response Forecast — Post May 25" meta={<Badge>Projected</Badge>}>
            <table>
              <thead>
                <tr><th>Supplier</th><th>Prob.</th><th>Est. Response</th><th>Exp. Price</th><th>vs Est.</th></tr>
              </thead>
              <tbody>
                {[
                  ['Baker Hughes', '92%', 'Jun 6',  '$495K', '+15%', true],
                  ['Emerson',      '85%', 'Jun 12', '$700K', 'at est.', false],
                  ['Donaldson ×2', '88%', 'Jun 9',  '$1.03M','at est.', false],
                  ['GE Vernova',   '80%', 'Jul 1',  '~$2.1M','+5–18%', true],
                  ['Siemens Energy','72%','Jul 8',  '~$2.1M','+5–18%', true],
                  ['ABB Power',    '75%', 'Jul 10', '~$760K','+10–15%',true],
                  ['Amerex / Turbotect','80%','Jun 15','$340K','–8–0%',false],
                ].map(([sup,prob,date,price,vs,abv],i) => (
                  <tr key={i}>
                    <td>{sup}</td>
                    <td className="font-mono">{prob}</td>
                    <td className="text-[--t2]">{date}</td>
                    <td className="font-mono">{price}</td>
                    <td className="font-mono" style={{ color: abv ? 'var(--red)' : 'var(--t2)' }}>{vs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Tier 3: Full pipeline */}
        <TierLabel>Tier 3 — Full Pipeline Detail</TierLabel>
        <Panel
          title="13-Package RFQ Pipeline"
          meta={<><Badge variant="verified">1 Responded</Badge><Badge>12 Drafted</Badge></>}
        >
          <table>
            <thead>
              <tr><th>ID</th><th>Supplier</th><th>Contact</th><th>Category</th><th>Lead Time</th><th className="text-right">Est. Value</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {items.map((r: RFQ, i: number) => {
                const isCrit = criticalCodes.has(r.category_code);
                return (
                  <tr key={i} style={isCrit ? { background: 'rgba(204,32,32,0.04)' } : {}}>
                    <td className="font-mono text-[--t2] text-[10px]">{r.id}</td>
                    <td className={isCrit ? 'font-semibold' : ''}>{r.company}</td>
                    <td className="text-[--t2]">{r.contact}</td>
                    <td>{r.category}</td>
                    <td className={clsx('font-mono text-[10px]', isCrit && 'text-[--red]')}>
                      {r.category_code === 'TRANSFORMER' ? '52–70 wk ⚠' :
                       r.category_code === 'GENERATOR'   ? '40–56 wk ⚠' :
                       r.category_code === 'EMISSIONS'   ? '24–36 wk' :
                       r.category_code === 'FUEL_GAS'    ? '16–24 wk' :
                       r.category_code === 'INLET_AIR'   ? '14–20 wk' :
                       '10–20 wk'}
                    </td>
                    <td className="font-mono text-right">{fmtCurrency(r.quoted_price ?? r.est_value_usd, 0)}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="text-[10px] text-[--t2] max-w-[180px] truncate">{r.notes}</td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--bg2)', fontWeight: 600 }}>
                <td colSpan={5} className="text-[11px] text-[--t2] uppercase tracking-wider font-mono">Total Pipeline Value</td>
                <td className="font-mono text-right text-[13px] text-[--t0]">{fmtCurrency(pipelineV, 0)}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>RFQ Pipeline · FlowSeer v2.1.0 · {total} packages · {fmtCurrency(pipelineV, 0)} total</span>
          <span>Ingest responses: tools/rfq-generator/log_response.py · Send plan: tools/scheduling/rfq_send_plan.md</span>
        </div>
      </div>
    </>
  );
}
