'use client';
import { Drawer } from '../ui/Drawer';
import { fmtCurrency } from '../../lib/api/flowseer';

const SUPPLIER_DATA: Record<string, any> = {
  'GE Vernova': {
    hq: 'Schenectady, NY', scope: 'Generator + Electrical Switchgear', exposure: 2_093_850, tier: 'Tier 1 Strategic',
    lead_time: '40–56 weeks', relationship: 'New', status: 'RFQ Ready',
    contacts: [{ name: 'Gas Power Business Development', email: 'gaspowerbd@gevernova.com', role: 'BD Director' }],
    rfqs: ['RFQ-008 — Generator + Switchgear — $2,093,850 — DRAFTED'],
    notes: 'True critical path item. 40–56 week lead time — must award by Aug 15 for Q2 2027 First Power. Competing vs Siemens Energy. GE dominates 60%+ of US industrial generator market at this frame size.',
    risk: 'critical', risk_note: 'CRITICAL PATH — Zero slippage on RFQ-008. Must send May 25.',
    market_intel: 'Expect +5–18% above estimate based on current backlog. GE has delivered W251-class generators on 8+ recent projects. Competitive bid with Siemens is essential leverage.',
  },
  'Siemens Energy': {
    hq: 'Houston, TX', scope: 'Generator (alt) · Transformer (alt)', exposure: 2_093_850, tier: 'Tier 1 Strategic',
    lead_time: '44–58 weeks', relationship: 'New', status: 'RFQ Ready',
    contacts: [{ name: 'Power Gen Sales — Americas', email: 'powergensales@siemens-energy.com', role: 'Sales Director' }],
    rfqs: ['RFQ-009 — Generator — $2,093,850 — DRAFTED', 'RFQ-011 — Transformer (alt) — $760,000 — BLOCKED'],
    notes: 'Competitive foil against GE Vernova for Generator. Also bidding Transformer as ABB backup. Strong W-frame experience from European fleet.',
    risk: 'warning', risk_note: 'HIGH VALUE — Competitive bid. Both RFQ-009 and RFQ-011 send May 25.',
    market_intel: 'Typically prices 2–8% below GE on competitive bids. Transformer pricing comparable to ABB.',
  },
  'Baker Hughes': {
    hq: 'Houston, TX', scope: 'Vibration Monitoring (VIB_MON) · Exhaust System', exposure: 608_900, tier: 'Tier 1 Strategic',
    lead_time: '8–14 weeks (VIB_MON) · 20–28 weeks (Exhaust)', relationship: 'Warm', status: '$340K Responded',
    contacts: [
      { name: 'Lorenzo Simonelli', email: 'lorenzo.simonelli@bakerhughes.com', role: 'CEO' },
      { name: 'Rod Christie', email: 'rod.christie@bakerhughes.com', role: 'EVP Turbomachinery' },
    ],
    rfqs: ['RFQ-001 — VIB_MON — RESPONDED — $340,000 (+26.7%)', 'RFQ-005 — Exhaust — $430,650 — DRAFTED'],
    notes: 'Only supplier who has responded. Quote of $340K is +26.7% above $268K estimate. Bently Nevada VIB_MON is industry standard for W-frame — high switching cost.',
    risk: 'warning', risk_note: 'DECISION PENDING — Accept $340K / negotiate to ~$310K / rebid.',
    market_intel: 'Market range $290K–$420K. Accept unless above $380K. Leverage RFQ-005 Exhaust relationship in negotiation.',
  },
  'ABB Power Grids': {
    hq: 'Zürich, Switzerland / Cary, NC', scope: 'Step-up Transformer (GSU)', exposure: 760_000, tier: 'Tier 1 Strategic',
    lead_time: '52–70 weeks', relationship: 'New', status: 'Blocked — ICD',
    contacts: [{ name: 'NA Transformers Division', email: 'transformers-na@abb.com', role: 'Technical Sales' }],
    rfqs: ['RFQ-010 — Step-up Transformer — $760,000 — BLOCKED (pending EthosEnergy ICD)'],
    notes: 'Cannot finalize RFQ without EthosEnergy ICD specifying generator output voltage and MVA rating. ABB is world\'s largest transformer manufacturer. Expedite premium ~15% available.',
    risk: 'critical', risk_note: 'BLOCKED — Requires EthosEnergy ICD. Escalate to Alberto Malandra.',
    market_intel: 'GSU transformers are long-lead globally. Order placed Aug 15 → delivery Feb–May 2027. On track for Q2 2027.',
  },
  'Emerson': {
    hq: 'St. Louis, MO', scope: 'Fuel Gas System · Controls/DCS Integration', exposure: 1_205_200, tier: 'Tier 1 Strategic',
    lead_time: '16–24 weeks (Fuel Gas) · 20–28 weeks (Controls)', relationship: 'New', status: 'RFQ Ready',
    contacts: [
      { name: 'Bob Yeager', email: 'bob.yeager@emerson.com', role: 'President, Measurement & Analytical' },
    ],
    rfqs: ['RFQ-002 — Fuel Gas System — $700,600 — DRAFTED', 'RFQ-004 — Controls/DCS — $504,600 — DRAFTED'],
    notes: 'W251B8 standard supplier. Fisher regulators + Daniel flow meters are OEM-specified. Bob Yeager (President) is the right contact for CEO-level outreach.',
    risk: 'ok', risk_note: 'LOW RISK — Expected at estimate. CEO contact identified.',
    market_intel: 'Emerson holds ~70% share on W-frame fuel gas systems. Price within 5% of estimate. No credible alternative.',
  },
  'CECO Environmental': {
    hq: 'Parsons, KS', scope: 'Emissions Control (SCR/CO) · Exhaust · Acoustic', exposure: 1_626_800, tier: 'Tier 1 Strategic',
    lead_time: '24–36 weeks', relationship: 'New', status: 'Permit Pending',
    contacts: [{ name: 'Environmental Solutions', email: 'solutions@cecoenviro.com', role: 'Business Development' }],
    rfqs: ['RFQ-012 — Emissions SCR — $891,750 — DRAFTED (pending NM permit scope)'],
    notes: 'NM Environmental permit scope (NOx/CO limits) must be confirmed before RFQ can be fully specified. CECO is dominant SCR supplier for W-frame applications.',
    risk: 'warning', risk_note: 'PERMIT PENDING — Confirm NM Environment Dept limits before finalizing.',
    market_intel: 'CECO quotes 15–20% above smaller competitors but offers integrated SCR + exhaust + acoustic as single package — reduces coordination risk.',
  },
  'Donaldson Company': {
    hq: 'Minneapolis, MN', scope: 'Inlet Air Filtering · Controls/DCS Integration', exposure: 1_029_750, tier: 'Tier 1 Strategic',
    lead_time: '14–20 weeks (Inlet) · 20–28 weeks (Controls)', relationship: 'New', status: 'RFQ Ready',
    contacts: [
      { name: 'Tod Carpenter', email: 'tod.carpenter@donaldson.com', role: 'CEO' },
      { name: 'Michael Wynblatt', email: 'michael.wynblatt@donaldson.com', role: 'CTO' },
    ],
    rfqs: ['RFQ-003 — Inlet Air — $525,150 — DRAFTED', 'RFQ-004 — Controls/DCS — $504,600 — DRAFTED'],
    notes: 'CEO and CTO contacts for bundle outreach. Bundle RFQ-003 + RFQ-004 for $1.03M total — leverage for 8–12% discount.',
    risk: 'ok', risk_note: 'LOW RISK — CEO/CTO outreach. Bundle opportunity $1.03M.',
    market_intel: 'Donaldson Ultra-Web is OEM-specified. Bundle approach should yield 8–12% savings vs separate POs.',
  },
  'Eaton Corporation': {
    hq: 'Dublin, Ireland / USA', scope: 'Electrical Distribution (Auxiliary)', exposure: 535_050, tier: 'Tier 1 Strategic',
    lead_time: '20–30 weeks', relationship: 'New', status: 'RFQ Ready',
    contacts: [{ name: 'Power Distribution Division', email: 'powerdist@eaton.com', role: 'Power Gen Sales' }],
    rfqs: ['RFQ-006 — Electrical Distribution — $535,050 — DRAFTED (MV/LV switchgear)'],
    notes: 'Station service MV/LV switchgear for auxiliary power. Auxiliary power requirements from EthosEnergy ICD required to finalize specification.',
    risk: 'critical', risk_note: 'BLOCKED — Auxiliary power kW/voltage from EthosEnergy ICD required.',
    market_intel: 'Standard MV/LV switchgear market. ABB LV is credible backup. Price competitive.',
  },
  'Flowserve': {
    hq: 'Irving, TX', scope: 'Piping & Valves (BOP Interconnect)', exposure: 507_600, tier: 'Tier 1 Strategic',
    lead_time: '10–16 weeks', relationship: 'New', status: 'Selected — Trillium replacement',
    contacts: [{ name: 'Power Generation Division', email: 'power@flowserve.com', role: 'Power Gen Sales' }],
    rfqs: ['RFQ-013 — Piping & Valves — $507,600 — DRAFTED'],
    notes: 'Selected to replace Trillium Flow Technologies (AVOID — revenue too small for single-source risk). Deep W-frame BOP valve experience. RFQ-013 ready for May 25.',
    risk: 'ok', risk_note: 'RESOLVED — Trillium AVOID replaced. Ready.',
    market_intel: 'Expected within 5% of estimate. Short lead time — low scheduling risk.',
  },
  'EthosEnergy Italia': {
    hq: 'Turin, Italy', scope: 'W251B8 Gas Turbine OEM Engineering Interface', exposure: 0, tier: 'Program GT',
    lead_time: 'N/A — OEM relationship', relationship: 'Contracted (MOU Mar 13 2026)', status: 'ICD Outstanding',
    contacts: [
      { name: 'Alberto Malandra', email: 'alberto.malandra@ethosenergy.com', role: 'Managing Director' },
      { name: 'Todd Dunlop', email: 'todd.dunlop@ethosenergy.com', role: 'Director' },
    ],
    rfqs: [],
    notes: 'MOU executed March 13, 2026. Provides W251B8 GT package + aftermarket engineering. ICD is critical blocker for $1.73M of RFQs. Todd Dunlop can release preliminary ICD within 48 hours if escalated.',
    risk: 'critical', risk_note: 'CRITICAL — ICD overdue. Blocks $1.73M. Escalate to Alberto immediately.',
    market_intel: 'EthosEnergy is exclusive source for W251B8 ICD. No workaround available.',
  },
};

