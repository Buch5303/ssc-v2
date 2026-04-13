'use client';

interface StatusPillProps {
  label: string;
  status: string;
  detail?: string;
}

function getStatusStyle(status: string) {
  if (status === 'operational') return { dot: 'bg-emerald-400', text: 'text-emerald-400', border: 'border-emerald-400/20', bg: 'bg-emerald-400/[0.06]' };
  if (status === 'awaiting_key' || status === 'degraded') return { dot: 'bg-amber-400', text: 'text-amber-400', border: 'border-amber-400/20', bg: 'bg-amber-400/[0.06]' };
  if (status === 'partial') return { dot: 'bg-amber-400', text: 'text-amber-400', border: 'border-amber-400/20', bg: 'bg-amber-400/[0.06]' };
  return { dot: 'bg-red-400', text: 'text-red-400', border: 'border-red-400/20', bg: 'bg-red-400/[0.06]' };
}

export function StatusPill({ label, status, detail }: StatusPillProps) {
  const s = getStatusStyle(status);
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${s.border} ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} animate-pulse`} />
      <span className="text-[9px] font-mono text-slate-400 uppercase">{label}</span>
      <span className={`text-[9px] font-mono font-semibold ${s.text} uppercase ml-1`}>{status.replace(/_/g, ' ')}</span>
      {detail && <span className="text-[9px] font-mono text-slate-500 ml-1">· {detail}</span>}
    </div>
  );
}
