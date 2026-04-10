'use client';
/**
 * Dashboard B — BOP Cost Intelligence
 * EQS v1.0. No raw Recharts. All charts via governed wrappers.
 * Zero-training labels. Estimated badges on all pricing.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { PricingSummary, PricingCategory, PricingGroup } from '../../../lib/api/discovery';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';
import { CostRollupChart } from '../../../components/charts/CostRollupChart';
import { RangeKpiCard } from '../../../components/cards/RangeKpiCard';
import { SectionLabel } from '../../../components/layout/SectionLabel';
import { ExecSignalBand } from '../../../components/layout/ExecSignalBand';
import { DecisionStateSummary } from '../../../components/summary/DecisionStateSummary';
import { ReadinessSignal } from '../../../components/badges/ReadinessSignal';
import { ActionRouteCard } from '../../../components/cards/ActionRouteCard';
import { useRouteHighlight } from '../../../lib/hooks/useRouteHighlight';
import { ExecutionContextStore } from '../../../lib/context/ExecutionContextStore';

function fmtM(n: number) { return `$${(n/1_000_000).toFixed(3)}M`; }
function fmtK(n: number) { return `$${(n/1_000).toFixed(0)}K`; }

const GROUP_COLORS: Record<string, string> = {
  Mechanical:'#06b6d4', Electrical:'#10b981', Fuel:'#f59e0b',
  Safety:'#ef4444', Instrumentation:'#8b5cf6', Unknown:'#64748b',
};

export default function CostIntelPage() {
  const stateQ = useQuery<DataState<PricingSummary>>({
    queryKey: ['pricing-summary'],
    queryFn: () => apiFetch<PricingSummary>('/discovery/pricing/summary'),
    refetchInterval: 60_000,
  });

  // Directive 26D — clear stale context on page mount
  useEffect(() => {
    ExecutionContextStore.clearIfStale('cost-intel');
  }, []);

    const verificationRef = useRouteHighlight('cost-verification', 'cost-intel');
  const categoryRef     = useRouteHighlight('category-table', 'cost-intel');

  const uiState = stateQ.data?.uiState ?? 'loading';
  const data    = stateQ.data?.data;
  const s       = data?.summary;

  const chartData = (data?.by_category ?? [])
    .map((c: PricingCategory) => ({
      name:  c.category_name.replace(' System','').replace(' Package','').replace(' Equipment',''),
      low:   c.total_low_usd,
      mid:   c.total_mid_usd,
      high:  c.total_high_usd,
      items: c.item_count,
      group: c.group,
    }))
    .sort((a, b) => b.mid - a.mid);

  const groupData = (data?.by_group ?? [])
    .filter((g: PricingGroup) => g.group !== 'Unknown')
    .sort((a: PricingGroup, b: PricingGroup) => b.total_mid - a.total_mid);

  return (
    <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── COMMAND BAR ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', margin: 0 }}>
            BOP Cost Intelligence
          </h1>
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            W251 Power Island · Web-researched pricing · Not RFQ · Budget reference only
          </p>
        </div>
        <OutputBadge outputType="estimated" freshness={stateQ.data?.freshness} />
      </div>

      {/* ── FULL-PAGE STATES ── */}
      {uiState === 'loading'      && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><LoadingSkeleton rows={1} height="h-24" /><LoadingSkeleton rows={5} height="h-5" /></div>}
      {uiState === 'error'        && <ErrorCard error={stateQ.data?.error ?? 'server_error'} retryCount={stateQ.data?.retryCount} />}
      {uiState === 'awaiting_key' && <DeferredCard capability="BOP Pricing Intelligence" activationRequirement="Discovery engine with seeded market pricing data" />}
      {uiState === 'empty' && <EmptyState title="No pricing records" description="Discovery engine not yet seeded. BOP cost intelligence unavailable." readiness="NOT STARTED" action="Run discovery seeding" />}

      {/* ── OPERATIONAL SURFACE ── */}
      {(uiState === 'operational' || uiState === 'stale') && (
        <>
          {/* ── EXEC SIGNAL BAND — Directive 38 Block O ── */}
          <ExecSignalBand
            uiState={uiState}
            signals={[
              {
                state: 'watch',
                label: s ? `$${(s.bop_total_mid_usd / 1_000_000).toFixed(2)}M Planning Case` : 'Loading…',
                sublabel: 'Balance of Plant · mid-case estimate · ±15%',
                primary: true,
              },
              {
                state: 'at-risk',
                label: 'All Pricing ESTIMATED',
                sublabel: 'No RFQ responses received yet · ±15% accuracy',
              },
              {
                state: 'do-now',
                label: 'Trillium: CRITICAL AVOID',
                sublabel: 'Piping & Valves · $37M revenue risk · review before RFQ',
              },
            ]}
          />

          {/* ── DECISION STATE SUMMARY — Directive 23 ── */}
          <DecisionStateSummary
            uiState={uiState}
            buckets={{
              ready: (s?.categories_priced ?? 0),
              needsReview: (s?.pricing_records ?? 0) > 0 ? 1 : 0,
              blocked: 0,
              nextAction: 'Issue RFQs to convert estimated pricing to verified — start with Vibration Monitoring ($340K) and Piping & Valves ($500K)',
              nextActionEndpoint: 'POST /api/wave9/contacts/4/rfq',
            }}
          />

          {/* ── ACTION ROUTES — Directive 24B ── */}
          <ActionRouteCard
            uiState={uiState}
            routes={[
              {
                title: 'Review estimated pricing before RFQ conversion',
                whyItMatters: '41 records are ESTIMATED ±15%. Validate mid-points before RFQ — anchoring risk.',
                readiness: 'READY FOR REVIEW',
                executionPath: 'Review category table below',
                outputType: 'estimated',
              },
              {
                title: 'Convert Vibration Monitoring ($340K) to RFQ pricing',
                whyItMatters: 'BH RFQ draft ready. Response converts Vibration Monitoring from ESTIMATED → VERIFIED.',
                readiness: 'READY TO SEND',
                executionPath: 'Send RFQ → pricing converts on response',
                endpoint: 'POST /api/wave9/outreach/1/send',
                outputType: 'estimated',
              },
              {
                title: 'Validate comparison output before sourcing Piping & Valves ($500K)',
                whyItMatters: 'Trillium flagged CRITICAL AVOID. Confirm Flowserve vs CIRCOR before sourcing.',
                readiness: 'NEEDS REVIEW' as import('../../../components/badges/ReadinessSignal').ReadinessState,
                executionPath: 'RFQ Pipeline → Piping & Valves card → review risk flags',
                outputType: 'generated',
              },
            ]}
          />

          {/* 5-second KPI band — budget floor / planning case / ceiling */}
          <div ref={verificationRef} id="cost-verification">
            <SectionLabel>Program Budget Range · {s?.pricing_records ?? 0} records · {s?.categories_priced ?? 0} BOP <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', fontWeight: 400 }}>(Balance of Plant)</span> categories</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <RangeKpiCard label="Budget Floor"    mid={s ? fmtM(s.bop_total_low_usd) : '—'} low="—" high="—" showRange={false} sub="-15% downside · floor scenario" badge="ESTIMATED · ±15%" />
              <RangeKpiCard label="Planning Case"   low={s ? fmtM(s.bop_total_low_usd) : '—'} mid={s ? fmtM(s.bop_total_mid_usd) : '—'} high={s ? fmtM(s.bop_total_high_usd) : '—'} sub="Mid-case · use for initial budgeting" />
              <RangeKpiCard label="Budget Ceiling"  mid={s ? fmtM(s.bop_total_high_usd) : '—'} low="—" high="—" showRange={false} sub="+15% upside · ceiling scenario" badge="ESTIMATED · ±15%" />
            </div>
          </div>

          {/* Group tiles */}
          {groupData.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
                Cost by System Group (Balance of Plant scope only — excludes GT, generator, OEM control system)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {groupData.map((g: PricingGroup) => (
                  <div key={g.group} style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: GROUP_COLORS[g.group] ?? '#64748b' }} />
                      <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{g.group}</span>
                    </div>
                    <div style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 700, color: GROUP_COLORS[g.group] ?? '#64748b' }}>{fmtK(g.total_mid)}</div>
                    <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 2 }}>{g.categories.length} categories</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Governed chart wrapper — no raw recharts */}
          <CostRollupChart
            data={chartData}
            title="Mid Estimate by Category"
            uiState={uiState}
            outputType="estimated"
            freshness={stateQ.data?.freshness}
            colorByGroup={GROUP_COLORS}
          />

          {/* Detail table */}
          <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Line-Item Detail
              </span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                {chartData.length} categories · All values indicative · Web research · Not RFQ
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Category','System Group','Low (−15%)','Mid (Planning)','High (+15%)','Items'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '8px 16px', fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{r.name}</td>
                      <td style={{ padding: '8px 16px' }}>
                        <span style={{ fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3, backgroundColor: (GROUP_COLORS[r.group] ?? '#64748b') + '20', color: GROUP_COLORS[r.group] ?? '#64748b' }}>{r.group}</span>
                      </td>
                      <td style={{ padding: '8px 16px', fontSize: 9, fontFamily: 'monospace', color: 'var(--amber)' }}>{fmtK(r.low)}</td>
                      <td style={{ padding: '8px 16px', fontSize: 9, fontFamily: 'monospace', color: 'var(--cyan)', fontWeight: 700 }}>{fmtK(r.mid)}</td>
                      <td style={{ padding: '8px 16px', fontSize: 9, fontFamily: 'monospace', color: 'var(--green)' }}>{fmtK(r.high)}</td>
                      <td style={{ padding: '8px 16px', fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{r.items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
