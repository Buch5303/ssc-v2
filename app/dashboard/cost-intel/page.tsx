'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPricingData, fmtCurrency } from '../../../lib/api/flowseer';
import { KPI }              from '../../../components/ui/KPI';
import { Badge }            from '../../../components/ui/Badge';
import { Panel }            from '../../../components/ui/Panel';
import { TierLabel }        from '../../../components/ui/TierLabel';
import { ConditionBanner }  from '../../../components/ui/ConditionBanner';
import { TableFilter }      from '../../../components/ui/TableFilter';
import { CategoryDrawer }   from '../../../components/cost/CategoryDrawer';
import { clsx }             from 'clsx';
import type { PricingCategory } from '../../../lib/types/flowseer';

const SCENARIOS = [
  { label: 'Aggressive (negotiated)',  total: 8_854_055, delta: -4.5, cls: 'bg-[--bg3] text-[--t1]', w: '85.4' },
  { label: 'Optimistic (competitive)', total: 9_135_385, delta: -1.5, cls: 'bg-[--bg3] text-[--t1]', w: '88.1' },
  { label: 'Base (BOM estimates)',     total: 9_274_000, delta:  0.0, cls: 'bg-[--bg3] text-[--t1]', w: '89.5' },
  { label: 'Conservative (overruns)', total:10_077_458, delta: +8.7, cls: 'bg-[--red-bg] text-[--red]', w: '97.3' },
];

