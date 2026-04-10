'use client';
/**
 * Dashboard A — Supply Chain Overview
 * EQS v1.0 — 5-second command layer. Zero-training labels.
 * All design tokens. DataState<T> pattern. All 7 UI states.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard, PartialState } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';
import { DecisionStateSummary } from '../../../components/summary/DecisionStateSummary';
import { ReadinessSignal } from '../../../components/badges/ReadinessSignal';
import { ActionRouteCard } from '../../../components/cards/ActionRouteCard';

interface StatusData {
  platform: string;
  head: string;
  engines: {
    discovery: { status: string };
    claude: { status: string; model: string; analyses_run: number };
    perplexity: { status: string; checks_run: number };
  };
  bop_intelligence: {
    suppliers_in_db: number;
    pricing_records: number;
    bop_total_mid_usd: number;
    bop_categories_priced: number;
  };
  wave9_readiness: {
    contacts_in_db: number;
    outreach_records: number;
    apollo_upgrade_required: boolean;
  };
}

interface ClaudeResult {
  id: number;
  analysis_type: string;
  subject_name: string;
  model: string;
  model_cost_usd: string;
  created_at: string;
  preview: string;
}

interface Wave9Data {
  contacts: { total: number; with_email: number; tagged: number; c_suite?: number; vp?: number };
  status: string;
}

function fmtM(n: number) { return `$${(n/1_000_000).toFixed(2)}M`; }

function EngineStatusPill({ label, status, detail }: { label: string; status: string; detail?: string }) {
  const isOk   = status === 'operational';
  const isWait = status === 'awaiting_key' || status === 'degraded';
  const color  = isOk ? 'var(--green)' : isWait ? 'var(--amber)' : 'var(--red)';
  const bg     = isOk ? 'var(--green-dim)' : isWait ? 'var(--amber-dim)' : 'var(--red-dim)';
  const border = isOk ? 'var(--green-border)' : isWait ? 'var(--amber-border)' : 'var(--red-border)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 6, border: `1px solid ${border}`, backgroundColor: bg }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', fontWeight: 600, color }}>{status.replace(/_/g,' ')}</span>
      {detail && <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>· {detail}</span>}
    </div>
  );
}

function KpiCard({ label, value, sub, badge, accent }: { label: string; value: string | number | undefined; sub?: string; badge?: string; accent?: string }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</span>
        {badge && (
          <span style={{ fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--badge-estimated-border)', backgroundColor: 'var(--badge-estimated-bg)', color: 'var(--badge-estimated-text)' }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1, marginBottom: 4, color: value !== undefined ? (accent ?? 'var(--cyan)') : 'var(--text-tertiary)' }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const statusQ = useQuery<DataState<StatusData>>({
    queryKey: ['status'],
    queryFn: () => apiFetch<StatusData>('/status'),
    refetchInterval: 30_000,
  });
  const claudeQ = useQuery<DataState<{ results: ClaudeResult[] }>>({
    queryKey: ['claude-results'],
    queryFn: () => apiFetch<{ results: ClaudeResult[] }>('/claude/results?limit=5'),
    refetchInterval: 30_000,
  });
  const wave9Q = useQuery<DataState<Wave9Data>>({
    queryKey: ['wave9-status'],
    queryFn: () => apiFetch<Wave9Data>('/wave9/status'),
    refetchInterval: 60_000,
  });

  const status   = statusQ.data?.data;
  const engines  = status?.engines;
  const bop      = status?.bop_intelligence;
  const wave9    = wave9Q.data?.data;
  const analyses = claudeQ.data?.data?.results ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── COMMAND BAR (5-second zone top) ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', margin: 0 }}>
            Supply Chain Overview
          </h1>
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Project Jupiter · TG20B7-8 W251 Power Island · Santa Teresa, NM · 50 MW Gas Turbine BOP Procurement
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {status?.head && (
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>HEAD {status.head}</span>
          )}
          <span style={{ fontSize: 8, fontFamily: 'monospace', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--green-border)', backgroundColor: 'var(--green-dim)', color: 'var(--green)' }}>
            DB ONLINE
          </span>
        </div>
      </div>

      {/* ── GLOBAL STATE — engine pills ── */}
      {statusQ.data?.uiState === 'loading' && <LoadingSkeleton rows={1} height="h-8" />}
      {statusQ.data?.uiState === 'error'   && <ErrorCard error={statusQ.data.error ?? 'server_error'} />}
      {engines && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <EngineStatusPill label="Discovery Engine" status={engines.discovery.status} />
          <EngineStatusPill label="Claude AI"        status={engines.claude.status}    detail={`${engines.claude.analyses_run} analyses run`} />
          <EngineStatusPill label="Perplexity"       status={engines.perplexity.status} />
        </div>
      )}

      {/* ── ACTION ROUTES — Directive 24B ── */}
      {engines && (
        <ActionRouteCard
          uiState={statusQ.data?.uiState ?? 'loading'}
          routes={[
            {
              title: 'Send RFQ draft to Baker Hughes',
              whyItMatters: '$340K Vibration Monitoring — Claude-drafted RFQ is sitting unsent. Lorenzo Simonelli (Chairman & CEO) is primed. Pipeline stalls until this fires.',
              readiness: 'READY TO SEND',
              executionPath: 'Execute send endpoint — draft reviewed and ready',
              endpoint: 'POST /api/wave9/outreach/1/send',
              href: '/dashboard/rfq-pipeline#rfq-drafts',
              outputType: 'generated',
            },
            {
              title: 'Add Perplexity API key to unlock VERIFIED badge tier',
              whyItMatters: '41 pricing records are ESTIMATED. Perplexity upgrades to VERIFIED — improves sourcing confidence.',
              readiness: engines.perplexity.status === 'awaiting_key' ? 'BLOCKED' : 'COMPLETE',
              blocker: engines.perplexity.status === 'awaiting_key' ? 'Missing PERPLEXITY_API_KEY in Vercel environment variables' : undefined,
              executionPath: 'Add PERPLEXITY_API_KEY in Vercel project settings → min $50 credit',
              href: '/dashboard/cost-intel#cost-verification',
              outputType: 'estimated',
            },
            {
              title: 'Draft RFQ — Tod Carpenter, Donaldson CEO',
              whyItMatters: '$480K Inlet Air Filtering — highest-value undrafted target.',
              readiness: 'NOT STARTED',
              executionPath: 'Fire Claude RFQ draft — takes under 30 seconds',
              endpoint: 'POST /api/wave9/contacts/10/rfq',
              href: '/dashboard/rfq-pipeline#rfq-queue',
              outputType: 'seeded',
            },
          ]}
        />
      )}

      {/* ── DECISION STATE SUMMARY — Directive 23 ── */}
      {engines && (
        <DecisionStateSummary
          uiState={statusQ.data?.uiState ?? 'loading'}
          buckets={{
            ready: engines.claude.analyses_run > 0 ? 1 : 0,
            needsReview: engines.perplexity.status === 'awaiting_key' ? 1 : 0,
            blocked: engines.discovery.status !== 'operational' ? 1 : 0,
            nextAction: engines.perplexity.status === 'awaiting_key'
              ? 'Add Perplexity API key to unlock VERIFIED badge tier'
              : engines.claude.analyses_run < 19
                ? 'Run remaining BOP category analyses'
                : 'Send Lorenzo Simonelli RFQ — draft is ready',
            nextActionEndpoint: engines.perplexity.status === 'awaiting_key'
              ? undefined
              : engines.claude.analyses_run < 19
                ? 'GET /api/claude/run-compare-suppliers?category=X'
                : 'POST /api/wave9/outreach/1/send',
          }}
        />
      )}

      {/* ── KPI BAND — BOP program metrics ── */}
      <div>
        <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          BOP Program Summary (Balance of Plant — excludes GT flange-to-flange, generator, OEM controls)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <KpiCard label="BOP Planning Case"   value={bop ? fmtM(bop.bop_total_mid_usd) : undefined} sub="±15% range · Web research · Not RFQ" badge="ESTIMATED" accent="var(--cyan)" />
          <KpiCard label="Suppliers in DB"     value={bop?.suppliers_in_db}        sub={`${bop?.bop_categories_priced ?? 0} BOP categories · All priced`} accent="var(--green)" />
          <KpiCard label="Pricing Records"     value={bop?.pricing_records}         sub="Web research · Indicative only" badge="ESTIMATED" accent="var(--cyan)" />
          <KpiCard label="AI Analyses Run"     value={engines?.claude.analyses_run} sub="Claude Haiku · Live intelligence" accent="var(--purple)" />
        </div>
      </div>

      {/* ── KPI BAND — Contact intelligence ── */}
      <div>
        <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Wave 9 Contact Intelligence
        </div>
        {wave9Q.data?.uiState === 'loading' && <LoadingSkeleton rows={1} height="h-24" />}
        {(wave9Q.data?.uiState === 'operational' || wave9Q.data?.uiState === 'stale') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <KpiCard label="Total Contacts"  value={wave9?.contacts.total}      sub="W251 supplier intelligence" accent="var(--cyan)" />
            <KpiCard label="BOP-Tagged"      value={wave9?.contacts.tagged}     sub="Mapped to BOP categories" accent="var(--cyan)" />
            <KpiCard label="With Email"      value={wave9?.contacts.with_email} sub="Reachable for RFQ outreach" accent="var(--green)" />
            <KpiCard label="C-Suite"         value={wave9?.contacts.c_suite}    sub="CEO / CTO / COO / President" accent="var(--amber)" />
          </div>
        )}
        {wave9Q.data?.uiState === 'empty' && <EmptyState title="No contacts loaded" description="Wave 9 contact migration has not run." />}
      </div>

      {/* ── Perplexity deferred capability ── */}
      {engines?.perplexity.status === 'awaiting_key' && (
        <DeferredCard
          capability="Perplexity Integrity Engine — External Market Verification"
          activationRequirement="PERPLEXITY_API_KEY in Vercel environment variables"
          activatedBy="Add PERPLEXITY_API_KEY in Vercel project settings · Min $50 credit · Unlocks VERIFIED badge tier"
        />
      )}

      {/* ── PRIMARY INSIGHT — Recent Claude analyses ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            Recent AI Procurement Intelligence
          </div>
          <OutputBadge outputType="generated" freshness={claudeQ.data?.freshness} />
        </div>

        {claudeQ.data?.uiState === 'loading' && <LoadingSkeleton rows={3} height="h-16" />}
        {claudeQ.data?.uiState === 'error'   && <ErrorCard error={claudeQ.data.error ?? 'server_error'} />}
        {claudeQ.data?.uiState === 'empty' && (
          <EmptyState
            title="No AI analyses run yet"
            description="Claude intelligence is operational but no supplier comparisons or RFQ drafts have been triggered. All 19 BOP categories are awaiting analysis."
            action="GET /api/claude/run-compare-suppliers?category=MV_System"
            readiness="NOT STARTED"
          />
        )}

        {(claudeQ.data?.uiState === 'operational' || claudeQ.data?.uiState === 'stale') && analyses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {analyses.map(r => {
              const isComp = r.analysis_type === 'supplier_comparison';
              const isRfq  = r.analysis_type === 'rfq_draft';
              const readiness = isRfq ? 'READY TO SEND' : isComp ? 'READY FOR REVIEW' : 'COMPLETE';
              return (
                <div key={r.id} style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <OutputBadge outputType="generated" />
                    <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {r.analysis_type.replace(/_/g,' ').toUpperCase()}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.subject_name}
                    </span>
                    <ReadinessSignal state={readiness} compact />
                  </div>
                  <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {r.preview}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
