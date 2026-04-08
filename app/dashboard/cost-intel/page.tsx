'use client';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { fetchPricingSummary } from '../../../lib/api/discovery';
import { KpiCard } from '../../../components/cards/KpiCard';

function fmtK(n: number) { return `$${(n/1000).toFixed(0)}K`; }
function fmtM(n: number) { return `$${(n/1_000_000).toFixed(3)}M`; }

const CHART_COLORS = ['#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#38bdf8','#93c5fd'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono">
      <div className="text-slate-300 mb-1">{label?.replace(/_/g,' ')}</div>
      <div className="text-red-400">Low: {fmtK(d.low)}</div>
      <div className="text-cyan-400 font-bold">Mid: {fmtK(d.mid)}</div>
      <div className="text-emerald-400">High: {fmtK(d.high)}</div>
    </div>
  );
};

export default function CostIntelPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['pricing-summary'], queryFn: fetchPricingSummary, refetchInterval: 60_000,
  });

  // Aggregate by BOP category
  const categoryMap: Record<string, { low: number; mid: number; high: number }> = {};
  data?.records.forEach((r) => {
    if (!categoryMap[r.bop_category]) categoryMap[r.bop_category] = { low: 0, mid: 0, high: 0 };
    categoryMap[r.bop_category].low  += r.price_low_usd;
    categoryMap[r.bop_category].mid  += r.price_mid_usd;
    categoryMap[r.bop_category].high += r.price_high_usd;
  });

  const chartData = Object.entries(categoryMap)
    .map(([cat, v]) => ({ name: cat.replace(/_/g, ' ').replace('System', 'Sys').replace('Equipment', 'Equip'), ...v }))
    .sort((a, b) => b.mid - a.mid);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-sm font-mono font-bold text-slate-200 uppercase tracking-wider">BOP Cost Intelligence</h1>
        <p className="text-[10px] font-mono text-slate-500 mt-0.5">W251 Power Island — Indicative pricing ±15% · Not RFQ · For budgeting reference</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Total Low"
          value={data ? fmtM(data.total_low_usd) : '—'}
          sub="-15% from mid"
          accent="amber"
          badge="ESTIMATED"
        />
        <KpiCard
          label="Total Mid"
          value={data ? fmtM(data.total_mid_usd) : '—'}
          sub={`${data?.records.length ?? 0} pricing records · ${data?.category_count ?? 0} categories`}
          accent="cyan"
          badge="ESTIMATED"
        />
        <KpiCard
          label="Total High"
          value={data ? fmtM(data.total_high_usd) : '—'}
          sub="+15% from mid"
          accent="green"
          badge="ESTIMATED"
        />
      </div>

      {/* Bar Chart */}
      <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Cost by BOP Category — Mid Estimate</h2>
          <span className="text-[8px] font-mono text-slate-600">● ESTIMATED · WEB RESEARCH</span>
        </div>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-[10px] font-mono text-slate-600">Loading pricing data...</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }}
                angle={-40} textAnchor="end" interval={0}
              />
              <YAxis
                tickFormatter={(v) => `$${(v/1000).toFixed(0)}K`}
                tick={{ fontSize: 8, fontFamily: 'monospace', fill: '#64748b' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="mid" radius={[2,2,0,0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Detail table */}
      <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Pricing Detail</h2>
          <span className="text-[8px] font-mono text-slate-600">{data?.records.length ?? 0} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                {['Category','Sub-category','Low','Mid','High','Lead (wks)'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-[8px] font-mono text-slate-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.records
                .slice()
                .sort((a,b) => b.price_mid_usd - a.price_mid_usd)
                .map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                    <td className="px-4 py-2 text-[9px] font-mono text-cyan-400">{r.bop_category.replace(/_/g,' ')}</td>
                    <td className="px-4 py-2 text-[9px] font-mono text-slate-400 max-w-[200px] truncate">{r.sub_category}</td>
                    <td className="px-4 py-2 text-[9px] font-mono text-amber-400">{fmtK(r.price_low_usd)}</td>
                    <td className="px-4 py-2 text-[9px] font-mono text-cyan-400 font-bold">{fmtK(r.price_mid_usd)}</td>
                    <td className="px-4 py-2 text-[9px] font-mono text-emerald-400">{fmtK(r.price_high_usd)}</td>
                    <td className="px-4 py-2 text-[9px] font-mono text-slate-500">
                      {(r as any).lead_time_weeks_low && `${(r as any).lead_time_weeks_low}–${(r as any).lead_time_weeks_high}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
