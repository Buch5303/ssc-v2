'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';

import { KpiCard } from '../../../components/cards/KpiCard';
import type { RfqQueueResponse, CategoryStat } from '../../../lib/api/wave9';

function fmtK(n: number) { return n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : `$${(n/1000).toFixed(0)}K`; }

const seniorityBadge: Record<string, { bg: string; text: string; label: string }> = {
  c_suite: { bg: 'bg-cyan-500/10 border-cyan-500/20', text: 'text-cyan-400', label: 'C-SUITE' },
  vp:      { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: 'VP' },
  director:{ bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400', label: 'DIR' },
};

const statusBadge: Record<string, { bg: string; text: string }> = {
  not_started: { bg: 'bg-slate-500/10', text: 'text-slate-500' },
  draft:       { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  sent:        { bg: 'bg-cyan-500/10',  text: 'text-cyan-400' },
  replied:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
};

export default function RfqPipelinePage() {
  const queueQ = useQuery<DataState<RfqQueueResponse>>({ queryKey: ['rfq-queue'], queryFn: () => apiFetch<RfqQueueResponse>('/wave9/rfq-queue'), refetchInterval: 30_000 });
  const queue = queueQ.data?.data;
  const analysesQ = useQuery<DataState<{results: Array<{id:number;analysis_type:string;subject_name:string;model:string;model_cost_usd:string;preview:string}>}>>({ queryKey: ['claude-results-rfq'], queryFn: () => apiFetch('/claude/results?limit=10'), refetchInterval: 30_000 });
  const analyses = analysesQ.data?.data;

  const comparisons = (analyses?.results ?? []).filter(r => r.analysis_type === 'supplier_comparison') || [];
  const totalValue = (queue?.queue || []).reduce((s, q) => s + q.category_mid_usd, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-sm font-mono font-bold text-slate-200 uppercase tracking-wider">RFQ Pipeline</h1>
        <p className="text-[10px] font-mono text-slate-500 mt-0.5">Contact outreach · Claude-drafted RFQs · Supplier comparison intelligence</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Priority Targets" value={queue?.total ?? '—'} sub="C-Suite/VP with email + BOP" accent="cyan" />
        <KpiCard label="Pipeline Value" value={totalValue ? fmtK(totalValue) : '—'} sub="Category mid estimates" accent="amber" badge="ESTIMATED" />
        <KpiCard label="RFQs Drafted" value={queue?.drafted ?? 0} sub="Claude-generated" accent="green" />
        <KpiCard label="Sent" value={queue?.sent ?? 0} sub="Outreach initiated" accent="green" />
      </div>

      {/* Next action banner */}
      {queue?.next && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-4">
          <div className="text-[9px] font-mono text-cyan-400 uppercase tracking-wider mb-2">▶ NEXT PRIORITY ACTION</div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[11px] font-mono text-slate-200 font-semibold">{queue.next.contact_name}</div>
              <div className="text-[9px] font-mono text-slate-400 mt-0.5">{queue.next.title}</div>
              <div className="text-[9px] font-mono text-cyan-400 mt-0.5">{queue.next.supplier_name} · {queue.next.bop_category.replace(/_/g,' ')} · {fmtK(queue.next.category_mid_usd)}</div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-mono text-slate-600 mb-1">{queue.next.email}</div>
              <code className="text-[8px] font-mono text-amber-400 bg-amber-500/5 border border-amber-500/10 px-2 py-1 rounded">
                POST /api/wave9/contacts/{queue.next.id}/rfq
              </code>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact queue */}
        <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Contact Queue</h2>
            <span className="text-[8px] font-mono text-slate-600">{queue?.total ?? 0} targets</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {(queue?.queue || []).map((item) => {
              const sen = seniorityBadge[item.seniority] || seniorityBadge.director;
              const st = statusBadge[item.rfq_status] || statusBadge.not_started;
              return (
                <div key={item.id} className="px-5 py-3 hover:bg-white/[0.01]">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[7px] font-mono px-1.5 py-0.5 rounded border ${sen.bg} ${sen.text}`}>{sen.label}</span>
                        <span className="text-[9px] font-mono text-slate-300 font-medium truncate">{item.contact_name}</span>
                      </div>
                      <div className="text-[8px] font-mono text-slate-500 truncate">{item.title}</div>
                      <div className="text-[8px] font-mono text-cyan-400 mt-0.5">{item.supplier_name.slice(0,35)} · {fmtK(item.category_mid_usd)}</div>
                    </div>
                    <span className={`text-[7px] font-mono px-2 py-0.5 rounded ${st.bg} ${st.text} uppercase whitespace-nowrap`}>
                      {item.rfq_status.replace(/_/g,' ')}
                    </span>
                  </div>
                </div>
              );
            })}
            {!queue?.queue.length && (
              <div className="px-5 py-8 text-center text-[10px] font-mono text-slate-600">No contacts in RFQ queue</div>
            )}
          </div>
        </div>

        {/* Supplier comparison intelligence */}
        <div className="bg-[#0f1524] border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Claude Supplier Comparisons</h2>
            <span className="text-[8px] font-mono text-slate-600">{comparisons.length} analyses</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {comparisons.map((r) => (
              <div key={r.id} className="px-5 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[8px] font-mono px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-purple-400">AI COMPARISON</span>
                  <span className="text-[9px] font-mono text-slate-300">{r.subject_name.replace('Supplier Comparison — ','')}</span>
                  <span className="text-[8px] font-mono text-slate-600 ml-auto">${parseFloat(r.model_cost_usd).toFixed(4)}</span>
                </div>
                <p className="text-[9px] font-mono text-slate-500 leading-relaxed line-clamp-3">{r.preview}</p>
              </div>
            ))}
            {!comparisons.length && (
              <div className="px-5 py-8 text-center text-[10px] font-mono text-slate-600">
                No comparisons yet — trigger via /api/claude/run-compare-suppliers?category=X
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
