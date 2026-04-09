'use client';
/**
 * CostRollupChart — governed wrapper for BOP low/mid/high band visualization.
 * Pages NEVER import recharts directly.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { UiState, OutputType, Freshness } from '../../lib/types/ui';
import { LoadingSkeleton, EmptyState } from '../states';

export interface CostItem {
  name: string;
  low: number;
  mid: number;
  high: number;
  items?: number;
  group?: string;
}

interface CostRollupChartProps {
  data: CostItem[];
  title: string;
  uiState: UiState;
  outputType?: OutputType;
  freshness?: Freshness;
  colorByGroup?: Record<string, string>;
  defaultColor?: string;
  height?: number;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{payload: CostItem}> }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const fK = (n: number) => `$${(n/1000).toFixed(0)}K`;
  return (
    <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10 }}>
      <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
      <div style={{ color: 'var(--amber)' }}>Low: {fK(d.low)}</div>
      <div style={{ color: 'var(--cyan)', fontWeight: 700 }}>Mid: {fK(d.mid)}</div>
      <div style={{ color: 'var(--green)' }}>High: {fK(d.high)}</div>
      {d.items && <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>{d.items} line items</div>}
    </div>
  );
};

export function CostRollupChart({
  data, title, uiState, outputType = 'estimated', freshness,
  colorByGroup, defaultColor = '#06b6d4', height = 280,
}: CostRollupChartProps) {
  void outputType; void freshness; // used by parent badge
  const fK = (n: number) => `$${(n/1000).toFixed(0)}K`;

  return (
    <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--badge-estimated-text)', backgroundColor: 'var(--badge-estimated-bg)', border: '1px solid var(--badge-estimated-border)', padding: '2px 6px', borderRadius: 3 }}>
          ESTIMATED · WEB RESEARCH · ±15%
        </span>
      </div>
      {uiState === 'loading' && <LoadingSkeleton rows={5} height="h-5" />}
      {uiState === 'empty' && <EmptyState title="No pricing data" description="Market pricing records not yet seeded." />}
      {uiState === 'error' && <div style={{ padding: 32, textAlign: 'center', fontSize: 9, fontFamily: 'monospace', color: 'var(--red)' }}>Failed to load pricing data</div>}
      {uiState === 'awaiting_key' && <div style={{ padding: 32, textAlign: 'center', fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>Discovery engine not activated</div>}
      {(uiState === 'operational' || uiState === 'stale') && data.length > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} angle={-45} textAnchor="end" interval={0} />
            <YAxis tickFormatter={fK} tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="mid" radius={[2, 2, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i}
                  fill={colorByGroup && entry.group ? (colorByGroup[entry.group] ?? defaultColor) : defaultColor}
                  fillOpacity={uiState === 'stale' ? 0.5 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
