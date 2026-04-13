'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchPricingData, fmtCurrency } from '../../../lib/api/flowseer';
import { KPI }             from '../../../components/ui/KPI';
import { Badge }           from '../../../components/ui/Badge';
import { Panel }           from '../../../components/ui/Panel';
import { TierLabel }       from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';
import { clsx }            from 'clsx';
import type { PricingCategory } from '../../../lib/types/flowseer';

const SCENARIOS = [
  { label: 'Aggressive (negotiated)',  total: 8_854_055, delta: -4.5, cls: 'bg-[--bg3] text-[--t1]', w: '85.4' },
  { label: 'Optimistic (competitive)', total: 9_135_385, delta: -1.5, cls: 'bg-[--bg3] text-[--t1]', w: '88.1' },
  { label: 'Base (BOM estimates)',     total: 9_274_000, delta:  0.0, cls: 'bg-[--bg3] text-[--t1]', w: '89.5' },
  { label: 'Conservative (overruns)', total:10_077_458, delta: +8.7, cls: 'bg-[--red-bg] text-[--red]', w: '97.3' },
];

export default function CostIntelPage() {
  const { data: pricing } = useQuery({
    queryKey: ['pricing'], queryFn: fetchPricingData, refetchInterval: 60_000,
  });

  const cats     = pricing?.categories ?? [];
  const totalMid = pricing?.total_mid  ?? 9_274_000;
  const verified = pricing?.verified   ?? 1;
  const estimated= pricing?.estimated  ?? 18;

  return (
    <>
      <ConditionBanner
        state="warning"
        tag="⚠ Estimated"
        items={[
          { label: 'Baseline:',      value: `$${(totalMid/1e6).toFixed(2)}M · 19 categories · BOM build-up` },
          { label: 'Confidence:',    value: `${verified}/19 RFQ-Verified · ${estimated}/19 Estimated` },
          { label: 'Market Signal:', value: '$185/kW vs market $186–$200/kW · recommend 8–12% contingency' },
        ]}
      />

      <div className="p-6 max-w-[1400px]">
        <TierLabel>Tier 1 — Cost Position</TierLabel>
        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI label="BOP Baseline Mid"     value={fmtCurrency(totalMid)}   sub="19 categories · 50MW TG20/W251"           badge={<Badge variant="estimated">Estimated</Badge>} />
          <KPI label="Conservative Scenario" value="$10.08M"                sub="+8.7% · Historical overrun factors"         accent="critical" badge={<Badge variant="warning">Risk</Badge>} />
          <KPI label="Optimistic Scenario"  value="$9.14M"                  sub="–1.5% · Competitive bidding"                />
          <KPI label="Market Benchmark"     value="$185/kW"                 sub="Market: $186–$200/kW · Monitor"            badge={<Badge>Benchmark</Badge>} />
          <KPI label="RFQ-Verified"         value={`${verified} / 19`}      sub="VIB_MON · $340K · BH · +26.7%"             badge={<Badge variant="verified">Verified</Badge>} />
          <KPI label="Recommended Budget"   value="$10.4M"                  sub="With 12% contingency buffer"                badge={<Badge>Advisory</Badge>} />
        </div>

        <TierLabel>Tier 2 — Decision Insights</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">

          {/* Scenario modeler */}
          <Panel title="Award Scenario Modeling" meta={<Badge>4 Scenarios</Badge>}>
            <div className="px-3 py-2 bg-[--bg2] border-l-2 border-[--t3] mb-4 text-[10px] text-[--t2]">
              <span className="inline-flex items-center gap-1 mr-2"><Badge variant="verified" className="text-[8px]">Confirmed</Badge></span>
              BH VIB_MON $340K applied in all scenarios · 18 categories at BOM estimate
            </div>
            <div className="flex flex-col gap-3">
              {SCENARIOS.map((s) => (
                <div key={s.label} className="grid grid-cols-[180px_1fr_90px] items-center gap-3">
                  <span className="text-[11px] text-[--t2]">{s.label}</span>
                  <div className="h-[26px] bg-[--bg2] overflow-hidden">
                    <div className={clsx('h-full flex items-center px-3 font-mono text-[11px]', s.cls)}
                         style={{ width: `${s.w}%` }}>
                      {fmtCurrency(s.total, 0)}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-right"
                        style={{ color: s.delta > 0 ? 'var(--red)' : 'var(--t2)' }}>
                    {s.delta > 0 ? '+' : ''}{s.delta}%
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 px-3 py-2 bg-[--bg2] text-[10px] text-[--t2] leading-[1.6]">
              Recommended budget authority: <strong style={{ color: 'var(--amb)' }}>$10.0M – $10.4M</strong> (8–12% contingency).
              Conservative scenario driven by Generator (+18%) and Transformer (+15%) historical premiums.
            </div>
          </Panel>

          {/* Spend concentration */}
          <Panel title="Spend Concentration Risk" meta={<Badge variant="warning">Top 5 = 53.7%</Badge>}>
            <div className="text-[10px] text-[--t2] mb-4 leading-[1.6]">
              GE Vernova single-supplier exposure = <strong style={{ color: 'var(--amb)' }}>22.6%</strong> ($2.09M).
              Mitigated by competitive bid against Siemens Energy.
            </div>
            <div className="flex flex-col gap-2">
              {[
                { label: 'GE Vernova',      pct: 22.6, w: 100 },
                { label: 'CECO Environ.',   pct: 17.5, w: 77  },
                { label: 'Emerson',         pct: 13.0, w: 58  },
                { label: 'ABB Power',       pct:  8.2, w: 36  },
                { label: 'Donaldson (2×)',  pct: 11.1, w: 49  },
                { label: 'Flowserve',       pct:  5.5, w: 24  },
                { label: 'All Others (5)',  pct: 22.1, w: 28  },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3">
                  <span className="text-[10px] text-[--t1] w-[100px] flex-shrink-0 truncate">{r.label}</span>
                  <div className="flex-1 h-[12px] bg-[--bg2]">
                    <div className="h-full bg-[--t2]" style={{ width: `${r.w}%` }} />
                  </div>
                  <span className="font-mono text-[10px] text-[--t2] w-9 text-right">{r.pct}%</span>
                </div>
              ))}
            </div>
            <div className="mt-4 px-3 py-2 bg-[--amb-bg] border border-[--amb-bd] text-[10px] text-[--t2]">
              ⚠ Trillium Flow Technologies: <strong style={{ color: '#E8C080' }}>AVOID</strong> — Resolved.
              Flowserve selected for $507K Piping & Valves scope.
            </div>
          </Panel>
        </div>

        {/* Tier 3: Full matrix */}
        <TierLabel>Tier 3 — Full 19-Category Pricing Matrix</TierLabel>
        <Panel
          title="BOP Category Breakdown — All 19 Categories"
          meta={<><Badge variant="verified">1 Verified</Badge><Badge variant="estimated">18 Estimated</Badge></>}
        >
          <table>
            <thead>
              <tr>
                <th>#</th><th>Category</th><th>Code</th><th>Tier</th>
                <th className="text-right">Low</th><th className="text-right">Mid Est.</th>
                <th className="text-right">High</th><th className="text-right">RFQ Quoted</th>
                <th>Variance</th><th>Preferred Supplier</th><th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {cats.filter((r: PricingCategory) => r.category !== 'TOTAL').map((r: PricingCategory, i: number) => {
                const isVerif = r.confidence === 'RFQ_VERIFIED';
                return (
                  <tr key={i} style={isVerif ? { background: 'rgba(30,111,204,0.04)' } : {}}>
                    <td className="font-mono text-[--t2] text-[10px]">{i+1}</td>
                    <td>{r.category}</td>
                    <td className="font-mono text-[--t2] text-[10px]">{r.category_code}</td>
                    <td>
                      <span className="font-mono text-[8px] tracking-wide uppercase text-[--t2]">{r.spend_tier}</span>
                    </td>
                    <td className="font-mono text-right text-[--t2]">{fmtCurrency(r.bom_low, 0)}</td>
                    <td className="font-mono text-right font-medium">{fmtCurrency(r.bom_mid, 0)}</td>
                    <td className="font-mono text-right text-[--t2]">{fmtCurrency(r.bom_high, 0)}</td>
                    <td className="font-mono text-right">{r.rfq_quoted ? fmtCurrency(r.rfq_quoted, 0) : '—'}</td>
                    <td className="font-mono" style={{ color: r.rfq_variance_pct ? 'var(--red)' : 'var(--t2)' }}>
                      {r.rfq_variance_pct ? `+${r.rfq_variance_pct}%` : '—'}
                    </td>
                    <td className="text-[--t2] text-[10px]">{r.preferred_supplier}</td>
                    <td>
                      <Badge variant={isVerif ? 'verified' : 'estimated'}>
                        {isVerif ? 'Verified' : 'Estimated'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--bg2)', fontWeight: 600 }}>
                <td colSpan={5} className="font-mono text-[11px] text-[--t2] uppercase tracking-wider">
                  Total BOP Baseline (19 Categories)
                </td>
                <td className="font-mono text-right text-[13px]" style={{ color: 'var(--amb)' }}>
                  {fmtCurrency(totalMid, 0)}
                </td>
                <td colSpan={5}></td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>Cost Intelligence · FlowSeer v2.1.0 · BOM build-up · ENR CCI normalized 2024 USD</span>
          <span>18 categories carry ESTIMATED confidence — upgrades to VERIFIED as responses arrive</span>
        </div>
      </div>
    </>
  );
}
