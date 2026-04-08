'use client';
import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../../../lib/api/status';
import { fetchWave9Status } from '../../../lib/api/wave9';
import { fetchClaudeResults } from '../../../lib/api/claude';
import { KpiCard } from '../../../components/cards/KpiCard';
import { StatusPill } from '../../../components/status/StatusPill';

function fmt(n: number) {
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n}`;
}

export default function OverviewPage() {
  const { data: status, isLoading: sLoad } = useQuery({
    queryKey: ['status'], queryFn: fetchStatus, refetchInterval: 30_000,
  });
  const { data: wave9 } = useQuery({
    queryKey: ['wave9-status'], queryFn: fetchWave9Status, refetchInterval: 60_000,
  });
  const { data: analyses } = useQuery({
    queryKey: ['claude-results'], queryFn: () => fetchClaudeResults(5), refetchInterval: 30_000,
  });

  const bop = status?.bop_intelligence;
  const counts = status?.db?.counts || {};

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-mono font-bold text-slate-200 uppercase tracking-wider">Supply Chain Overview</h1>
          <p className="text-[10px] font-mono text-slate-500 mt-0.5">Project Jupiter — TG20B7-8 W251 Power Island · Santa Teresa, NM</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-600">HEAD {status?.head || '—'}</span>
          {!sLoad && (
            <span className="text-[9px] font-mono px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-400">
              DB ONLINE
            </span>
          )}
        </div>
      </div>

      {/* Engine status bar */}
      {status && (
        <div className="flex flex-wrap gap-2">
          <StatusPill label="Discovery" status={status.engines.discovery.status} />
          <StatusPill label="Claude AI" status={status.engines.claude.status} detail={`${status.engines.claude.analyses_run} analyses`} />
          <StatusPill label="Perplexity" status={status.engines.perplexity.status} />
          <StatusPill label="Platform" status={status.db.online ? 'operational' : 'error'} detail="Neon PostgreSQL" />
        </div>
      )}

      {/* BOP KPIs */}
      <div>
        <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3">BOP Program Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="BOP Mid Estimate"
            value={bop ? fmt(bop.bop_total_mid_usd) : '—'}
            sub="±15% from mid"
            accent="cyan"
            badge="ESTIMATED"
          />
          <KpiCard
            label="Suppliers in DB"
            value={bop?.suppliers_in_db ?? '—'}
            sub={`${bop?.bop_categories_priced ?? 0} BOP categories`}
            accent="green"
          />
          <KpiCard
            label="Pricing Records"
            value={bop?.pricing_records ?? '—'}
            sub="All categories priced"
            accent="cyan"
          />
          <KpiCard
            label="Claude Analyses"
            value={status?.engines.claude.analyses_run ?? '—'}
            sub="Live AI intelligence"
            accent="green"
          />
        </div>
      </div>

      {/* Contact intelligence */}
      <div>
        <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3">Contact Intelligence</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total Contacts" value={wave9?.contacts.total ?? '—'} sub="W251 supplier intelligence" />
          <KpiCard label="BOP-Tagged" value={wave9?.contacts.tagged ?? '—'} sub="Mapped to BOP categories" accent="cyan" />
          <KpiCard label="With Email" value={wave9?.contacts.with_email ?? '—'} sub="Reachable contacts" accent="green" />
          <KpiCard label="C-Suite" value={wave9?.contacts.c_suite ?? '—'} sub="Executive-level" accent="amber" />
        </div>
      </div>

      {/* Recent Claude analyses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Recent AI Intelligence</h2>
          <span className="text-[8px] font-mono text-slate-600">● GENERATED_ANALYSIS</span>
        </div>
        <div className="space-y-2">
          {analyses?.results.map((r) => (
            <div key={r.id} className="bg-[#0f1524] border border-white/[0.06] rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[9px] font-mono px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded text-cyan-400 uppercase">
                  {r.analysis_type.replace(/_/g, ' ')}
                </span>
                <span className="text-[9px] font-mono text-slate-400 flex-1 truncate">{r.subject_name}</span>
                <span className="text-[9px] font-mono text-slate-600">{r.model} · ${parseFloat(r.model_cost_usd).toFixed(4)}</span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 leading-relaxed line-clamp-2">{r.preview}</p>
            </div>
          ))}
          {!analyses?.results.length && (
            <div className="text-[10px] font-mono text-slate-600 text-center py-8 border border-white/[0.04] rounded-lg">
              No analyses yet — trigger via API
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
