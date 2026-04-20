'use client';

interface Milestone {
  label: string;
  date: string;
  status: 'complete' | 'current' | 'upcoming' | 'blocked';
  detail?: string;
}

const MILESTONES: Milestone[] = [
  { label: 'Platform Live', date: 'Apr 11', status: 'complete', detail: 'Dashboard deployed to production' },
  { label: 'BOP Baseline', date: 'Apr 13', status: 'complete', detail: '$9.27M across 19 categories' },
  { label: 'BH VIB_MON Quote', date: 'Apr 15', status: 'complete', detail: '$340K received — first RFQ verified' },
  { label: '5-Agent Pipeline', date: 'Apr 17', status: 'complete', detail: 'Autonomous build system operational' },
  { label: 'Bidirectional Radar', date: 'Apr 20', status: 'current', detail: 'Threat + Incentive Radar pages deployed' },
  { label: 'ICD from EthosEnergy', date: 'May 1', status: 'blocked', detail: 'Overdue — blocks $1.73M in RFQs' },
  { label: 'RFQ Send Day', date: 'May 25', status: 'upcoming', detail: '13 packages to 73 suppliers' },
  { label: 'First Power', date: 'Q2 2027', status: 'upcoming', detail: 'Target commissioning date' },
];

const statusColor: Record<string, string> = {
  complete: '#22C55E', current: '#1E6FCC', upcoming: 'var(--t3)', blocked: '#E83535',
};

export function ProgramTimeline() {
  return (
    <div>
      <div style={{ position: 'relative', paddingLeft: 18 }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 5, top: 4, bottom: 4, width: 1,
          background: 'linear-gradient(to bottom, #22C55E, #1E6FCC, var(--line))',
        }} />

        {MILESTONES.map((m, i) => (
          <div key={i} style={{ position: 'relative', paddingBottom: i < MILESTONES.length - 1 ? 14 : 0 }}>
            {/* Dot */}
            <div style={{
              position: 'absolute', left: -15, top: 3,
              width: 8, height: 8, borderRadius: '50%',
              background: statusColor[m.status],
              border: m.status === 'current' ? '2px solid rgba(30,111,204,0.3)' : 'none',
              boxShadow: m.status === 'blocked' ? '0 0 6px rgba(232,53,53,0.4)' : 'none',
            }} />

            {/* Content */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: m.status === 'complete' ? 'var(--t2)' : m.status === 'blocked' ? '#E83535' : 'var(--t0)',
                  textDecoration: m.status === 'complete' ? 'line-through' : 'none',
                  textDecorationColor: 'var(--t3)',
                }}>
                  {m.label}
                </span>
                {m.detail && (
                  <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 8 }}>{m.detail}</span>
                )}
              </div>
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: 9,
                color: m.status === 'blocked' ? '#E83535' : 'var(--t3)',
                flexShrink: 0, marginLeft: 8,
              }}>
                {m.date}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
