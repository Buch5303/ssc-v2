'use client';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { fetchPricingSummary } from '../../../lib/api/discovery';
import { KpiCard } from '../../../components/cards/KpiCard';

function fmtK(n: number) { return `$${(n/1000).toFixed(0)}K`; }
function fmtM(n: number) { return `$${(n/1_000_000).toFixed(3)}M`; }

const GROUP_COLORS: Record<string, string> = {
  Mechanical:'#06b6d4',Electrical:'#10b981',Fuel:'#f59e0b',
  Safety:'#ef4444',Instrumentation:'#8b5cf6',Unknown:'#64748b',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a2236] border border-white/10 rounded-lg p-3 text-[10px] font-mono space-y-0.5">
      <div className="text-slate-300 mb-1 font-semibold">{d.name}</div>
      <div className="text-amber-400">Low: {fmtK(d.low)}</div>
      <div className="text-cyan-400 font-bold">Mid: {fmtK(d.mid)}</div>
      <div className="text-emerald-400">High: {fmtK(d.high)}</div>
      <div className="text-slate-500 mt-1">{d.items} line items</div>
    </div>
  );
};

export default function CostIntelPage() {
  const { data, isLoading } = useQuery({
    queryKey:['pricing-summary'], queryFn:fetchPricingSummary, refetchInterval:60_000,
  });
  const s = data?.summary;
  const chartData = (data?.by_category||[])
    .map(c=>({ name:c.category_name.replace(' System','').replace(' Package','').replace(' Equipment',''),
      low:c.total_low_usd, mid:c.total_mid_usd, high:c.total_high_usd, items:c.item_count, group:c.group }))
    .sort((a,b)=>b.mid-a.mid);
  const groupData = (data?.by_group||[]).filter(g=>g.group!=='Unknown').sort((a,b)=>b.total_mid-a.total_mid);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-sm font-mono font-bold text-slate-200 uppercase tracking-wider">BOP Cost Intelligence</h1>
        <p className="text-[10px] font-mono text-slate-500 mt-0.5">W251 Power Island · Indicative ±15% · Web research · Not RFQ</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Budget Floor" value={s?fmtM(s.bop_total_low_usd):'—'} sub="-15% from mid" accent="amber" badge="ESTIMATED"/>
        <KpiCard label="Planning Case" value={s?fmtM(s.bop_total_mid_usd):'—'} sub={`${s?.pricing_records??0} records · ${s?.categories_priced??0} categories`} accent="cyan" badge="ESTIMATED"/>
        <KpiCard label="Budget Ceiling" value={s?fmtM(s.bop_total_high_usd):'—'} sub="+15% from mid" accent="green" badge="ESTIMATED"/>
      </div>
      {groupData.length>0&&(
        <div>
          <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3">By System Group</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {groupData.map(g=>(
              <div key={g.group} className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor:GROUP_COLORS[g.group]||'#64748b'}}/>
                  <span className="text-[9px] font-mono text-slate-500">{g.group}</span>
                </div>
                <div className="text-[15px] font-mono font-bold" style={{color:GROUP_COLORS[g.group]||'#64748b'}}>{fmtK(g.total_mid)}</div>
                <div className="text-[8px] font-mono text-slate-600 mt-0.5">{g.categories.length} cats</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Mid Estimate by Category</h2>
          <span className="text-[8px] font-mono text-slate-600">● ESTIMATED · ±15%</span>
        </div>
        {isLoading?(
          <div className="h-64 flex items-center justify-center text-[10px] font-mono text-slate-600">Loading...</div>
        ):(
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{top:4,right:8,left:8,bottom:70}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="name" tick={{fontSize:8,fontFamily:'monospace',fill:'#64748b'}} angle={-45} textAnchor="end" interval={0}/>
              <YAxis tickFormatter={fmtK} tick={{fontSize:8,fontFamily:'monospace',fill:'#64748b'}}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Bar dataKey="mid" radius={[2,2,0,0]}>
                {chartData.map((entry,i)=>(<Cell key={i} fill={GROUP_COLORS[entry.group]||'#64748b'} fillOpacity={0.8}/>))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Category Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-white/[0.04]">
              {['Category','Group','Low','Mid','High','Items'].map(h=>(
                <th key={h} className="px-4 py-2 text-left text-[8px] font-mono text-slate-600 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {chartData.map((r,i)=>(
                <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.01]">
                  <td className="px-4 py-2 text-[9px] font-mono text-slate-300">{r.name}</td>
                  <td className="px-4 py-2"><span className="text-[7px] font-mono px-1.5 py-0.5 rounded"
                    style={{backgroundColor:(GROUP_COLORS[r.group]||'#64748b')+'20',color:GROUP_COLORS[r.group]||'#64748b'}}>{r.group}</span></td>
                  <td className="px-4 py-2 text-[9px] font-mono text-amber-400">{fmtK(r.low)}</td>
                  <td className="px-4 py-2 text-[9px] font-mono text-cyan-400 font-bold">{fmtK(r.mid)}</td>
                  <td className="px-4 py-2 text-[9px] font-mono text-emerald-400">{fmtK(r.high)}</td>
                  <td className="px-4 py-2 text-[9px] font-mono text-slate-600">{r.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
