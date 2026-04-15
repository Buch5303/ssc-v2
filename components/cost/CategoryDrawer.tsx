'use client';
import { Drawer } from '../ui/Drawer';
import { fmtCurrency } from '../../lib/api/flowseer';
import type { PricingCategory } from '../../lib/types/flowseer';

const CATEGORY_NOTES: Record<string, string> = {
  GENERATOR: 'True critical path. W251B8-rated air-cooled synchronous generator. Lead time 40–56 weeks drives entire project schedule. Competing GE Vernova vs Siemens Energy. Historical overrun: +12–18% on sole-source, +5–8% competitive.',
  TRANSFORMER: 'GSU step-up transformer — blocked on EthosEnergy ICD for voltage/MVA spec. ABB Power Grids vs Siemens Energy competition. 52–70 week lead. Expedite premium ~15% if needed post-ICD.',
  EMISSIONS: 'Combined SCR + CO catalyst package. CECO Environmental preferred for integrated supply. NM permit NOx/CO limits required to finalize spec. 24–36 week lead.',
  FUEL_GAS: 'Fisher regulators + Daniel flow meters — W251B8 OEM-specified. Emerson holds ~70% market share. Bob Yeager (President) is primary contact. Expected at estimate.',
  ELEC_DIST: 'Station service MV/LV switchgear. Blocked on EthosEnergy ICD for auxiliary power kW/voltage requirements. Eaton preferred over ABB LV.',
  INLET_AIR: 'Donaldson Ultra-Web filter media — OEM-specified. Bundle with Controls/DCS (RFQ-003 + RFQ-004) for ~10% discount. 14–20 week lead.',
  PIPING_VALVES: 'BOP interconnect piping and valves. Flowserve selected after Trillium Flow Technologies AVOID flag. 10–16 week lead — lowest scheduling risk.',
  CONTROLS_DCS: 'BOP DCS integration. Donaldson/Emerson hybrid preferred. Bundle with Inlet Air for leverage. Michael Wynblatt (CTO) outreach identified.',
  EXHAUST: 'Exhaust system scope partially blocked on ICD (flange dimensions). Baker Hughes preferred — leverage VIB_MON relationship. 20–28 week lead.',
  CIVIL_STRUCT: 'Civil and structural works for turbine pad, BOP equipment foundations. Local EPC contractor to provide. Estimate based on comparable NM projects.',
  ACOUSTIC: 'Acoustic enclosure and noise control package. CECO offers as add-on to SCR package — bundle opportunity.',
  LUBE_OIL: 'Lube oil system — Parker Hannifin preferred. Standard W-frame package. 16–20 week lead.',
  VIB_MON: 'Baker Hughes Bently Nevada 3500 Series. RESPONDED: $340K (+26.7% vs $268K estimate). Decision pending. Market range $290K–$420K.',
  STARTING: 'Starting system — Koenig preferred. Static frequency converter start for W251B8. 14–18 week lead.',
  FIRE_FIGHT: 'Fire fighting system — Amerex preferred. NFPA 750 package. 10–16 week lead.',
  COOLING: 'Cooling / cooling water system — SPX Cooling preferred. 16–22 week lead.',
  FUEL_OIL: 'Backup fuel oil system — Parker preferred. Optional scope pending fuel strategy confirmation.',
  WATER_WASH: 'Compressor washing system — Turbotect preferred. Online + offline W-frame package. 8–12 week lead.',
  TELECOMS: 'Telecommunications and plant network — Cisco preferred. 8–12 week lead.',
};

interface Props { category: PricingCategory | null; onClose: () => void; }

