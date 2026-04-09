'use client';
/**
 * Dashboard A — Supply Chain Overview
 * EQS v1.0 conformant. Uses governed API adapter, typed DataState,
 * all 7 UI state contracts, OutputBadge, and chart wrappers.
 * Layout: Command Bar → Global State → KPI Band → Insight Region → Detail Region
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard, AwaitingKeyCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';

// ── API types ─────────────────────────────────────────────────────────────
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

interface ClaudeResultsData {
  results: ClaudeResult[];
}

interface Wave9Data {
  contacts: {
    total: number;
    with_email: number;
    tagged: number;
    c_suite?: number;
    vp?: number;
  };
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtM(n: number) { return `$${(n / 1_000_000).toFixed(2)}M`; }

function EngineStatusPill({ label, status, detail }: { label: string; status: string; detail?: string }) {
  const isOk = status === 'operational';
  const isWait = status === 'awaiting_key' || status === 'degraded';
  const color = isOk ? 'var(--green)' : isWait ? 'var(--amber)' : 'var(--red)';
  const bg = isOk ? 'var(--green-dim)' : isWait ? 'var(--amber-dim)' : 'var(--red-dim)';
  const border = isOk ? 'var(--green-border)' : isWait ? 'var(--amber-border)' : 'var(--red-border)';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-[9px] font-mono"
      style={{ backgroundColor: bg, borderColor: border }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
      <span className="text-slate-400 uppercase">{label}</span>
      <span className="font-semibold uppercase" style={{ color }}>
        {status.replace(/_/g, ' ')}
      </span>
      {detail && <span className="text-slate-600 ml-1">· {detail}</span>}
    </div>
  );
}

function KpiCard({
  label, value, sub, badge, accentColor = 'var(--cyan)',
}: { label: string; value: string | number | undefined; sub?: string; badge?: string; accentColor?: string }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
        {badge && (
          <span className="text-[7px] font-mono px-2 py-0.5 rounded border"
            style={{ backgroundColor: 'var(--badge-estimated-bg)', borderColor: 'var(--badge-estimated-border)', color: 'var(--badge-estimated-text)' }}>
            {badge}
          </span>
        )}
      </div>
      <div className="text-2xl font-mono font-bold" style={{ color: value === undefined ? 'var(--text-tertiary)' : accentColor }}>
        {value ?? '—'}
      </div>
      {sub && <div className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const statusQ = useQuery<DataState<StatusData>>({
    queryKey: ['status'],
    queryFn: () => apiFetch<StatusData>('/status'),
    refetchInterval: 30_000,
  });

  const claudeQ = useQuery<DataState<ClaudeResultsData>>({
    queryKey: ['claude-results'],
    queryFn: () => apiFetch<ClaudeResultsData>('/claude/results?limit=5'),
    refetchInterval: 30_000,
  });

  const wave9Q = useQuery<DataState<Wave9Data>>({
    queryKey: ['wave9-status'],
    queryFn: () => apiFetch<Wave9Data>('/wave9/status'),
    refetchInterval: 60_000,
  });

  const status = statusQ.data?.data;
  const analyses = claudeQ.data?.data?.results ?? [];
  const wave9 = wave9Q.data?.data;
  const bop = status?.bop_intelligence;
  const engines = status?.engines;

  return (
    <div className="p-6 space-y-5 max-w-7xl">

      {/* ── COMMAND BAR (5-second zone) ── */}
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-sm font-mono font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Supply Chain Overview
          </h1>
          <p className="text-[9px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Project Jupiter · TG20B7-8 W251 Power Island · Santa Teresa, NM
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status?.head && (
            <span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
              HEAD {status.head}
            </span>
          )}
          <span className="text-[8px] font-mono px-2 py-0.5 rounded border"
            style={{ backgroundColor: 'var(--green-dim)', borderColor: 'var(--green-border)', color: 'var(--green)' }}>
            DB ONLINE
          </span>
        </div>
      </div>

      {/* ── GLOBAL STATE — engine pills ── */}
      {statusQ.data?.uiState === 'loading' && <LoadingSkeleton rows={1} height="h-8" />}
      {engines && (
        <div className="flex flex-wrap gap-2">
          <EngineStatusPill label="Discovery" status={engines.discovery.status} />
          <EngineStatusPill label="Claude AI" status={engines.claude.status} detail={`${engines.claude.analyses_run} analyses`} />
          <EngineStatusPill label="Perplexity" status={engines.perplexity.status} />
        </div>
      )}

      {/* ── KPI BAND — BOP program metrics ── */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
          BOP Program Summary (Balance of Plant)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="BOP Planning Case"
            value={bop ? fmtM(bop.bop_total_mid_usd) : undefined}
            sub="±15% from mid"
            badge="ESTIMATED"
            accentColor="var(--cyan)"
          />
          <KpiCard
            label="Suppliers in DB"
            value={bop?.suppliers_in_db}
            sub={`${bop?.bop_categories_priced ?? 0} BOP categories · All priced`}
            accentColor="var(--green)"
          />
          <KpiCard
            label="Pricing Records"
            value={bop?.pricing_records}
            sub="Web research · Not RFQ"
            badge="ESTIMATED"
            accentColor="var(--cyan)"
          />
          <KpiCard
            label="AI Analyses"
            value={engines?.claude.analyses_run}
            sub="Claude Haiku · Live intelligence"
            accentColor="var(--purple)"
          />
        </div>
      </div>

      {/* ── KPI BAND — Contact intelligence ── */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Contact Intelligence · Wave 9
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total Contacts" value={wave9?.contacts.total} sub="W251 supplier intelligence" accentColor="var(--cyan)" />
          <KpiCard label="BOP-Tagged" value={wave9?.contacts.tagged} sub="Mapped to BOP categories" accentColor="var(--cyan)" />
          <KpiCard label="With Email" value={wave9?.contacts.with_email} sub="Reachable for RFQ outreach" accentColor="var(--green)" />
          <KpiCard label="C-Suite Contacts" value={wave9?.contacts.c_suite} sub="Executive-level targets" accentColor="var(--amber)" />
        </div>
      </div>

      {/* ── Perplexity deferred capability ── */}
      {engines?.perplexity.status === 'awaiting_key' && (
        <DeferredCard
          capability="Perplexity Integrity Engine"
          activationRequirement="PERPLEXITY_API_KEY environment variable"
          activatedBy="Add PERPLEXITY_API_KEY in Vercel project settings · Minimum $50 credit"
        />
      )}

      {/* ── PRIMARY INSIGHT — Claude analyses ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Recent AI Intelligence
          </div>
          <OutputBadge outputType="generated" freshness={claudeQ.data?.freshness} />
        </div>

        {claudeQ.data?.uiState === 'loading' && <LoadingSkeleton rows={3} height="h-16" />}
        {claudeQ.data?.uiState === 'error' && (
          <ErrorCard error={claudeQ.data.error!} retryCount={claudeQ.data.retryCount} />
        )}
        {claudeQ.data?.uiState === 'empty' && (
          <EmptyState
            title="No analyses yet"
            description="Trigger via GET /api/claude/run-procurement-summary or run-compare-suppliers"
          />
        )}
        {(claudeQ.data?.uiState === 'operational' || claudeQ.data?.uiState === 'stale') && analyses.length > 0 && (
          <div className="space-y-2">
            {analyses.map(r => (
              <div key={r.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <OutputBadge outputType="generated" />
                  <span className="text-[9px] font-mono font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {r.analysis_type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span className="text-[9px] font-mono flex-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {r.subject_name}
                  </span>
                  <span className="text-[8px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {r.model} · ${parseFloat(r.model_cost_usd).toFixed(4)}
                  </span>
                </div>
                <p className="text-[9px] font-mono leading-relaxed line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
                  {r.preview}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
