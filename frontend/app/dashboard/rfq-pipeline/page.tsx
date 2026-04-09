'use client';
/**
 * Dashboard D — RFQ Pipeline
 * EQS v1.0. Design tokens throughout. DataState<T> pattern. All 7 UI states handled.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { RfqQueueResponse, RfqQueueItem } from '../../../lib/api/wave9';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';
import { RfqDraftCard } from '../../../components/cards/RfqDraftCard';

function fmtK(n: number) { return n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : `$${(n/1_000).toFixed(0)}K`; }

const SENIORITY_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  c_suite: { bg: 'var(--cyan-dim)',  text: 'var(--cyan)',  border: 'var(--cyan-border)',  label: 'C-SUITE' },
  vp:      { bg: 'var(--green-dim)', text: 'var(--green)', border: 'var(--green-border)', label: 'VP' },
  director:{ bg: 'var(--amber-dim)', text: 'var(--amber)', border: 'var(--amber-border)', label: 'DIR' },
};

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  not_started: { bg: 'rgba(100,116,139,0.08)', text: 'var(--text-tertiary)' },
  draft:       { bg: 'var(--amber-dim)',        text: 'var(--amber)' },
  sent:        { bg: 'var(--cyan-dim)',         text: 'var(--cyan)' },
  replied:     { bg: 'var(--green-dim)',        text: 'var(--green)' },
};

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number | undefined; sub: string; accent?: string }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, color: value !== undefined ? (accent ?? 'var(--cyan)') : 'var(--text-tertiary)', lineHeight: 1, marginBottom: 4 }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  );
}

function ContactRow({ item }: { item: RfqQueueItem }) {
  const sen = SENIORITY_STYLE[item.seniority] ?? SENIORITY_STYLE.director;
  const st  = STATUS_STYLE[item.rfq_status]  ?? STATUS_STYLE.not_started;
  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3, border: `1px solid ${sen.border}`, backgroundColor: sen.bg, color: sen.text }}>
            {sen.label}
          </span>
          <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.contact_name}
          </span>
        </div>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 2 }}>{item.title}</div>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--cyan)' }}>
          {item.supplier_name.slice(0, 40)} · {item.bop_category.replace(/_/g,' ')} · {fmtK(item.category_mid_usd)}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 4 }}>{item.email}</div>
        <span style={{ fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3, backgroundColor: st.bg, color: st.text, textTransform: 'uppercase' }}>
          {item.rfq_status.replace(/_/g, ' ')}
        </span>
      </div>
    </div>
  );
}

export default function RfqPipelinePage() {
  const queueQ = useQuery<DataState<RfqQueueResponse>>({
    queryKey: ['rfq-queue'],
    queryFn: () => apiFetch<RfqQueueResponse>('/wave9/rfq-queue'),
    refetchInterval: 30_000,
  });
  const analysesQ = useQuery<DataState<{ results: Array<{ id:number; analysis_type:string; subject_name:string; model:string; model_cost_usd:string; preview:string }> }>>({
    queryKey: ['claude-results-rfq'],
    queryFn: () => apiFetch('/claude/results?limit=10'),
    refetchInterval: 30_000,
  });

  const queue    = queueQ.data?.data;
  const analyses = analysesQ.data?.data;
  const comparisons = (analyses?.results ?? []).filter(r => r.analysis_type === 'supplier_comparison');
  const totalValue  = (queue?.queue ?? []).reduce((s, q) => s + q.category_mid_usd, 0);
  const uiState  = queueQ.data?.uiState ?? 'loading';

  return (
    <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── COMMAND BAR ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', margin: 0 }}>
            RFQ Pipeline
          </h1>
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Contact outreach · Claude-drafted RFQs · Supplier comparison intelligence · W251 TG20B7-8
          </p>
        </div>
        <OutputBadge outputType="seeded" freshness={queueQ.data?.freshness} />
      </div>

      {/* ── FULL-PAGE STATES ── */}
      {uiState === 'loading'      && <LoadingSkeleton rows={4} height="h-20" />}
      {uiState === 'error'        && <ErrorCard error={queueQ.data?.error ?? 'server_error'} retryCount={queueQ.data?.retryCount} />}
      {uiState === 'awaiting_key' && <DeferredCard capability="RFQ Contact Intelligence" activationRequirement="Wave 9 contact migration and BOP tagging" activatedBy="Run: GET /api/wave9/run-auto-tag then retry" />}
      {uiState === 'empty'        && <EmptyState title="No RFQ targets found" description="No C-Suite or VP contacts with email addresses and BOP category tags have been identified yet." action="Run GET /api/wave9/run-auto-tag to tag contacts" />}

      {(uiState === 'operational' || uiState === 'stale') && (
        <>
          {/* ── KPI BAND ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <KpiCard label="Priority Targets"   value={queue?.total}     sub="C-Suite/VP with email + BOP tag" accent="var(--cyan)" />
            <KpiCard label="Pipeline Value"      value={totalValue ? fmtK(totalValue) : '—'} sub="Category mid estimates — not RFQ" accent="var(--amber)" />
            <KpiCard label="RFQs Drafted"        value={queue?.drafted ?? 0} sub="Claude AI-generated outreach" accent="var(--purple)" />
            <KpiCard label="Sent"                value={queue?.sent ?? 0}    sub="Outreach initiated" accent="var(--green)" />
          </div>

          {/* ── DRAFTED RFQ SURFACE — Block C ── */}
          {(queue?.drafted ?? 0) > 0 && (
            <RfqDraftCard items={queue?.queue ?? []} />
          )}

          {/* ── NEXT ACTION BANNER ── */}
          {queue?.next && (
            <div style={{ backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                ▶ NEXT PRIORITY ACTION
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{queue.next.contact_name}</div>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: 3 }}>{queue.next.title}</div>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cyan)' }}>
                    {queue.next.supplier_name} · {queue.next.bop_category.replace(/_/g,' ')} · {fmtK(queue.next.category_mid_usd)} mid estimate
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 6 }}>{queue.next.email}</div>
                  <code style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--amber)', backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)', padding: '4px 8px', borderRadius: 4 }}>
                    POST /api/wave9/contacts/{queue.next.id}/rfq
                  </code>
                </div>
              </div>
            </div>
          )}

          {/* ── PRIMARY REGION — Two-column: contacts + Claude comparisons ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Contact queue */}
            <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  Priority Contact Queue
                </span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{queue?.total ?? 0} targets</span>
              </div>
              <div>
                {(queue?.queue ?? []).map(item => <ContactRow key={item.id} item={item} />)}
                {!queue?.queue.length && (
                  <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                    <EmptyState title="No contacts in queue" description="No C-Suite or VP contacts with email and BOP category have been identified." />
                  </div>
                )}
              </div>
            </div>

            {/* Claude supplier comparisons */}
            <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  AI Supplier Intelligence
                </span>
                <OutputBadge outputType="generated" freshness={analysesQ.data?.freshness} />
              </div>

              {analysesQ.data?.uiState === 'loading' && <div style={{ padding: 20 }}><LoadingSkeleton rows={3} height="h-16" /></div>}
              {analysesQ.data?.uiState === 'error'   && <div style={{ padding: 20 }}><ErrorCard error={analysesQ.data.error ?? 'server_error'} /></div>}

              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {comparisons.map(r => (
                  <div key={r.id} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3, backgroundColor: 'var(--purple-dim)', border: '1px solid var(--purple-border)', color: 'var(--purple)' }}>
                        AI COMPARISON
                      </span>
                      <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {r.subject_name.replace('Supplier Comparison — ','').replace('Supplier Comparison: ','')}
                      </span>
                      <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                        ${parseFloat(r.model_cost_usd).toFixed(4)}
                      </span>
                    </div>
                    <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0,
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {r.preview}
                    </p>
                  </div>
                ))}
                {!comparisons.length && (
                  <div style={{ padding: 20 }}>
                    <EmptyState
                      title="No comparisons yet"
                      description="Trigger via: GET /api/claude/run-compare-suppliers?category=MV_System"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
