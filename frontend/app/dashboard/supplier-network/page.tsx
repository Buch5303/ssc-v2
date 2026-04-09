'use client';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';


import { KpiCard } from '../../../components/cards/KpiCard';

const TIER_COLORS = { 1: '#06b6d4', 2: '#10b981', 3: '#f59e0b', 4: '#ef4444' };
const TIER_LABELS = { 1: 'T1 OEM / Major', 2: 'T2 Specialist', 3: 'T3 Regional', 4: 'T4 Niche' };

const CustomPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono">
      <div className="text-slate-300">{d.label}</div>
      <div className="text-cyan-400 font-bold mt-1">{d.count} suppliers</div>
    </div>
  );
};

export default function SupplierNetworkPage() {
  const statusQ = useQuery({ queryKey: ['status'], queryFn: () => apiFetch<any>('/status'), refetchInterval: 60_000 });
  const status = statusQ.data?.data;
  const tiersQ = useQuery({ queryKey: ['tier-stats'], queryFn: () => apiFetch<any>('/discovery/tier-stats'), refetchInterval: 120_000 });
  const tiers = tiersQ.data?.data;
  const byCategoryQ = useQuery({ queryKey: ['wave9-by-category'], queryFn: () => apiFetch<any>('/wave9/contacts/by-category'), refetchInterval: 120_000 });
  const byCategory = byCategoryQ.data?.data;
  const bySeniorityQ = useQuery({ queryKey: ['wave9-by-seniority'], queryFn: () => apiFetch<any>('/wave9/contacts/by-seniority'), refetchInterval: 120_000 });
  const bySeniority = bySeniorityQ.data?.data;

  const bop = status?.bop_intelligence;

  const pieData = (tiers?.tier_distribution || []).map((t:{tier:number;count:number}) => ({
    tier: t.tier,
    count: t.count,
    label: TIER_LABELS[t.tier as keyof typeof TIER_LABELS] || `Tier ${t.tier}`,
    fill: TIER_COLORS[t.tier as keyof typeof TIER_COLORS] || '#64748b',
  }));

  const catData = (byCategory?.categories || []).slice(0, 12).map((c: {category:string;contacts:number;with_email:number}) => ({
    name: c.category.replace(/_/g,' ').replace('System','Sys').replace('Equipment','Eq').replace('Monitoring','Mon'),
    contacts: c.contacts,
    email: c.with_email,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-sm font-mono font-bold text-slate-200 uppercase tracking-wider">Supplier Network</h1>
        <p className="text-[10px] font-mono text-slate-500 mt-0.5">BOP supply chain coverage · Tier distribution · Contact intelligence</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Suppliers" value={bop?.suppliers_in_db ?? '—'} sub="73 in Neon DB" accent="cyan" />
        <KpiCard label="In Memory" value={81} sub="Across 19 BOP categories" accent="green" />
        <KpiCard label="BOP Categories" value={bop?.bop_categories_priced ?? '—'} sub="All priced" accent="cyan" />
        <KpiCard label="Tier 1 OEM" value={pieData.find((p:{tier:number;count:number;label:string;fill:string})=>p.tier===1)?.count ?? '—'} sub="Global industrial leaders" accent="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tier distribution pie */}
        <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-4">Supplier Tier Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                {pieData.map((entry:{tier:number;count:number;label:string;fill:string}, i:number) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={0.85} />
                ))}
              </Pie>
              <Tooltip content={<CustomPieTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-2">
            {pieData.map((entry:{tier:number;count:number;label:string;fill:string}) => (
              <div key={entry.tier} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                <span className="text-[8px] font-mono text-slate-400">{entry.label} ({entry.count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contact seniority */}
        <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-4">Contact Seniority · 231 Total</h2>
          <div className="space-y-2 mt-4">
            {(bySeniority?.by_seniority || []).map((s: {seniority:string;contacts:number;with_email:number;bop_tagged:number}) => {
              const pct = Math.round((s.contacts / 231) * 100);
              const color = s.seniority === 'c_suite' ? '#06b6d4' : s.seniority === 'vp' ? '#10b981' : s.seniority === 'director' ? '#f59e0b' : '#64748b';
              return (
                <div key={s.seniority} className="flex items-center gap-3">
                  <div className="w-20 text-[9px] font-mono text-slate-400 capitalize">{s.seniority.replace('_',' ')}</div>
                  <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <div className="w-8 text-right text-[9px] font-mono" style={{ color }}>{s.contacts}</div>
                  {s.with_email > 0 && (
                    <span className="text-[8px] font-mono text-emerald-400">✉ {s.with_email}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Contacts by BOP category */}
      {catData.length > 0 && (
        <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-4">Contacts by BOP Category</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={catData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 7, fontFamily: 'monospace', fill: '#64748b' }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }} />
              <Tooltip contentStyle={{ backgroundColor: '#1a2236', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'monospace', fontSize: 9 }} />
              <Bar dataKey="contacts" name="Contacts" fill="#06b6d4" fillOpacity={0.7} radius={[2,2,0,0]} />
              <Bar dataKey="email" name="With Email" fill="#10b981" fillOpacity={0.8} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-cyan-400/70" /><span className="text-[8px] font-mono text-slate-500">Total contacts</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-400/80" /><span className="text-[8px] font-mono text-slate-500">With email</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
