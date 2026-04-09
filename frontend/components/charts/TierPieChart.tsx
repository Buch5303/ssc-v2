'use client';
/**
 * TierPieChart — governed wrapper for supplier tier distribution ring chart.
 * Pages NEVER import recharts directly.
 */
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { UiState } from '../../lib/types/ui';
import { LoadingSkeleton, EmptyState } from '../states';

export interface TierSlice {
  tier: number;
  count: number;
  label: string;
  fill: string;
}

interface TierPieChartProps {
  data: TierSlice[];
  uiState: UiState;
  height?: number;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{payload: TierSlice}> }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10 }}>
      <div style={{ color: 'var(--text-secondary)' }}>{d.label}</div>
      <div style={{ color: 'var(--cyan)', fontWeight: 700, marginTop: 2 }}>{d.count} suppliers</div>
    </div>
  );
};

export function TierPieChart({ data, uiState, height = 200 }: TierPieChartProps) {
  return (
    <>
      {uiState === 'loading' && <LoadingSkeleton rows={3} height="h-6" />}
      {uiState === 'empty'   && <EmptyState title="No tier data" description="Supplier tier seeding has not run." />}
      {(uiState === 'operational' || uiState === 'stale') && (
        <>
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                {data.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={uiState === 'stale' ? 0.5 : 0.85} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {data.map(entry => (
              <div key={entry.tier} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: entry.fill }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{entry.label} ({entry.count})</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
