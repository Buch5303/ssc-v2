'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSupplierNetwork, fetchContactStats } from '../../../lib/api/flowseer';
import { KPI }             from '../../../components/ui/KPI';
import { Badge }           from '../../../components/ui/Badge';
import { Panel }           from '../../../components/ui/Panel';
import { AlertCard }       from '../../../components/ui/AlertCard';
import { TierLabel }       from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';
import { RiskMatrixPanel } from '../../../components/ui/RiskMatrixPanel';
import { TableFilter }     from '../../../components/ui/TableFilter';
import { SupplierDrawer }  from '../../../components/suppliers/SupplierDrawer';

const SUPPLIERS = [
  { name: 'GE Vernova',        hq: 'Schenectady NY', scope: 'Generator + Switchgear',         exp: 2_093_850, contact: 'Gas Power BD',         rel: 'New',         badgeV: 'critical' as const, status: 'RFQ Ready',                 tier: 'T1' },
  { name: 'Emerson',           hq: 'St. Louis MO',   scope: 'Fuel Gas · Controls/DCS',        exp: 1_205_200, contact: 'Bob Yeager, Pres.',    rel: 'New',         badgeV: 'pending'  as const, status: 'RFQ Ready',                 tier: 'T1' },
  { name: 'CECO Environmental',hq: 'Parsons KS',     scope: 'Emissions · Exhaust · Acoustic', exp: 1_626_800, contact: 'Env. Solutions',       rel: 'New',         badgeV: 'warning'  as const, status: 'Permit Pending',            tier: 'T1' },
  { name: 'ABB Power Grids',   hq: 'Zürich / NC',    scope: 'Step-up Transformer',            exp: 760_000,   contact: 'NA Transformers',      rel: 'New',         badgeV: 'critical' as const, status: 'Blocked — ICD',             tier: 'T1' },
  { name: 'Siemens Energy',    hq: 'Houston TX',     scope: 'Generator (alt) · Transformer',  exp: 2_093_850, contact: 'Power Gen Sales',      rel: 'New',         badgeV: 'pending'  as const, status: 'RFQ Ready',                 tier: 'T1' },
  { name: 'Baker Hughes',      hq: 'Houston TX',     scope: 'VIB_MON · Exhaust',              exp: 608_900,   contact: 'L. Simonelli CEO',     rel: 'Warm',        badgeV: 'verified' as const, status: '$340K Responded',           tier: 'T1' },
  { name: 'Donaldson Company', hq: 'Minneapolis MN', scope: 'Inlet Air · Controls/DCS',       exp: 1_029_750, contact: 'Tod Carpenter CEO',    rel: 'New',         badgeV: 'pending'  as const, status: 'RFQ Ready',                 tier: 'T1' },
  { name: 'Eaton Corporation', hq: 'Dublin IE / USA',scope: 'Electrical Distribution',        exp: 535_050,   contact: 'Power Dist.',          rel: 'New',         badgeV: 'critical' as const, status: 'RFQ Ready',                 tier: 'T1' },
  { name: 'Flowserve',         hq: 'Irving TX',      scope: 'Piping & Valves',                exp: 507_600,   contact: 'Power Gen',            rel: 'New',         badgeV: 'verified' as const, status: 'Selected (Trillium repl.)', tier: 'T1' },
  { name: 'EthosEnergy Italia',hq: 'Turin, Italy',   scope: 'W251B8 Gas Turbine OEM',         exp: 0,         contact: 'Alberto Malandra MD',  rel: 'Contracted',  badgeV: 'critical' as const, status: 'ICD Outstanding',           tier: 'T1' },
];

const fmtExp = (n: number) => n > 0 ? `$${(n/1000).toFixed(0)}K` : 'Program GT';

