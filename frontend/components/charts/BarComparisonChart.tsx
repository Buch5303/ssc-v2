'use client';
/**
 * BarComparisonChart — governed wrapper over Recharts BarChart.
 * Pages NEVER import from 'recharts' directly.
 * This wrapper owns: colors, tooltips, axes, empty states, stale overlays.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { UiState, OutputType, Freshness } from '../../lib/types/ui';
import { LoadingSkeleton, EmptyState } from '../states';

export interface BarItem {
  name: string;
  value: number;
  group?: string;
}

interface BarComparisonChartProps {
  data: BarItem[];
  title: string;
  uiState: UiState;
  outputType?: OutputType;
  freshness?: Freshness;
  emptyMessage?: string;
  colorByGroup?: Record<string, string>;
  defaultColor?: string;
  height?: number;
  tickFormatter?: (v: number) => string;
  xAngle?: number;
  xPaddingBottom?: number;
}

const DEFAULT_COLORS = [
  '#06b6d4','#10b981','#f59e0b','#8b5cf6','#ef4444',
  '#3b82f6','#ec4899','#14b8a6','#a3e635','#fb923c',
];

const CustomTooltip = ({ active, payload, tickFormatter }: any) => {
  if (!active || !payload?.length) return null;
  const fmt = tickFormatter ?? ((v: number) => `$${(v/1000).toFixed(0)}K`);
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono">
      <div className="text-slate-300 font-semibold mb-1">{payload[0].payload.name}</div>
      <div className="text-cyan-400">{fmt(payload[0].value)}</div>
    </div>
  );
};

export function BarComparisonChart({
  data, title, uiState, outputType = 'derived', freshness,
  emptyMessage = 'No data available', colorByGroup, defaultColor = '#06b6d4',
  height = 260, tickFormatter, xAngle = -40, xPaddingBottom = 60,
}: BarComparisonChartProps) {
  const fmt = tickFormatter ?? ((v: number) => `$${(v/1000).toFixed(0)}K`);

  return (
    <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
        {outputType === 'estimated' && (
          <span className="text-[7px] font-mono px-2 py-0.5 rounded border bg-[var(--badge-estimated-bg)] border-[var(--badge-estimated-border)] text-[var(--badge-estimated-text)]">
            ESTIMATED · WEB RESEARCH · ±15%
          </span>
        )}
      </div>

      {uiState === 'loading' && <LoadingSkeleton rows={4} height="h-6" />}
      {uiState === 'empty' && <EmptyState title="No data" description={emptyMessage} />}
      {(uiState === 'operational' || uiState === 'stale') && data.length > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: xPaddingBottom }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }}
              angle={xAngle} textAnchor="end" interval={0}
            />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
            <Tooltip content={<CustomTooltip tickFormatter={fmt} />} />
            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    colorByGroup && entry.group
                      ? (colorByGroup[entry.group] ?? defaultColor)
                      : DEFAULT_COLORS[i % DEFAULT_COLORS.length]
                  }
                  fillOpacity={uiState === 'stale' ? 0.5 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {uiState === 'error' && (
        <div className="py-8 text-center text-[9px] font-mono text-red-400">Failed to load chart data</div>
      )}
      {uiState === 'awaiting_key' && (
        <div className="py-8 text-center text-[9px] font-mono text-slate-500">Engine not activated</div>
      )}
    </div>
  );
}
