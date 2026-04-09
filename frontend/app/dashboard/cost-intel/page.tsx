'use client';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { PricingSummary, PricingCategory, PricingGroup } from '../../../lib/api/discovery';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';

function fmtK(n: number) { return `$${(n/1000).toFixed(0)}K`; }
function fmtM(n: number) { return `$${(n/1_000_000).toFixed(3)}M`; }

const GROUP_COLORS: Record<string, string> = {
  Mechanical:'#06b6d4', Electrical:'#10b981', Fuel:'#f59e0b',
  Safety:'#ef4444', Instrumentation:'#8b5cf6', Unknown:'#64748b',
};

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{value: number; payload: {name: string; low: number; mid: number; high: number; items: number}}>}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono space-y-0.5">
      <div className="text-slate-300 font-semibold mb-1">{d.name}</div>
      <div className="text-amber-400">Low: {fmtK(d.low)}</div>
      <div className="text-cyan-400 font-bold">Mid: {fmtK(d.mid)}</div>
      <div className="text-emerald-400">High: {fmtK(d.high)}</div>
      <div className="text-slate-500 mt-1">{d.items} line items</div>
    </div>
  );
};

function KpiCard({ label, value, sub, badge }: { label: string; value: string; sub: string; badge?: string }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
        {badge && <span className="text-[7px] font-mono px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--badge-estimated-bg)', borderColor: 'var(--badge-estimated-border)', color: 'var(--badge-estimated-text)' }}>{badge}</span>}
      </div>
      <div className="text-xl font-mono font-bold" style={{ color: 'var(--cyan)' }}>{value}</div>
      <div className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  );
}

export default function CostIntelPage() {
  const stateQ = useQuery<DataState<PricingSummary>>({
    queryKey: ['pricing-summary'],
    queryFn: () => apiFetch<PricingSummary>('/discovery/pricing/summary'),
    refetchInterval: 60_000,
  });

  const uiState = stateQ.data?.uiState ?? 'loading';
  const data = stateQ.data?.data;
  const s = data?.summary;

  const chartData = (data?.by_category ?? [])
    .map((c: PricingCategory) => ({
      name: c.category_name.replace(' System','').replace(' Package','').replace(' Equipment',''),
      low: c.total_low_usd, mid: c.total_mid_usd, high: c.total_high_usd,
      items: c.item_count, group: c.group,
    }))
    .sort((a, b) => b.mid - a.mid);

  const groupData = (data?.by_group ?? [])
    .filter((g: PricingGroup) => g.group !== 'Unknown')
    .sort((a: PricingGroup, b: PricingGroup) => b.total_mid - a.total_mid);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-sm font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            BOP Cost Intelligence
          </h1>
          <p className="text-[9px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            W251 Power Island · Indicative pricing ±15% · Web research · Not RFQ · For budgeting reference only
          </p>
        </div>
        <OutputBadge outputType="estimated" freshness={stateQ.data?.freshness} />
      </div>

      {/* Full-page states */}
      {uiState === 'loading' && (
        <div className="space-y-4">
          <LoadingSkeleton rows={1} height="h-24" />
          <LoadingSkeleton rows={4} height="h-6" />
          <LoadingSkeleton rows={6} height="h-4" />
        </div>
      )}
      {uiState === 'error' && (
        <ErrorCard error={stateQ.data?.error ?? 'server_error'} retryCount={stateQ.data?.retryCount} />
      )}
      {uiState === 'awaiting_key' && (
        <DeferredCard capability="BOP Pricing Intelligence" activationRequirement="Discovery engine operational with seeded market pricing data" />
      )}
      {uiState === 'empty' && (
        <EmptyState title="No pricing data" description="Market pricing records have not been seeded. Run discovery seeding to populate." />
      )}

      {/* Data views — operational and stale both render data */}
      {(uiState === 'operational' || uiState === 'stale') && (
        <>
          {/* KPI band */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Budget Floor" value={s ? fmtM(s.bop_total_low_usd) : '—'} sub="-15% from mid" badge="ESTIMATED" />
            <KpiCard label="Planning Case" value={s ? fmtM(s.bop_total_mid_usd) : '—'} sub={`${s?.pricing_records ?? 0} records · ${s?.categories_priced ?? 0} categories`} badge="ESTIMATED" />
            <KpiCard label="Budget Ceiling" value={s ? fmtM(s.bop_total_high_usd) : '—'} sub="+15% from mid" badge="ESTIMATED" />
          </div>

          {/* Group tiles */}
          {groupData.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>By System Group</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {groupData.map((g: PricingGroup) => (
                  <div key={g.group} className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: GROUP_COLORS[g.group] ?? '#64748b' }} />
                      <span className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{g.group}</span>
                    </div>
                    <div className="text-[15px] font-mono font-bold" style={{ color: GROUP_COLORS[g.group] ?? '#64748b' }}>{fmtK(g.total_mid)}</div>
                    <div className="text-[8px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{g.categories.length} cats</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bar chart */}
          <div className="rounded-lg p-5" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Mid Estimate by Category</span>
              <span className="text-[7px] font-mono" style={{ color: 'var(--text-tertiary)' }}>ESTIMATED · WEB RESEARCH · ±15%</span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} angle={-45} textAnchor="end" interval={0} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="mid" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={GROUP_COLORS[entry.group] ?? '#64748b'} fillOpacity={uiState === 'stale' ? 0.5 : 0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detail table */}
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Category Detail</span>
              <span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{chartData.length} categories</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {['Category','Group','Low','Mid','High','Items'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-[8px] font-mono uppercase" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-white/[0.01]" style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
                      <td className="px-4 py-2 text-[9px] font-mono" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                      <td className="px-4 py-2">
                        <span className="text-[7px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: (GROUP_COLORS[r.group] ?? '#64748b') + '20', color: GROUP_COLORS[r.group] ?? '#64748b' }}>{r.group}</span>
                      </td>
                      <td className="px-4 py-2 text-[9px] font-mono text-amber-400">{fmtK(r.low)}</td>
                      <td className="px-4 py-2 text-[9px] font-mono text-cyan-400 font-bold">{fmtK(r.mid)}</td>
                      <td className="px-4 py-2 text-[9px] font-mono text-emerald-400">{fmtK(r.high)}</td>
                      <td className="px-4 py-2 text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{r.items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
