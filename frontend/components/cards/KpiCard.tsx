'use client';

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'cyan' | 'green' | 'amber' | 'red';
  badge?: string;
}

const accentColors = {
  cyan:  'text-cyan-400',
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red:   'text-red-400',
};

export function KpiCard({ label, value, sub, accent = 'cyan', badge }: KpiCardProps) {
  return (
    <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{label}</span>
        {badge && (
          <span className="text-[8px] font-mono px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded text-cyan-400">{badge}</span>
        )}
      </div>
      <div className={`text-2xl font-mono font-bold ${accentColors[accent]}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-slate-500">{sub}</div>}
    </div>
  );
}
