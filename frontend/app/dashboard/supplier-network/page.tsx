'use client';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { TierStats, TierStat } from '../../../lib/api/discovery';
import type { Wave9ContactsByCategory, Wave9ContactsBySeniority, CategoryStat, SeniorityStat } from '../../../lib/api/wave9';
import { LoadingSkeleton, EmptyState, ErrorCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';

interface StatusBop {
  bop_intelligence: { suppliers_in_db: number; pricing_records: number; bop_total_mid_usd: number; bop_categories_priced: number };
  engines: { discovery: { status: string } };
}

const TIER_META: Record<number, { label: string; color: string }> = {
  1: { label: 'T1 OEM / Major', color: '#06b6d4' },
  2: { label: 'T2 Specialist',  color: '#10b981' },
  3: { label: 'T3 Regional',    color: '#f59e0b' },
  4: { label: 'T4 Niche',       color: '#ef4444' },
};

const PieTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{payload: {label: string; count: number}}>}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono">
      <div className="text-slate-300">{d.label}</div>
      <div className="text-cyan-400 font-bold mt-1">{d.count} suppliers</div>
    </div>
  );
};

function KpiCard({ label, value, sub }: { label: string; value: string | number | undefined; sub: string }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
      <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <div className="text-xl font-mono font-bold" style={{ color: value !== undefined ? 'var(--cyan)' : 'var(--text-tertiary)' }}>
        {value ?? '—'}
      </div>
      <div className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  );
}

export default function SupplierNetworkPage() {
  const statusQ  = useQuery<DataState<StatusBop>>({ queryKey: ['status'], queryFn: () => apiFetch<StatusBop>('/status'), refetchInterval: 60_000 });
  const tiersQ   = useQuery<DataState<TierStats>>({ queryKey: ['tier-stats'], queryFn: () => apiFetch<TierStats>('/discovery/tier-stats'), refetchInterval: 120_000 });
  const catQ     = useQuery<DataState<Wave9ContactsByCategory>>({ queryKey: ['wave9-by-category'], queryFn: () => apiFetch<Wave9ContactsByCategory>('/wave9/contacts/by-category'), refetchInterval: 120_000 });
  const senQ     = useQuery<DataState<Wave9ContactsBySeniority>>({ queryKey: ['wave9-by-seniority'], queryFn: () => apiFetch<Wave9ContactsBySeniority>('/wave9/contacts/by-seniority'), refetchInterval: 120_000 });

  const bop      = statusQ.data?.data?.bop_intelligence;
  const tiers    = tiersQ.data?.data;
  const byCategory  = catQ.data?.data;
  const bySeniority = senQ.data?.data;

  const pieData = (tiers?.tier_distribution ?? []).map((t: TierStat) => ({
    tier: t.tier, count: t.count,
    label: TIER_META[t.tier]?.label ?? `Tier ${t.tier}`,
    fill:  TIER_META[t.tier]?.color ?? '#64748b',
  }));

  const catData = (byCategory?.categories ?? []).slice(0, 12).map((c: CategoryStat) => ({
    name: c.category.replace(/_/g,' ').replace('System','Sys').replace('Equipment','Eq').replace('Monitoring','Mon'),
    contacts: c.contacts, email: c.with_email,
  }));

  const isLoading = statusQ.data?.uiState === 'loading' || tiersQ.data?.uiState === 'loading';
  const hasError  = statusQ.data?.uiState === 'error' && tiersQ.data?.uiState === 'error';

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-sm font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Supplier Network</h1>
          <p className="text-[9px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            BOP supply chain coverage · Tier distribution · Contact intelligence
          </p>
        </div>
        <OutputBadge outputType="seeded" freshness={tiersQ.data?.freshness} />
      </div>

      {isLoading && <LoadingSkeleton rows={4} height="h-20" />}
      {hasError  && <ErrorCard error={statusQ.data?.error ?? 'server_error'} />}

      {!isLoading && !hasError && (
        <>
          {/* KPI band */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Suppliers in DB"    value={bop?.suppliers_in_db}        sub="Neon PostgreSQL" />
            <KpiCard label="BOP Categories"     value={bop?.bop_categories_priced}  sub="All priced" />
            <KpiCard label="Tier 1 OEM"         value={pieData.find((p: {tier:number;count:number;label:string;fill:string}) => p.tier === 1)?.count} sub="Global industrial leaders" />
            <KpiCard label="In Memory"          value={81}                           sub="Discovery engine" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tier pie */}
            <div className="rounded-lg p-5" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
              <h2 className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Supplier Tier Distribution</h2>
              {tiersQ.data?.uiState === 'empty'
                ? <EmptyState title="No tier data" description="Supplier tier seeding has not run." />
                : (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={pieData} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                          {pieData.map((entry: {tier:number;count:number;label:string;fill:string}, i: number) => (
                            <Cell key={i} fill={entry.fill} fillOpacity={0.85} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {pieData.map((entry: {tier:number;count:number;label:string;fill:string}) => (
                        <div key={entry.tier} className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                          <span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{entry.label} ({entry.count})</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
            </div>

            {/* Seniority breakdown */}
            <div className="rounded-lg p-5" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
              <h2 className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Contact Seniority</h2>
              {senQ.data?.uiState === 'loading' && <LoadingSkeleton rows={4} height="h-5" />}
              {senQ.data?.uiState === 'empty'   && <EmptyState title="No contacts" description="Wave 9 contact intelligence not yet loaded." />}
              {(senQ.data?.uiState === 'operational' || senQ.data?.uiState === 'stale') && (
                <div className="space-y-3 mt-2">
                  {(bySeniority?.by_seniority ?? []).map((s: SeniorityStat) => {
                    const total = bySeniority?.by_seniority.reduce((acc: number, x: SeniorityStat) => acc + x.contacts, 0) ?? 1;
                    const pct = Math.round((s.contacts / total) * 100);
                    const color = s.seniority === 'c_suite' ? '#06b6d4' : s.seniority === 'vp' ? '#10b981' : s.seniority === 'director' ? '#f59e0b' : '#64748b';
                    return (
                      <div key={s.seniority} className="flex items-center gap-3">
                        <div className="w-20 text-[9px] font-mono capitalize" style={{ color: 'var(--text-tertiary)' }}>{s.seniority.replace('_',' ')}</div>
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <div className="w-8 text-right text-[9px] font-mono font-bold" style={{ color }}>{s.contacts}</div>
                        {s.with_email > 0 && <span className="text-[8px] font-mono text-emerald-400">✉ {s.with_email}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Contacts by BOP category bar chart */}
          {catData.length > 0 && (
            <div className="rounded-lg p-5" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
              <h2 className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Contacts by BOP Category</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={catData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" tick={{ fontSize: 7, fontFamily: 'monospace', fill: '#64748b' }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a2236', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'monospace', fontSize: 9 }} />
                  <Bar dataKey="contacts" name="Contacts"   fill="#06b6d4" fillOpacity={0.7} radius={[2,2,0,0]} />
                  <Bar dataKey="email"    name="With Email" fill="#10b981" fillOpacity={0.8} radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-cyan-400/70" /><span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>Total contacts</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-400/80" /><span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>With email</span></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
