'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchPricingData, fmtCurrency } from '../../../lib/api/flowseer';
import { KPI }        from '../../../components/ui/KPI';
import { Badge }      from '../../../components/ui/Badge';
import { Panel }      from '../../../components/ui/Panel';
import { TierLabel }  from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';

const LEAD_TIMES = [
  { cat: 'Generator + Switchgear',      code: 'GENERATOR',    val: 2093850, low: 40, high: 56, risk: 'CRITICAL' },
  { cat: 'Step-up Transformer (GSU)',   code: 'TRANSFORMER',  val: 760000,  low: 52, high: 70, risk: 'CRITICAL' },
  { cat: 'Emissions Control (SCR)',     code: 'EMISSIONS',    val: 891750,  low: 24, high: 36, risk: 'HIGH' },
  { cat: 'Controls / DCS',             code: 'CONTROLS_DCS', val: 504600,  low: 20, high: 28, risk: 'HIGH' },
  { cat: 'Exhaust System',             code: 'EXHAUST',       val: 430650,  low: 20, high: 28, risk: 'HIGH' },
  { cat: 'Electrical Distribution',    code: 'ELEC_DIST',     val: 535050,  low: 20, high: 30, risk: 'MEDIUM' },
  { cat: 'Inlet Air Filtering',        code: 'INLET_AIR',     val: 525150,  low: 14, high: 20, risk: 'MEDIUM' },
  { cat: 'Fuel Gas System',            code: 'FUEL_GAS',      val: 700600,  low: 16, high: 24, risk: 'MEDIUM' },
  { cat: 'Lube Oil System',            code: 'LUBE_OIL',      val: 288900,  low: 12, high: 18, risk: 'MEDIUM' },
  { cat: 'Acoustic Enclosure',         code: 'ACOUSTIC',      val: 305100,  low: 18, high: 26, risk: 'MEDIUM' },
  { cat: 'Piping & Valves',            code: 'PIPING_VALVES', val: 507600,  low: 10, high: 16, risk: 'LOW' },
  { cat: 'Fire Fighting System',       code: 'FIRE_FIGHT',    val: 229400,  low: 10, high: 16, risk: 'LOW' },
  { cat: 'Vibration Monitoring',       code: 'VIB_MON',       val: 268250,  low: 8,  high: 14, risk: 'LOW' },
  { cat: 'Compressor Washing',         code: 'WATER_WASH',    val: 132300,  low: 8,  high: 12, risk: 'LOW' },
];

const AWARD_DATE = new Date('2026-08-15');
function deliveryWindow(lowWk: number, highWk: number) {
  const lo = new Date(AWARD_DATE); lo.setDate(lo.getDate() + lowWk * 7);
  const hi = new Date(AWARD_DATE); hi.setDate(hi.getDate() + highWk * 7);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return `${fmt(lo)} – ${fmt(hi)}`;
}

const riskColor: Record<string, string> = {
  CRITICAL: 'var(--red)', HIGH: 'var(--amb)', MEDIUM: 'var(--t1)', LOW: 'var(--t2)',
};

