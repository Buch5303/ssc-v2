'use client';
/**
 * ContactCoverageChart — governed wrapper for contacts-by-BOP-category bar chart.
 * Pages NEVER import recharts directly.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { UiState } from '../../lib/types/ui';
import { LoadingSkeleton, EmptyState } from '../states';

export interface CategoryBar {
  name: string;
  contacts: number;
  email: number;
}

interface ContactCoverageChartProps {
  data: CategoryBar[];
  uiState: UiState;
  height?: number;
}

export function ContactCoverageChart({ data, uiState, height = 200 }: ContactCoverageChartProps) {
  return (
    <>
      {uiState === 'loading' && <LoadingSkeleton rows={3} height="h-6" />}
      {uiState === 'empty'   && <EmptyState title="No contact data" description="Wave 9 contact intelligence not yet loaded." />}
      {(uiState === 'operational' || uiState === 'stale') && data.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 7, fontFamily: 'monospace', fill: '#64748b' }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'monospace', fontSize: 9 }} />
              <Bar dataKey="contacts" name="Contacts"   fill="#06b6d4" fillOpacity={0.7} radius={[2,2,0,0]} />
              <Bar dataKey="email"    name="With Email" fill="#10b981" fillOpacity={0.8} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'rgba(6,182,212,0.7)' }} /><span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>Total contacts</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'rgba(16,185,129,0.8)' }} /><span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>With email</span></div>
          </div>
        </>
      )}
    </>
  );
}