interface Props { name: string | null; onClose: () => void; }

export function SupplierDrawer({ name, onClose }: Props) {
  const s = name ? SUPPLIER_DATA[name] : null;
  const rC = s?.risk === 'critical' ? 'var(--red)' : s?.risk === 'warning' ? 'var(--amb)' : 'var(--t2)';
  const rB = s?.risk === 'critical' ? 'rgba(204,32,32,0.07)' : s?.risk === 'warning' ? 'rgba(200,120,0,0.06)' : 'var(--bg2)';

  return (
    <Drawer open={!!name && !!s} onClose={onClose} title={name ?? ''} subtitle="Supplier Intelligence Profile">
      {s && <div className="flex flex-col gap-5">
        <div className="px-4 py-3 font-mono text-[10px] border-l-2" style={{ background: rB, borderLeftColor: rC, color: rC, border: `1px solid ${rC}30`, borderLeft: `2px solid ${rC}` }}>
          {s.risk_note}
        </div>
        <Sec title="Profile">
          <Row k="HQ" v={s.hq} />
          <Row k="Scope" v={s.scope} />
          <Row k="BOP Exposure" v={s.exposure > 0 ? fmtCurrency(s.exposure) : 'Program GT'} mono />
          <Row k="Lead Time" v={s.lead_time} />
          <Row k="Relationship" v={s.relationship} />
        </Sec>
        <Sec title="Key Contacts">
          {s.contacts.map((c: any, i: number) => (
            <div key={i} className="py-2 border-b border-[--line] last:border-b-0">
              <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--t0)' }}>{c.name}</div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px]" style={{ color: 'var(--t2)' }}>{c.role}</span>
                <a href={`mailto:${c.email}`} className="font-mono text-[10px]" style={{ color: 'var(--brand-blue2)' }}>{c.email}</a>
              </div>
            </div>
          ))}
        </Sec>
        {s.rfqs.length > 0 && <Sec title="Active RFQs">
          {s.rfqs.map((r: string, i: number) => (
            <div key={i} className="py-2 border-b border-[--line] last:border-b-0 font-mono text-[10px]" style={{ color: 'var(--t1)' }}>{r}</div>
          ))}
        </Sec>}
        <Sec title="Market Intelligence"><p className="text-[11px] leading-[1.7]" style={{ color: 'var(--t1)' }}>{s.market_intel}</p></Sec>
        <Sec title="Program Notes"><p className="text-[11px] leading-[1.7]" style={{ color: 'var(--t1)' }}>{s.notes}</p></Sec>
      </div>}
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