export default function AnalyticsPage() {
  const { data: pricing } = useQuery({
    queryKey: ['pricing'], queryFn: fetchPricingData, refetchInterval: 60_000,
  });

  const cats     = pricing?.categories ?? [];
  const totalMid = pricing?.total_mid  ?? 9_274_000;

  // Pareto data
  const sorted  = [...cats].sort((a, b) => (b.bom_mid ?? 0) - (a.bom_mid ?? 0));
  const top5Val = sorted.slice(0, 5).reduce((s, r) => s + (r.bom_mid ?? 0), 0);
  const top5Pct = totalMid > 0 ? (top5Val / totalMid * 100).toFixed(1) : '0';

  return (
    <>
      <ConditionBanner state="mono" tag="Analytics"
        items={[
          { label: 'Spend:',    value: `$${(totalMid/1e6).toFixed(2)}M BOP · Top 5 categories = ${top5Pct}% of total` },
          { label: 'Critical:', value: 'Generator (Oct 2027 delivery if Aug 15 award) — true critical path' },
          { label: 'Action:',   value: 'Award Generator + Transformer by Aug 15 to protect Q2 2027 First Power', isAction: true },
        ]}
      />

      <div className="p-6 max-w-[1400px]">
        <TierLabel>Tier 1 — Spend Summary</TierLabel>
        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI label="Total BOP Mid"      value={fmtCurrency(totalMid)}   sub="19 categories · 50MW W251B8" />
          <KPI label="Strategic Spend"    value="$6.52M"                  sub="8 categories · 70.3% of BOP" />
          <KPI label="Top 5 Concentration" value={`${top5Pct}%`}          sub="of total BOP in 5 categories" accent="warning" />
          <KPI label="GE Vernova Exposure" value="22.6%"                  sub="$2.09M — largest single supplier" accent="warning" />
          <KPI label="Contingency Rec."   value="8–12%"                   sub="Recommended budget buffer" />
          <KPI label="Budget w/ Contingency" value="$10.4M"               sub="$10.0M – $10.4M range" />
        </div>

        <TierLabel>Tier 2 — Pareto & Lead Time Risk</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">

          <Panel title="Spend Pareto — Top Categories" meta={<Badge>19 total</Badge>}>
            <div className="flex flex-col gap-[6px]">
              {sorted.slice(0, 10).map((r, i) => {
                const mid = r.bom_mid ?? 0;
                const pct = totalMid > 0 ? (mid / totalMid * 100) : 0;
                const barW = Math.round(pct / 23 * 100); // scale to max
                return (
                  <div key={i} className="grid grid-cols-[160px_1fr_70px] items-center gap-3">
                    <span className="text-[10px] text-[--t1] truncate">{r.category?.replace(' (BOP interconnect)','').replace(' (Auxiliary)','')}</span>
                    <div className="h-[5px] bg-[--bg3]">
                      <div className="h-full bg-[--t2]" style={{ width: `${barW}%`, transition: 'width 1.2s cubic-bezier(.16,1,.3,1)' }} />
                    </div>
                    <span className="font-mono text-[10px] text-[--t2] text-right">{fmtCurrency(mid, 0)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 px-3 py-2 bg-[--bg2] text-[10px] text-[--t2]">
              Top 5 = <strong style={{color:'var(--amb)'}}>{top5Pct}%</strong> of BOP.
              GE Vernova at 22.6% — mitigated by competitive bid vs Siemens Energy.
            </div>
          </Panel>

          <Panel title="Lead Time Risk Matrix" meta={<Badge variant="critical">2 Critical</Badge>}>
            <table>
              <thead><tr><th>Category</th><th>Lead Time</th><th>Delivery (if Aug 15 award)</th><th>Risk</th></tr></thead>
              <tbody>
                {LEAD_TIMES.map((r, i) => (
                  <tr key={i} style={r.risk === 'CRITICAL' ? { background: 'rgba(204,32,32,.04)' } : {}}>
                    <td className="text-[10px]">{r.cat}</td>
                    <td className="font-mono text-[10px]"
                        style={{ color: r.risk === 'CRITICAL' ? 'var(--red)' : r.risk === 'HIGH' ? 'var(--amb)' : 'var(--t2)' }}>
                      {r.low}–{r.high} wk{r.risk === 'CRITICAL' ? ' ⚠' : ''}
                    </td>
                    <td className="font-mono text-[10px] text-[--t2]">{deliveryWindow(r.low, r.high)}</td>
                    <td>
                      <span className="font-mono text-[9px]" style={{ color: riskColor[r.risk] }}>{r.risk}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <TierLabel>Tier 3 — Award Schedule Recommendation</TierLabel>
        <Panel title="Award Sequence — Project Jupiter Q2 2027 First Power">
          <table>
            <thead><tr><th>Priority</th><th>Category</th><th>Supplier</th><th>Target Award</th><th>Lead Time</th><th>Delivery</th><th>Risk if Late</th></tr></thead>
            <tbody>
              {[
                [1,'Generator + Switchgear','GE Vernova / Siemens','Aug 1 (before Aug 15)','40–56 wk','Oct 2026–Jan 2027','Q2 2027 First Power at risk'],
                [2,'Step-up Transformer','ABB Power / Siemens','Aug 1 (before Aug 15)','52–70 wk','Feb–May 2027','Schedule slip'],
                [3,'Emissions Control SCR','CECO Environmental','Aug 15','24–36 wk','Feb–May 2027','Manageable'],
                [4,'All others (10 categories)','Various','Aug 15','8–30 wk','Dec 2026–Apr 2027','All deliver before Q2 2027'],
              ].map(([pri, cat, sup, date, lead, del, risk], i) => (
                <tr key={i} style={i < 2 ? { background: 'rgba(204,32,32,.04)' } : {}}>
                  <td className="font-mono text-[--t2]">{pri}</td>
                  <td className={i < 2 ? 'font-semibold' : ''}>{cat}</td>
                  <td className="text-[--t2] text-[10px]">{sup}</td>
                  <td className="font-mono text-[10px]" style={{ color: i < 2 ? 'var(--red)' : 'var(--t1)' }}>{date}</td>
                  <td className="font-mono text-[10px] text-[--t2]">{lead}</td>
                  <td className="text-[10px] text-[--t2]">{del}</td>
                  <td className="text-[10px]" style={{ color: i < 2 ? 'var(--red)' : 'var(--t2)' }}>{risk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>Analytics · FlowSeer v2.1.0 · Award scenarios: tools/analytics/award_scenario_modeler.py</span>
          <span>Lead time risk: tools/analytics/lead_time_risk_matrix.md</span>
        </div>
      </div>
    </>
  );
}
