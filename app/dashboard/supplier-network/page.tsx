'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchSupplierNetwork, fetchContactStats } from '../../../lib/api/flowseer';
import { KPI }             from '../../../components/ui/KPI';
import { Badge }           from '../../../components/ui/Badge';
import { Panel }           from '../../../components/ui/Panel';
import { AlertCard }       from '../../../components/ui/AlertCard';
import { TierLabel }       from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';

export default function SupplierNetworkPage() {
  const Q = { refetchInterval: 60_000 };
  const { data: network }  = useQuery({ queryKey: ['network'],  queryFn: fetchSupplierNetwork, ...Q });
  const { data: contacts } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactStats,   ...Q });

  const total    = network?.total_suppliers   ?? 73;
  const tier1    = network?.strategic_tier1   ?? 28;
  const tier2    = (network?.by_tier?.['Tier 2'] as number) ?? 31;
  const tier3    = (network?.by_tier?.['Tier 3'] as number) ?? 14;
  const prefSups = network?.preferred_suppliers ?? [];
  const avoidSup = network?.avoid_suppliers     ?? [];

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
          <KPI label="Tier 1 Strategic"  value={tier1}  sub="Primary preferred vendors"  badge={<Badge>Active</Badge>} />
          <KPI label="Tier 2 Qualified"  value={tier2}  sub="Competitive alternatives" />
          <KPI label="Tier 3 Backup"     value={tier3}  sub="Contingency sourcing" />
          <KPI label="Competitive Bids"  value="3"      sub="Generator · Transformer · Emissions" badge={<Badge variant="verified">Active</Badge>} />
          <KPI label="Avoid Flags"       value="1"      sub="Trillium — Resolved → Flowserve"     badge={<Badge variant="verified">Resolved</Badge>} />
        </div>

        <TierLabel>Tier 2 — Strategic Analysis</TierLabel>
        <div className="grid grid-cols-2 gap-5 mb-8">
          <Panel title="Critical Path Suppliers" meta={<Badge variant="critical">2 Critical</Badge>}>
            <div className="flex flex-col gap-2">
              <AlertCard severity="critical" title="GE Vernova — Generator + Switchgear ($2.09M)" detail="True critical path. 40–56 week lead time. Must award by August 15 for Q2 2027 first power. Competitive bid with Siemens Energy required." action="→ rfq_generator_ge_vernova.txt ready for May 25" />
              <AlertCard severity="critical" title="ABB Power Grids — Step-up Transformer ($760K)" detail="52–70 week lead. Blocked on EthosEnergy ICD for voltage/MVA specification. Competitive bid with Siemens Energy. Expedite premium ~15% available." action="→ Blocked · rfq_transformer_abb.txt ready when ICD received" />
              <AlertCard severity="warning" title="Emerson — Fuel Gas System ($700K)" detail="Fisher regulators + Daniel flow meters — W251B8 standard. Bob Yeager (President) primary contact. 16–24 week lead. Expected at estimate." action="→ rfq_bob_yeager_emerson.txt ready" />
              <AlertCard severity="warning" title="CECO Environmental — SCR / Emissions ($892K)" detail="SCR + CO catalyst combined package. 24–36 week lead. Pending NM environmental permit scope confirmation." action="→ Confirm NM permit limits · rfq_ceco_emissions.txt drafted" />
            </div>
          </Panel>

          <Panel title="Sourcing Strategy">
            <table>
              <thead><tr><th>Category</th><th>Strategy</th><th>Preferred</th><th>Backup</th></tr></thead>
              <tbody>
                {[
                  ['Generator',        'Compete', 'GE Vernova',      'Siemens Energy'],
                  ['Transformer',      'Compete', 'ABB Power',       'Siemens / WEG'],
                  ['Emissions SCR',    'Compete', 'CECO Environmental','Peerless Mfg'],
                  ['Fuel Gas',         'Single',  'Emerson',         'CIRCOR Energy'],
                  ['Inlet Air',        'Single',  'Donaldson',       'Camfil'],
                  ['Controls/DCS',     'Single',  'Donaldson/Emerson','—'],
                  ['Piping & Valves',  'Single',  'Flowserve',       'Watts Water'],
                  ['Electrical Dist.', 'Single',  'Eaton',           'ABB LV'],
                  ['Fire Fighting',    'Single',  'Amerex',          '—'],
                  ['Comp. Washing',    'Single',  'Turbotect',       'Rochem'],
                ].map(([cat, strat, pref, back], i) => (
                  <tr key={i}>
                    <td>{cat}</td>
                    <td><Badge>{strat as string}</Badge></td>
                    <td>{pref}</td>
                    <td className="text-[--t2]">{back}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <TierLabel>Tier 3 — Strategic Supplier Profiles (Tier 1)</TierLabel>
        <Panel title="10 Strategic Supplier Intelligence Profiles" meta={<Badge variant="estimated">Partial enrichment</Badge>}>
          <table>
            <thead><tr><th>Supplier</th><th>HQ</th><th>BOP Scope</th><th className="text-right">Exposure</th><th>Lead Contact</th><th>Relationship</th><th>Status</th></tr></thead>
            <tbody>
              {[
                ['GE Vernova',        'Schenectady NY', 'Generator + Switchgear',         2_093_850, 'Gas Power BD',         'New',         'pending',  'RFQ Ready'],
                ['Emerson',           'St. Louis MO',   'Fuel Gas · Controls/DCS',        1_205_200, 'Bob Yeager, Pres.',    'New',         'pending',  'RFQ Ready'],
                ['CECO Environmental','Parsons KS',      'Emissions · Exhaust · Acoustic',1_626_800, 'Env. Solutions',       'New',         'warning',  'Permit Pending'],
                ['ABB Power Grids',   'Zürich / Cary NC','Step-up Transformer',             760_000, 'NA Transformers',      'New',         'critical', 'Blocked — ICD'],
                ['Siemens Energy',    'Houston TX',      'Generator (alt) · Transformer',2_093_850,  'Power Gen Sales',      'New',         'pending',  'RFQ Ready'],
                ['Baker Hughes',      'Houston TX',      'VIB_MON · Exhaust',               608_900, 'L. Simonelli CEO',     'Warm',        'verified', '$340K Responded'],
                ['Donaldson Company', 'Minneapolis MN',  'Inlet Air · Controls/DCS',      1_029_750, 'Tod Carpenter CEO',    'New',         'pending',  'RFQ Ready'],
                ['Eaton Corporation', 'Dublin IE / USA', 'Electrical Distribution',         535_050, 'Power Dist.',          'New',         'pending',  'RFQ Ready'],
                ['Flowserve',         'Irving TX',       'Piping & Valves',                 507_600, 'Power Gen',            'New',         'verified', 'Selected (Trillium repl.)'],
                ['EthosEnergy Italia','Turin, Italy',    'W251B8 Gas Turbine OEM',               0,  'A. Malandra MD',       'Contracted',  'critical', 'ICD Outstanding'],
              ].map(([name, hq, scope, exp, contact, rel, badgeV, status], i) => (
                <tr key={i} style={badgeV === 'critical' ? { background: 'rgba(204,32,32,0.04)' } : {}}>
                  <td className="font-semibold">{name}</td>
                  <td className="text-[--t2]">{hq}</td>
                  <td className="text-[10px]">{scope}</td>
                  <td className="font-mono text-right text-[10px]">{(exp as number) > 0 ? `$${((exp as number)/1000).toFixed(0)}K` : 'Program GT'}</td>
                  <td>{contact}</td>
                  <td style={{ color: rel === 'Contracted' || rel === 'Warm' ? 'var(--t0)' : 'var(--t2)' }}>{rel}</td>
                  <td>
                    <Badge variant={badgeV as any}>{status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>Supplier Network · FlowSeer v2.1.0 · {contacts?.verified ?? 39}/{contacts?.total ?? 67} contacts verified</span>
          <span>Full profiles: tools/supplier-intelligence/supplier_profiles.md</span>
        </div>
      </div>
    </>
  );
}