export default function CostIntelPage() {
  const { data: pricing } = useQuery({ queryKey: ['pricing'], queryFn: fetchPricingData, refetchInterval: 60_000 });

  const [search, setSearch]       = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [confFilter, setConfFilter] = useState('');
  const [selectedCat, setSelectedCat] = useState<PricingCategory | null>(null);

  const cats      = pricing?.categories ?? [];
  const totalMid  = pricing?.total_mid  ?? 9_274_000;
  const verified  = pricing?.verified   ?? 1;
  const estimated = pricing?.estimated  ?? 18;

  const filtered = useMemo(() => cats.filter(c => {
    const q = search.toLowerCase();
    const mQ = !q || c.category.toLowerCase().includes(q) || c.category_code.toLowerCase().includes(q) || c.preferred_supplier.toLowerCase().includes(q);
    const mT = !tierFilter || c.spend_tier === tierFilter;
    const mC = !confFilter || c.confidence === confFilter;
    return mQ && mT && mC;
  }), [cats, search, tierFilter, confFilter]);

  const exportCSV = () => {
    const rows = [['Category','Code','Tier','Low','Mid','High','Quoted','Variance','Supplier','Confidence']];
    cats.forEach(c => rows.push([c.category, c.category_code, c.spend_tier, fmtCurrency(c.bom_low), fmtCurrency(c.bom_mid), fmtCurrency(c.bom_high), c.rfq_quoted ? fmtCurrency(c.rfq_quoted) : '—', c.rfq_variance_pct != null ? `${c.rfq_variance_pct > 0 ? '+' : ''}${c.rfq_variance_pct.toFixed(1)}%` : '—', c.preferred_supplier, c.confidence]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv])); a.download = 'flowseer_cost_intel.csv'; a.click();
  };

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
          <KPI label="BOP Baseline Mid"       value={fmtCurrency(totalMid)}   sub="19 categories · 50MW TG20/W251"           badge={<Badge variant="estimated">Estimated</Badge>} />
          <KPI label="Conservative Scenario"  value="$10.08M"                sub="+8.7% · Historical overrun factors"         accent="critical" badge={<Badge variant="warning">Risk</Badge>} />
          <KPI label="Optimistic Scenario"    value="$9.14M"                 sub="–1.5% · Competitive bidding"                />
          <KPI label="Market Benchmark"       value="$185/kW"                sub="Market: $186–$200/kW · Monitor"            badge={<Badge>Benchmark</Badge>} />
          <KPI label="RFQ-Verified"           value={`${verified} / 19`}     sub="VIB_MON · $340K · BH · +26.7%"             badge={<Badge variant="verified">Verified</Badge>} />
          <KPI label="Recommended Budget"     value="$10.4M"                 sub="With 12% contingency buffer"                badge={<Badge>Advisory</Badge>} />
        </div>

        <TierLabel>Tier 2 — Decision Insights</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Panel title="Award Scenario Modeling" meta={<Badge>4 Scenarios</Badge>}>
            <div className="px-3 py-2 bg-[--bg2] border-l-2 border-[--t3] mb-4 text-[10px] text-[--t2]">
              <span className="inline-flex items-center gap-1 mr-2"><Badge variant="verified" className="text-[8px]">Confirmed</Badge></span>
              BH VIB_MON $340K applied in all scenarios · 18 categories at BOM estimate
            </div>
            <div className="flex flex-col gap-3">
              {SCENARIOS.map((s, i) => (
                <div key={i} className="grid items-center gap-3" style={{ gridTemplateColumns: '180px 1fr 90px' }}>
                  <span className="text-[11px] text-[--t2]">{s.label}</span>
                  <div className="h-[26px] bg-[--bg2] relative overflow-hidden rounded-sm">
                    <div className={clsx('h-full flex items-center px-3 font-mono text-[11px] transition-all duration-1000', s.cls)} style={{ width: `${s.w}%` }}>
                      {fmtCurrency(s.total)}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-right" style={{ color: s.delta > 0 ? 'var(--red)' : 'var(--t2)' }}>
                    {s.delta === 0 ? 'baseline' : `${s.delta > 0 ? '+' : ''}${s.delta}%`}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-[--bg2] text-[10px] text-[--t2] leading-relaxed">
              Recommended budget authority: <strong style={{ color: 'var(--amb)' }}>$10.0M – $10.4M</strong> (8–12% contingency). Conservative scenario driven by Generator (+18%) and Transformer (+15%) historical premiums.
            </div>
          </Panel>

          <Panel title="Spend Concentration Risk" meta={<Badge variant="warning">Top 5 = 53.7%</Badge>}>
            <div className="text-[10px] text-[--t2] mb-3 leading-relaxed">
              GE Vernova single-supplier exposure = <strong style={{ color: 'var(--amb)' }}>22.6%</strong> ($2.09M). Mitigated by competitive bid vs Siemens. Donaldson bundle: Inlet Air + Controls = $1.03M.
            </div>
            {[['GE Vernova','22.6%',100],['CECO Environ.','17.5%',77],['Emerson','13.0%',58],['ABB Power','8.2%',36],['Donaldson (2×)','11.1%',49],['Flowserve','5.5%',24],['All Others (5)','22.1%',28]].map(([name, pct, w], i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-[--t1] w-[110px] flex-shrink-0 truncate">{name}</span>
                <div className="flex-1 h-[10px] bg-[--bg2]">
                  <div className="h-full transition-all duration-1000" style={{ width: `${w}%`, background: 'var(--t2)' }} />
                </div>
                <span className="font-mono text-[10px] text-[--t2] w-[36px] text-right">{pct}</span>
              </div>
            ))}
            <div className="mt-3 px-3 py-2 text-[10px]" style={{ background: 'rgba(200,120,0,0.06)', border: '1px solid rgba(200,120,0,0.16)' }}>
              ⚠ Trillium: <strong style={{ color: 'var(--amb)' }}>AVOID resolved</strong> → Flowserve $507K
            </div>
          </Panel>
        </div>

        <TierLabel>Tier 3 — Full 19-Category Pricing Matrix</TierLabel>
        <Panel
          title="BOP Category Breakdown — All 19 Categories"
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="verified">1 Verified</Badge>
              <Badge variant="estimated">18 Estimated</Badge>
              <button onClick={exportCSV} className="font-mono text-[9px] px-3 py-1" style={{ background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--t2)' }}>↓ CSV</button>
            </div>
          }
        >
          <TableFilter
            placeholder="Search categories…"
            onSearch={setSearch}
            onFilter={(key, val) => { if (key === 'Tier') setTierFilter(val); else setConfFilter(val); }}
            filters={[
              { label: 'Tier', options: [{ label: 'Strategic', value: 'STRATEGIC' }, { label: 'Targeted', value: 'TARGETED' }, { label: 'Standard', value: 'STANDARD' }] },
              { label: 'Conf', options: [{ label: 'Verified', value: 'RFQ_VERIFIED' }, { label: 'Estimated', value: 'COMPONENT_BUILDUPS' }, { label: 'Market', value: 'MARKET_ANCHOR' }] },
            ]}
            count={filtered.length}
            total={cats.length}
          />
          <table>
            <thead>
              <tr><th>#</th><th>Category</th><th>Code</th><th>Tier</th><th>Low</th><th>Mid Est.</th><th>High</th><th>RFQ Quoted</th><th>Variance</th><th>Preferred Supplier</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const isV = c.confidence === 'RFQ_VERIFIED';
                return (
                  <tr
                    key={i}
                    onClick={() => setSelectedCat(c)}
                    className="cursor-pointer"
                    style={isV ? { background: 'rgba(16,185,129,0.04)' } : {}}
                  >
                    <td className="font-mono text-[--t3] text-[10px]">{i + 1}</td>
                    <td className="font-medium">{c.category}</td>
                    <td className="font-mono text-[--t3] text-[10px]">{c.category_code}</td>
                    <td><Badge className="text-[8px]">{c.spend_tier === 'STRATEGIC' ? 'Strategic' : c.spend_tier === 'TARGETED' ? 'Targeted' : 'Standard'}</Badge></td>
                    <td className="font-mono text-[--t2] text-[10px]">{fmtCurrency(c.bom_low)}</td>
                    <td className="font-mono font-medium">{fmtCurrency(c.bom_mid)}</td>
                    <td className="font-mono text-[--t2] text-[10px]">{fmtCurrency(c.bom_high)}</td>
                    <td className="font-mono">{c.rfq_quoted ? fmtCurrency(c.rfq_quoted) : '—'}</td>
                    <td style={{ color: c.rfq_variance_pct != null && c.rfq_variance_pct > 0 ? 'var(--red)' : 'var(--t2)' }}>
                      {c.rfq_variance_pct != null ? `${c.rfq_variance_pct > 0 ? '+' : ''}${c.rfq_variance_pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="text-[--t2] text-[10px]">{c.preferred_supplier}</td>
                    <td>{isV ? <Badge variant="verified">Verified</Badge> : <Badge variant="estimated">Estimated</Badge>}</td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--bg2)' }}>
                <td colSpan={4} className="font-mono text-[10px] font-semibold text-[--t2]">TOTAL BOP BASELINE</td>
                <td colSpan={2} className="font-mono text-[13px] font-light" style={{ color: 'var(--amb)' }}>{fmtCurrency(totalMid)}</td>
                <td colSpan={5} />
              </tr>
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>Cost Intelligence · FlowSeer v2.1.0 · BOM build-up · ENR CCI normalized 2024 USD</span>
          <span>Click any category to view full pricing breakdown and market intelligence</span>
        </div>
      </div>

      <CategoryDrawer category={selectedCat} onClose={() => setSelectedCat(null)} />
    </>
  );
}