export default function SupplierNetworkPage() {
  const Q = { refetchInterval: 60_000 };
  const { data: network }  = useQuery({ queryKey: ['network'],  queryFn: fetchSupplierNetwork, ...Q });
  const { data: contacts } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactStats,   ...Q });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  const total = network?.total_suppliers ?? 73;

  const filtered = useMemo(() => SUPPLIERS.filter(s => {
    const q = search.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.scope.toLowerCase().includes(q) || s.hq.toLowerCase().includes(q);
    const matchS = !statusFilter || s.badgeV === statusFilter;
    return matchQ && matchS;
  }), [search, statusFilter]);

  const exportCSV = () => {
    const rows = [['Supplier','HQ','Scope','Exposure','Contact','Relationship','Status']];
    SUPPLIERS.forEach(s => rows.push([s.name, s.hq, s.scope, fmtExp(s.exp), s.contact, s.rel, s.status]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv])); a.download = 'flowseer_suppliers.csv'; a.click();
  };

  return (
    <>
      <ConditionBanner
        state="warning"
        tag="⚠ Network"
        items={[
          { label: 'Coverage:',  value: `${total} suppliers · 19 categories · 10 strategic profiles` },
          { label: 'Risk:',      value: 'GE Vernova 22.6% exposure — mitigated by competitive bid vs Siemens Energy' },
          { label: 'Resolved:',  value: 'Trillium AVOID → Flowserve confirmed · $507K scope properly sourced' },
        ]}
      />

      <div className="p-6 max-w-[1400px]">
        <TierLabel>Tier 1 — Network Health</TierLabel>
        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI label="Total Suppliers"   value={total}  sub="19 categories identified" />
          <KPI label="Tier 1 Strategic"  value={28}     sub="Primary preferred vendors"  badge={<Badge>Active</Badge>} />
          <KPI label="Tier 2 Qualified"  value={31}     sub="Competitive alternatives" />
          <KPI label="Tier 3 Backup"     value={14}     sub="Contingency sourcing" />
          <KPI label="Competitive Bids"  value="3"      sub="Generator · Transformer · Emissions" badge={<Badge variant="verified">Active</Badge>} />
          <KPI label="Avoid Flags"       value="1"      sub="Trillium — Resolved → Flowserve"     badge={<Badge variant="verified">Resolved</Badge>} />
        </div>

        <TierLabel>Tier 2 — Strategic Analysis</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Panel title="Critical Path Suppliers" meta={<Badge variant="critical">2 Critical</Badge>}>
            <div className="flex flex-col gap-2">
              <AlertCard severity="critical" title="GE Vernova — Generator + Switchgear ($2.09M)" detail="True critical path. 40–56 week lead time. Must award by August 15 for Q2 2027 first power. Competitive bid with Siemens Energy required." action="→ rfq_generator_ge_vernova.txt ready for May 25" />
              <AlertCard severity="critical" title="ABB Power Grids — Step-up Transformer ($760K)" detail="52–70 week lead. Blocked on EthosEnergy ICD for voltage/MVA specification. Competitive bid with Siemens Energy. Expedite premium ~15% available." action="→ Blocked · rfq_transformer_abb.txt ready when ICD received" />
              <AlertCard severity="warning" title="Emerson — Fuel Gas System ($700K)" detail="Fisher regulators + Daniel flow meters — W251B8 standard. Bob Yeager (President) primary contact. 16–24 week lead." action="→ rfq_bob_yeager_emerson.txt ready" />
              <AlertCard severity="warning" title="CECO Environmental — SCR / Emissions ($892K)" detail="SCR + CO catalyst combined package. 24–36 week lead. Pending NM environmental permit scope confirmation." action="→ rfq_ceco_emissions.txt drafted" />
            </div>
          </Panel>

          <Panel title="Sourcing Strategy">
            <table>
              <thead><tr><th>Category</th><th>Strategy</th><th>Preferred</th><th>Backup</th></tr></thead>
              <tbody>
                {[
                  ['Generator','Compete','GE Vernova','Siemens Energy'],
                  ['Transformer','Compete','ABB Power','Siemens / WEG'],
                  ['Emissions SCR','Compete','CECO Environmental','Peerless Mfg'],
                  ['Fuel Gas','Single','Emerson','CIRCOR Energy'],
                  ['Inlet Air','Single','Donaldson','Camfil'],
                  ['Controls/DCS','Single','Donaldson/Emerson','—'],
                  ['Piping & Valves','Single','Flowserve','Watts Water'],
                  ['Electrical Dist.','Single','Eaton','ABB LV'],
                  ['Fire Fighting','Single','Amerex','—'],
                  ['Comp. Washing','Single','Turbotect','Rochem'],
                ].map(([cat, strat, pref, back], i) => (
                  <tr key={i}><td>{cat}</td><td><Badge>{strat}</Badge></td><td>{pref}</td><td className="text-[--t2]">{back}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <TierLabel>Tier 3 — Strategic Supplier Profiles</TierLabel>
        <Panel
          title="10 Strategic Supplier Intelligence Profiles"
          meta={
            <div className="flex items-center gap-2">
              <Badge variant="estimated">Partial enrichment</Badge>
              <button onClick={exportCSV} className="font-mono text-[9px] px-3 py-1 transition-colors" style={{ background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--t2)' }}>
                ↓ CSV
              </button>
            </div>
          }
        >
          <TableFilter
            placeholder="Search suppliers…"
            onSearch={setSearch}
            onFilter={(_, v) => setStatusFilter(v)}
            filters={[{ label: 'Status', options: [
              { label: 'Critical', value: 'critical' },
              { label: 'Warning', value: 'warning' },
              { label: 'Verified', value: 'verified' },
              { label: 'Pending', value: 'pending' },
            ]}]}
            count={filtered.length}
            total={SUPPLIERS.length}
          />
          <table>
            <thead><tr><th>Supplier</th><th>HQ</th><th>BOP Scope</th><th className="text-right">Exposure</th><th>Lead Contact</th><th>Relationship</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedSupplier(s.name)}
                  className="cursor-pointer"
                  style={s.badgeV === 'critical' ? { background: 'rgba(204,32,32,0.04)' } : {}}
                >
                  <td className="font-semibold" style={{ color: 'var(--t0)' }}>{s.name}</td>
                  <td className="text-[--t2]">{s.hq}</td>
                  <td className="text-[10px]">{s.scope}</td>
                  <td className="font-mono text-right text-[10px]">{fmtExp(s.exp)}</td>
                  <td>{s.contact}</td>
                  <td style={{ color: s.rel === 'Contracted' || s.rel === 'Warm' ? 'var(--t0)' : 'var(--t2)' }}>{s.rel}</td>
                  <td><Badge variant={s.badgeV}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* AI Risk Assessment */}
        <div className="mt-6 mb-6">
          <RiskMatrixPanel />
        </div>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>Supplier Network · FlowSeer v2.1.0 · {contacts?.verified ?? 39}/{contacts?.total ?? 67} contacts verified</span>
          <span>Click any row to view full supplier intelligence profile</span>
        </div>
      </div>

      <SupplierDrawer name={selectedSupplier} onClose={() => setSelectedSupplier(null)} />
    </>
  );
}
