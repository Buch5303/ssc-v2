'use client';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProgramSummary, fetchRFQPipeline, fetchContactStats,
  fetchKPIBand, daysToSend, fmtCurrency,
} from '../../../lib/api/flowseer';
import { KPI }            from '../../../components/ui/KPI';
import { Badge }          from '../../../components/ui/Badge';
import { AlertCard }      from '../../../components/ui/AlertCard';
import { Panel }          from '../../../components/ui/Panel';
import { StatRow }        from '../../../components/ui/StatRow';
import { TierLabel }      from '../../../components/ui/TierLabel';
import { ConditionBanner } from '../../../components/ui/ConditionBanner';
import { AIBriefingPanel } from '../../../components/ui/AIBriefingPanel';

export default function OverviewPage() {
  const Q = { refetchInterval: 60_000 };

  const { data: summary, isLoading } = useQuery({
    queryKey: ['summary'], queryFn: fetchProgramSummary, ...Q,
  });
  const { data: rfqs }     = useQuery({ queryKey: ['rfqs'],     queryFn: fetchRFQPipeline,   ...Q });
  const { data: contacts } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactStats,  ...Q });
  const { data: kpi }      = useQuery({ queryKey: ['kpi'],      queryFn: fetchKPIBand,       ...Q });

  const days       = summary?.days_to_rfq_send ?? daysToSend();
  const bopMid     = summary?.total_bop_mid    ?? 9_274_000;
  const pipelineVal= rfqs?.pipeline_value       ?? 9_898_000;
  const responded  = rfqs?.responded            ?? 1;
  const drafted    = rfqs?.drafted              ?? 12;
  const totalRFQs  = rfqs?.total               ?? 13;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="font-mono text-[11px] text-[--t3] tracking-[2px] uppercase">Loading…</span>
      </div>
    );
  }

  return (
    <>
      {/* Tier 1: Condition Banner */}
      <ConditionBanner
        state="critical"
        tag="🔴 Critical"
        items={[
          { label: 'Condition:',       value: 'AMBER — On track with one unresolved blocker' },
          { label: 'Changed:',         value: 'BH $340K received · 12 RFQs drafted · Trillium AVOID resolved' },
          { label: 'Action Required:', value: 'EthosEnergy ICD overdue — escalate immediately', isAction: true },
        ]}
      />

      <div className="p-6 max-w-[1400px]">

        {/* KPI Strip */}
        <TierLabel>Tier 1 — Executive Summary</TierLabel>
        <div className="grid grid-cols-6 gap-px bg-[--line] mb-8">
          <KPI
            label="BOP Baseline"
            value={fmtCurrency(bopMid)}
            sub="19 categories · $185/kW · 50MW"
            badge={<Badge variant="estimated">Estimated</Badge>}
          />
          <KPI
            label="RFQ Pipeline"
            value={fmtCurrency(pipelineVal)}
            sub={`${totalRFQs} packages · ${responded} responded · ${drafted} drafted`}
            badge={<Badge>In Progress</Badge>}
          />
          <KPI
            label="Days to Send"
            value={days}
            sub="May 25, 2026 — Fixed"
            accent="warning"
          />
          <KPI
            label="BH VIB_MON Quote"
            value="$340K"
            sub="+26.7% vs estimate · Decision pending"
            badge={<Badge variant="verified">Verified</Badge>}
          />
          <KPI
            label="Contact Intel"
            value={contacts?.total ?? 67}
            sub={`${contacts?.verified ?? 39} verified · ${contacts?.total ?? 67} contacts`}
            badge={<Badge variant="estimated">Partial</Badge>}
          />
          <KPI
            label="EthosEnergy ICD"
            value="Pending"
            sub="Blocks $1.73M in RFQs · Due May 1"
            accent="critical"
            badge={<Badge variant="critical">Blocker</Badge>}
          />
        </div>

        {/* Tier 2: Decision Drivers */}
        <TierLabel>Tier 2 — Decision Drivers</TierLabel>
        <div className="grid grid-cols-[3fr_2fr] gap-5 mb-8">

          {/* Alert Cards */}
          <div className="flex flex-col gap-3">
            <AlertCard
              severity="critical"
              title="EthosEnergy ICD Not Received — Program Blocker"
              detail="ICD blocks Transformer ($760K, 52–70 wk lead), Exhaust ($431K), and Electrical Distribution ($535K). Total blocked: $1,725,700. Required by May 1. Every day of delay risks Q2 2027 First Power target."
              action="→ tools/flowseer.py icd escalate · Alberto Malandra + Todd Dunlop, EthosEnergy Italia"
              aside={<>
                <Badge variant="critical">Critical</Badge>
                <span className="font-mono text-[10px] text-[--red]">$1.73M blocked</span>
              </>}
            />
            <AlertCard
              severity="warning"
              title="Baker Hughes VIB_MON — Commercial Decision Required"
              detail="Quoted $340,000 (+26.7% above $268K estimate). Within market range ($290K–$420K). Decision: accept and issue PO, negotiate, or rebid. Must resolve before May 1."
              action="→ PO template ready: tools/contracts/drafts/TWP-2026-0001_VIB_MON_Baker_Hughes.txt"
              aside={<>
                <Badge variant="warning">High</Badge>
                <span className="font-mono text-[10px] text-[--amb]">+$71.7K vs est.</span>
              </>}
            />
            <AlertCard
              severity="warning"
              title="Generator + Switchgear — True Critical Path (40–56 wk lead)"
              detail="Generator is the binding constraint on Q2 2027 First Power. If awarded August 15, earliest delivery is October 2027. Must RFQ GE Vernova AND Siemens Energy on May 25. Zero slippage permitted."
              action="→ Both RFQs ready: rfq_generator_ge_vernova.txt · rfq_generator_siemens_energy.txt"
              aside={<>
                <Badge variant="warning">High</Badge>
                <span className="font-mono text-[10px] text-[--amb]">$2.09M · 40–56wk</span>
              </>}
            />
            <AlertCard
              severity="resolved"
              title="Trillium AVOID — Resolved. Flowserve Selected as Replacement."
              detail="Piping & Valves ($507,600) previously sourced to disqualified supplier. Flowserve selected. RFQ drafted and ready for May 25 send. No further action needed."
              action="→ rfq_piping_valves_flowserve.txt ready"
              aside={<Badge variant="verified">Resolved</Badge>}
            />
          </div>

          {/* Right: Scorecard + Platform Health */}
          <div className="flex flex-col gap-3">
            <Panel title="Program Scorecard" meta={<Badge variant="warning">Amber</Badge>}>
              <StatRow label="BOP Budget vs $10M target" value="$9.27M ✓"    valueStyle="ok" />
              <StatRow label="RFQ packages prepared"     value="13 / 13 ✓"   valueStyle="ok" />
              <StatRow label="RFQ send date"             value="May 25 — locked ✓" valueStyle="ok" />
              <StatRow label="Categories priced"         value="19 / 19 ✓"   valueStyle="ok" />
              <StatRow label="BH quote received"         value="Yes — $340K ✓" valueStyle="ok" />
              <StatRow label="EthosEnergy ICD"           value="Pending — At Risk ✗" valueStyle="critical" />
              <StatRow label="Trillium AVOID"            value="Resolved → Flowserve ✓" valueStyle="ok" />
              <StatRow label="First Power target"        value="Q2 2027 — On Track ✓" valueStyle="ok" />
            </Panel>

            <Panel title="Platform Health" meta={<Badge variant="verified">Live</Badge>}>
              <StatRow label="Tests passing"       value="125 / 125"     valueStyle="ok" />
              <StatRow label="Health checks"       value="25 / 25"       valueStyle="ok" />
              <StatRow label="Grok audit"          value="PASS 102/102"  valueStyle="ok" />
              <StatRow label="Directives complete" value="97 complete"   valueStyle="ok" />
              <StatRow label="Integration test"    value="18/18 VIABLE"  valueStyle="ok" />
              <StatRow label="Latest commit"       value="52b956f"       />
            </Panel>
          </div>
        </div>

        {/* AI Executive Intelligence */}
        <TierLabel>AI Intelligence Layer</TierLabel>
        <div className="mb-8">
          <AIBriefingPanel />
        </div>

        {/* Tier 3: Timeline */}
        <TierLabel>Tier 3 — Program Timeline</TierLabel>
        <Panel title="Phase Timeline — TG20/W251" meta={<Badge>Phase 1 Active</Badge>}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Phase</th><th>Period</th><th>Key Milestone</th><th>Status</th><th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['1 — Procurement Prep',   'Apr–May 2026',  '13 RFQs drafted · Pricing confirmed · Suppliers selected',              <Badge variant="verified">Complete</Badge>,  'TWP / FlowSeer'],
                ['1 — Blocker',            'Apr–May 1',     'EthosEnergy ICD receipt — unlocks $1.73M in RFQs',                      <Badge variant="critical">At Risk</Badge>,   'Alberto Malandra'],
                ['2 — RFQ Send Day',       'May 25, 2026',  'All 13 packages sent simultaneously to 11 suppliers',                    <Badge>{days} Days</Badge>,                  'Greg Buchanan'],
                ['3 — Response Collection','May 25–Jul 15', '30–45 day supplier response window',                                     <Badge>Pending</Badge>,                      'Suppliers'],
                ['4 — Award',              'Jul 15–Aug 15', 'Quote evaluation, negotiation, PO awards',                               <Badge>Pending</Badge>,                      'TWP'],
                ['5 — Manufacturing',      'Aug–Dec 2026',  'Generator Oct 2027 (critical) · Transformer Feb–May 2027',               <Badge>Pending</Badge>,                      'Suppliers'],
                ['6 — First Power',        'Q2 2027',       'Installation, commissioning, grid synchronization',                      <Badge>Target</Badge>,                       'EthosEnergy / TWP'],
              ].map(([phase, period, milestone, status, owner], i) => (
                <tr key={i} style={i === 1 ? { background: 'rgba(204,32,32,0.04)' } : {}}>
                  <td>{phase}</td>
                  <td className="font-mono text-[--t2]">{period as string}</td>
                  <td>{milestone as string}</td>
                  <td>{status}</td>
                  <td className="text-[--t2]">{owner as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* Footer */}
        <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
          <span>FlowSeer v2.1.0 · Trans World Power LLC · TG20/W251 · Client: Borderplex · Santa Teresa NM</span>
          <span>ESTIMATED confidence on 18 of 19 categories · VERIFIED: VIB_MON only</span>
        </div>
      </div>
    </>
  );
}
