'use client';
/**
 * Dashboard D — RFQ Pipeline
 * EQS v1.0. Design tokens throughout. DataState<T> pattern. All 7 UI states handled.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { RfqQueueResponse, RfqQueueItem } from '../../../lib/api/wave9';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';
import { KpiCard } from '../../../components/cards/KpiCard';
import { RfqDraftCard } from '../../../components/cards/RfqDraftCard';
import { RfqDetailPanel } from '../../../components/cards/RfqDetailPanel';
import { AnalysisDetailCard } from '../../../components/cards/AnalysisDetailCard';
import { DecisionStateSummary } from '../../../components/summary/DecisionStateSummary';
import { ReadinessSignal, type ReadinessState } from '../../../components/badges/ReadinessSignal';
import { ActionRouteCard } from '../../../components/cards/ActionRouteCard';
import { ExecSignalBand } from '../../../components/layout/ExecSignalBand';
import { SectionLabel } from '../../../components/layout/SectionLabel';
import { useRouteHighlight } from '../../../lib/hooks/useRouteHighlight';
import { ExecutionContextStore } from '../../../lib/context/ExecutionContextStore';

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
  const analysesQ = useQuery<DataState<{ results: Array<{ id:number; analysis_type:string; subject_name:string; model:string; model_cost_usd:string; preview:string; created_at:string }> }>>({
    queryKey: ['claude-results-rfq'],
    queryFn: () => apiFetch('/claude/results?limit=10'),
    refetchInterval: 30_000,
  });

  // Directive 26D — clear stale context on page mount
  useEffect(() => {
    ExecutionContextStore.clearIfStale('rfq-pipeline');
  }, []);

    const rfqDraftsRef = useRouteHighlight('rfq-drafts', 'rfq-pipeline');
  const rfqQueueRef  = useRouteHighlight('rfq-queue', 'rfq-pipeline');
  const analysisRef  = useRouteHighlight('ai-analysis', 'rfq-pipeline');

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
            W251 BOP outreach pipeline · Claude-drafted RFQs · Supplier contacts
          </p>
        </div>
        <OutputBadge outputType="seeded" freshness={queueQ.data?.freshness} />
      </div>

      {/* ── FULL-PAGE STATES ── */}
      {uiState === 'loading'      && <LoadingSkeleton rows={4} height="h-20" />}
      {uiState === 'error'        && <ErrorCard error={queueQ.data?.error ?? 'server_error'} retryCount={queueQ.data?.retryCount} />}
      {uiState === 'awaiting_key' && <DeferredCard capability="RFQ Contact Intelligence" activationRequirement="Wave 9 contacts tagged to BOP categories" activatedBy="GET /api/wave9/run-auto-tag" />}
      {uiState === 'empty' && <EmptyState title="No targets in pipeline" description="No C-Suite or VP contacts with email and BOP category found." action="GET /api/wave9/run-auto-tag" readiness="NOT STARTED" />}

      {(uiState === 'operational' || uiState === 'stale') && (
        <>
          {/* ── EXEC SIGNAL BAND — Directive 38 Block O ── */}
          <ExecSignalBand
            uiState={uiState}
            signals={[
              {
                state: (queue?.drafted ?? 0) > 0 ? 'do-now' : 'watch',
                label: (queue?.drafted ?? 0) > 0 ? `${queue!.drafted} RFQ Ready — Send Now` : 'No Drafts Yet',
                sublabel: (queue?.drafted ?? 0) > 0 ? 'Baker Hughes · $340K · send now' : 'Draft first RFQ to activate pipeline',
                primary: true,
              },
              {
                state: (queue?.not_started ?? 0) > 0 ? 'at-risk' : 'healthy',
                label: `${queue?.not_started ?? 0} Not Started`,
                sublabel: `of ${queue?.total ?? 0} targets`,
              },
              {
                state: (queue?.sent ?? 0) > 0 ? 'healthy' : 'watch',
                label: `${queue?.sent ?? 0} Sent`,
                sublabel: 'Outreach sent',
              },
            ]}
          />

          {/* ── KPI BAND ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <KpiCard label="Priority Targets"   value={queue?.total}     sub="C-Suite/VP · email + category tag" accent="var(--cyan)" />
            <KpiCard label="Pipeline Value"      value={totalValue ? fmtK(totalValue) : '—'} sub="Mid estimates · not RFQ" accent="var(--amber)" />
            <KpiCard label="RFQs Drafted"        value={queue?.drafted ?? 0} sub="Claude AI · outreach drafted" accent="var(--purple)" />
            <KpiCard label="Sent"                value={queue?.sent ?? 0}    sub="Outreach sent" accent="var(--green)" />
          </div>

          {/* ── DECISION STATE SUMMARY — Directive 22A ── */}
          {(() => {
            const drafted = queue?.drafted ?? 0;
            const notStarted = queue?.not_started ?? 0;
            const analysesReady = comparisons.length;
            return (
              <DecisionStateSummary
                uiState={uiState}
                buckets={{
                  ready: drafted,
                  needsReview: analysesReady,
                  blocked: notStarted > 0 && drafted === 0 ? 1 : 0,
                  nextAction: queue?.next
                    ? `Draft RFQ — ${queue.next.contact_name}, ${queue.next.supplier_name.split('/')[0].trim()}`
                    : drafted > 0 ? 'Send Lorenzo Simonelli RFQ' : 'All actions complete',
                  nextActionEndpoint: queue?.next
                    ? `POST /api/wave9/contacts/${queue.next.id}/rfq`
                    : drafted > 0 ? 'POST /api/wave9/outreach/1/send' : undefined,
                }}
              />
            );
          })()}

                    {/* ── DRAFTED RFQ SURFACE — Block C ── */}
          {(queue?.drafted ?? 0) > 0 && (
            <div ref={rfqDraftsRef} id="rfq-drafts">
              <RfqDraftCard items={queue?.queue ?? []} />
            </div>
          )}

          {/* ── RFQ DETAIL PANELS — Directive 21A ── */}
          {(queue?.drafted ?? 0) > 0 && (() => {
            const drafted = (queue?.queue ?? []).filter(i => i.rfq_status === 'draft' || i.rfq_status === 'sent');
            const rfqAnalyses = (analyses?.results ?? []).filter(r => r.analysis_type === 'rfq_draft');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionLabel mb={6}>Draft Ready — Click to review</SectionLabel>
                {drafted.map(item => {
                  const match = rfqAnalyses.find(r =>
                    r.subject_name.toLowerCase().includes(item.supplier_name.split('/')[0].trim().toLowerCase()) ||
                    r.subject_name.toLowerCase().includes(item.bop_category.toLowerCase())
                  );
                  return (
                    <RfqDetailPanel
                      key={item.id}
                      item={item}
                      draftPreview={match?.preview}
                    />
                  );
                })}
              </div>
            );
          })()}

          {/* ── NEXT ACTION BANNER ── */}
          {queue?.next && (
            <div style={{ backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)', borderRadius: 8, padding: '16px 20px' }}>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                ▶ NEXT TARGET
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
            <div ref={rfqQueueRef} id="rfq-queue" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SectionLabel variant="card" mb={0}>Priority Contact Queue</SectionLabel>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{queue?.total ?? 0} targets</span>
              </div>
              <div>
                {(queue?.queue ?? []).map(item => <ContactRow key={item.id} item={item} />)}
                {!queue?.queue.length && (
                  <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                    <EmptyState title="Queue empty" description="No C-Suite or VP contacts with email and BOP tag found." />
                  </div>
                )}
              </div>
            </div>

            {/* Analysis detail cards — Directive 21B */}
            <div ref={analysisRef} id="ai-analysis" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SectionLabel variant="card" mb={0}>AI Supplier Intelligence</SectionLabel>
                <OutputBadge outputType="generated" freshness={analysesQ.data?.freshness} />
              </div>

              {analysesQ.data?.uiState === 'loading' && <div style={{ padding: '16px 20px' }}><LoadingSkeleton rows={3} height="h-16" /></div>}
              {analysesQ.data?.uiState === 'error'   && <div style={{ padding: '16px 20px' }}><ErrorCard error={analysesQ.data.error ?? 'server_error'} /></div>}

              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 600, overflowY: 'auto' }}>
                {comparisons.map(r => (
                  <AnalysisDetailCard key={r.id} result={r} />
                ))}
                {!comparisons.length && (
                  <EmptyState
                    title="No analyses yet"
                    description="Trigger: GET /api/claude/run-compare-suppliers?category=MV_System"
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