export function CategoryDrawer({ category: cat, onClose }: Props) {
  if (!cat) return <Drawer open={false} onClose={onClose} title=""><></></Drawer>;

  const note = CATEGORY_NOTES[cat.category_code] ?? 'No additional notes.';
  const isVerified = cat.confidence === 'RFQ_VERIFIED';
  const range = cat.bom_high - cat.bom_low;
  const rangePct = ((range / cat.bom_mid) * 100).toFixed(1);
  const scenarios = [
    { label: 'Optimistic', val: cat.scenario_optimistic ?? cat.bom_low, delta: ((((cat.scenario_optimistic ?? cat.bom_low) - cat.bom_mid) / cat.bom_mid) * 100).toFixed(1) },
    { label: 'Base', val: cat.bom_mid, delta: '0.0' },
    { label: 'Conservative', val: cat.scenario_pessimistic ?? cat.bom_high, delta: ((((cat.scenario_pessimistic ?? cat.bom_high) - cat.bom_mid) / cat.bom_mid) * 100).toFixed(1) },
  ];

  return (
    <Drawer open={!!cat} onClose={onClose} title={cat.category} subtitle={`Cost Intelligence — ${cat.category_code}`}>
      <div className="flex flex-col gap-5">

        {/* Confidence Banner */}
        <div className="px-4 py-3 border-l-2" style={{
          background: isVerified ? 'rgba(16,185,129,0.06)' : 'rgba(200,120,0,0.06)',
          borderLeftColor: isVerified ? '#10B981' : 'var(--amb)',
          color: isVerified ? '#10B981' : 'var(--amb)',
          border: `1px solid ${isVerified ? '#10B981' : 'var(--amb)'}30`,
          borderLeft: `2px solid ${isVerified ? '#10B981' : 'var(--amb)'}`,
          fontFamily: 'var(--font-mono)', fontSize: '10px',
        }}>
          {isVerified
            ? `RFQ VERIFIED — ${fmtCurrency(cat.rfq_quoted ?? 0)} (${cat.rfq_variance_pct !== null && cat.rfq_variance_pct !== undefined ? (cat.rfq_variance_pct > 0 ? '+' : '') + cat.rfq_variance_pct.toFixed(1) + '%' : '—'} vs estimate)`
            : `ESTIMATED — BOM build-up · ${cat.confidence}`}
        </div>

        {/* Pricing */}
        <Sec title="BOM Estimate">
          <Row k="Low" v={fmtCurrency(cat.bom_low)} mono />
          <Row k="Mid (Baseline)" v={fmtCurrency(cat.bom_mid)} mono />
          <Row k="High" v={fmtCurrency(cat.bom_high)} mono />
          <Row k="Range (±)" v={`${fmtCurrency(range)} (±${rangePct}%)`} mono />
          {isVerified && <Row k="RFQ Quoted" v={`${fmtCurrency(cat.rfq_quoted ?? 0)} (${cat.rfq_variance_pct !== null && cat.rfq_variance_pct !== undefined ? (cat.rfq_variance_pct > 0 ? '+' : '') + cat.rfq_variance_pct.toFixed(1) + '%' : '—'})`} mono />}
        </Sec>

        {/* Scenarios */}
        <Sec title="Scenario Analysis">
          {scenarios.map((s, i) => {
            const w = Math.max(10, Math.min(100, ((s.val - cat.bom_low * 0.8) / (cat.bom_high * 1.1 - cat.bom_low * 0.8)) * 100));
            const isHigh = parseFloat(s.delta) > 0;
            return (
              <div key={i} className="py-2 border-b border-[--line] last:border-b-0">
                <div className="flex justify-between mb-1">
                  <span className="text-[10px]" style={{ color: 'var(--t2)' }}>{s.label}</span>
                  <span className="font-mono text-[10px]" style={{ color: isHigh ? 'var(--red)' : 'var(--t1)' }}>
                    {fmtCurrency(s.val)} {s.delta !== '0.0' ? `(${isHigh ? '+' : ''}${s.delta}%)` : '(base)'}
                  </span>
                </div>
                <div className="h-[4px] rounded-sm" style={{ background: 'var(--bg3)' }}>
                  <div className="h-full rounded-sm transition-all" style={{ width: `${w}%`, background: isHigh ? 'var(--red)' : 'var(--t2)' }} />
                </div>
              </div>
            );
          })}
        </Sec>

        {/* Suppliers */}
        <Sec title="Sourcing">
          <Row k="Preferred Supplier" v={cat.preferred_supplier} />
          {cat.avoid_supplier && <Row k="Avoid" v={cat.avoid_supplier} />}
          <Row k="Spend Tier" v={cat.spend_tier} />
          <Row k="Confidence" v={cat.confidence.replace(/_/g, ' ')} />
        </Sec>

        {/* Notes */}
        <Sec title="Program Intelligence">
          <p className="text-[11px] leading-[1.7]" style={{ color: 'var(--t1)' }}>{note}</p>
        </Sec>

      </div>
    </Drawer>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <div>
    <div className="font-mono text-[9px] tracking-[2px] uppercase mb-3 pb-2 border-b border-[--line]" style={{ color: 'var(--t3)' }}>{title}</div>
    {children}
  </div>;
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between items-baseline py-[7px] border-b border-[--line] last:border-b-0">
    <span className="text-[11px]" style={{ color: 'var(--t2)' }}>{k}</span>
    <span className={mono ? 'font-mono text-[11px]' : 'text-[11px] font-medium'} style={{ color: 'var(--t0)' }}>{v}</span>
  </div>;
}
