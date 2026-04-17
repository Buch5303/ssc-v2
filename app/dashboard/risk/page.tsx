'use client';
import { TierLabel } from '../../../components/ui/TierLabel';
import { RiskMatrixPanel } from '../../../components/ui/RiskMatrixPanel';
import { ICDTracker } from '../../../components/ui/ICDTracker';
import { Panel } from '../../../components/ui/Panel';
import { Badge } from '../../../components/ui/Badge';
import { StatRow } from '../../../components/ui/StatRow';

const CRITICAL_PATH_ITEMS = [
  { item: 'Generator (GE Vernova / Siemens)', lead: '40–56 wk', value: '$2.09M', status: 'RFQ Ready', risk: 'Binding constraint' },
  { item: 'Main Power Transformer', lead: '52–70 wk', value: '$760K', status: 'Blocked by ICD', risk: 'Longest absolute lead time' },
  { item: 'Exhaust & Silencing', lead: '28–36 wk', value: '$431K', status: 'Blocked by ICD', risk: 'Needs turbine exhaust specs' },
  { item: 'Electrical Distribution', lead: '24–32 wk', value: '$535K', status: 'Blocked by ICD', risk: 'Switchgear/MCC sizing' },
  { item: 'HRSG / Heat Recovery', lead: '26–34 wk', value: '$1.15M', status: 'RFQ Ready', risk: 'Custom engineering' },
  { item: 'Control System / DCS', lead: '20–28 wk', value: '$590K', status: 'RFQ Ready', risk: 'Integration complexity' },
];

const SUPPLIER_FLAGS = [
  { supplier: 'Trillium Flow Technologies', flag: 'AVOID', reason: 'Disqualified — replaced by Flowserve', category: 'Piping & Valves', action: 'Complete — no further action' },
  { supplier: 'EthosEnergy Italia', flag: 'BLOCKER', reason: 'ICD overdue — blocking 3 packages worth $1.73M', category: 'Turbine Interface', action: 'Escalate to Alberto Malandra + Todd Dunlop' },
  { supplier: 'Baker Hughes', flag: 'DECISION', reason: 'Quoted $340K vs $268K estimate (+26.7%)', category: 'Vibration Monitoring', action: 'Accept / negotiate / rebid before May 1' },
];

export default function RiskPage() {
  return (
    <div className="p-6 max-w-[1400px]">
      <TierLabel>Supply Chain Risk Assessment</TierLabel>

      {/* ICD Tracker — top priority */}
      <div className="mb-6">
        <ICDTracker />
      </div>

      {/* Risk Matrix */}
      <div className="mb-6">
        <RiskMatrixPanel />
      </div>

      {/* Critical Path */}
      <TierLabel>Critical Path Analysis</TierLabel>
      <Panel title="Long-Lead Equipment" meta={<Badge variant="warning">Schedule Risk</Badge>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' as const, padding: '6px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Equipment</th>
              <th style={{ textAlign: 'right' as const, padding: '6px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Lead Time</th>
              <th style={{ textAlign: 'right' as const, padding: '6px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Value</th>
              <th style={{ textAlign: 'center' as const, padding: '6px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Status</th>
              <th style={{ textAlign: 'left' as const, padding: '6px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {CRITICAL_PATH_ITEMS.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '8px 0', fontSize: 12, fontWeight: 500, color: 'var(--t0)' }}>{item.item}</td>
                <td style={{ padding: '8px 0', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t1)', textAlign: 'right' as const }}>{item.lead}</td>
                <td style={{ padding: '8px 0', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t1)', textAlign: 'right' as const }}>{item.value}</td>
                <td style={{ padding: '8px 0', textAlign: 'center' as const }}>
                  <Badge variant={item.status.includes('Blocked') ? 'critical' : 'pending'}>{item.status}</Badge>
                </td>
                <td style={{ padding: '8px 0', fontSize: 10, color: 'var(--t2)' }}>{item.risk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Supplier Flags */}
      <div className="mt-6">
        <TierLabel>Supplier Flags & Alerts</TierLabel>
        <Panel title="Active Supplier Issues" meta={<Badge variant="critical">{SUPPLIER_FLAGS.length} Active</Badge>}>
          {SUPPLIER_FLAGS.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < SUPPLIER_FLAGS.length - 1 ? '1px solid var(--line)' : 'none', alignItems: 'start' }}>
              <Badge variant={s.flag === 'AVOID' ? 'critical' : s.flag === 'BLOCKER' ? 'critical' : 'warning'}>{s.flag}</Badge>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{s.supplier}</div>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>{s.reason}</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>Category: {s.category}</div>
              </div>
              <div style={{ fontSize: 10, color: '#1E6FCC', maxWidth: 200 }}>→ {s.action}</div>
            </div>
          ))}
        </Panel>
      </div>

      {/* Footer */}
      <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
        <span>FlowSeer v2.2.0 · Trans World Power LLC · TG20/W251 · Client: Borderplex · Santa Teresa NM</span>
        <span>AI Risk Assessment powered by Claude · EQS v1.0 Compliant</span>
      </div>
    </div>
  );
}
