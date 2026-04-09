'use client';
/**
 * Dashboard C — Supplier Network
 * EQS v1.0. No raw Recharts. All charts via governed wrappers.
 * Zero-training labels. Explicit types throughout.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api/client';
import type { DataState } from '../../../lib/types/ui';
import type { TierStats, TierStat } from '../../../lib/api/discovery';
import type { Wave9ContactsByCategory, Wave9ContactsBySeniority, CategoryStat, SeniorityStat } from '../../../lib/api/wave9';
import { LoadingSkeleton, EmptyState, ErrorCard, DeferredCard, AwaitingKeyCard } from '../../../components/states';
import { OutputBadge } from '../../../components/badges/OutputBadge';
import { TierPieChart, type TierSlice } from '../../../components/charts/TierPieChart';
import { ContactCoverageChart, type CategoryBar } from '../../../components/charts/ContactCoverageChart';

interface StatusBop {
  bop_intelligence: { suppliers_in_db: number; pricing_records: number; bop_total_mid_usd: number; bop_categories_priced: number };
  engines: { discovery: { status: string } };
}

const TIER_META: Record<number, { label: string; color: string }> = {
  1: { label: 'T1 — OEM / Global Major',  color: '#06b6d4' },
  2: { label: 'T2 — Specialist',           color: '#10b981' },
  3: { label: 'T3 — Regional',             color: '#f59e0b' },
  4: { label: 'T4 — Niche / Component',    color: '#ef4444' },
};

const SENIORITY_COLORS: Record<string, string> = {
  c_suite: '#06b6d4', vp: '#10b981', director: '#f59e0b', manager: '#64748b', individual: '#4a5568',
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

export default function SupplierNetworkPage() {
  const statusQ = useQuery<DataState<StatusBop>>({
    queryKey: ['status'],
    queryFn: () => apiFetch<StatusBop>('/status'),
    refetchInterval: 60_000,
  });
  const tiersQ = useQuery<DataState<TierStats>>({
    queryKey: ['tier-stats'],
    queryFn: () => apiFetch<TierStats>('/discovery/tier-stats'),
    refetchInterval: 120_000,
  });
  const catQ = useQuery<DataState<Wave9ContactsByCategory>>({
    queryKey: ['wave9-by-category'],
    queryFn: () => apiFetch<Wave9ContactsByCategory>('/wave9/contacts/by-category'),
    refetchInterval: 120_000,
  });
  const senQ = useQuery<DataState<Wave9ContactsBySeniority>>({
    queryKey: ['wave9-by-seniority'],
    queryFn: () => apiFetch<Wave9ContactsBySeniority>('/wave9/contacts/by-seniority'),
    refetchInterval: 120_000,
  });

  const bop     = statusQ.data?.data?.bop_intelligence;
  const tiers   = tiersQ.data?.data;
  const byCat   = catQ.data?.data;
  const bySen   = senQ.data?.data;

  const pieData: TierSlice[] = (tiers?.tier_distribution ?? []).map((t: TierStat) => ({
    tier: t.tier, count: t.count,
    label: TIER_META[t.tier]?.label ?? `Tier ${t.tier}`,
    fill:  TIER_META[t.tier]?.color ?? '#64748b',
  }));

  const catData: CategoryBar[] = (byCat?.categories ?? []).slice(0, 12).map((c: CategoryStat) => ({
    name: c.category.replace(/_/g,' ').replace('System','Sys').replace('Equipment','Eq').replace('Monitoring','Mon'),
    contacts: c.contacts,
    email: c.with_email,
  }));

  const isLoading = statusQ.data?.uiState === 'loading' || tiersQ.data?.uiState === 'loading';
  const hasError  = statusQ.data?.uiState === 'error' && tiersQ.data?.uiState === 'error';
  const totalContacts = bySen?.by_seniority.reduce((acc: number, x: SeniorityStat) => acc + x.contacts, 0) ?? 1;

  return (
    <div style={{ padding: 24, maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── COMMAND BAR ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', margin: 0 }}>
            Supplier Network
          </h1>
          <p style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            BOP supply chain coverage · Tier distribution · Wave 9 contact intelligence
          </p>
        </div>
        <OutputBadge outputType="seeded" freshness={tiersQ.data?.freshness} />
      </div>

      {/* Full-page states */}
      {isLoading && <LoadingSkeleton rows={4} height="h-20" />}
      {hasError  && <ErrorCard error={statusQ.data?.error ?? 'server_error'} />}

      {!isLoading && !hasError && (
        <>
          {/* ── KPI BAND ── */}
          <div>
            <div style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Platform Coverage Summary
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <KpiCard label="Suppliers in DB"     value={bop?.suppliers_in_db}       sub="Neon PostgreSQL · W251 program" />
              <KpiCard label="BOP Categories"      value={bop?.bop_categories_priced} sub="Balance of Plant — all priced" />
              <KpiCard label="Tier 1 OEM Partners" value={pieData.find((p: TierSlice) => p.tier === 1)?.count} sub="Global industrial leaders" accent="var(--cyan)" />
              <KpiCard label="In Memory"           value={81}  sub="Discovery engine · Active session" accent="var(--green)" />
            </div>
          </div>

          {/* ── PRIMARY INSIGHT REGION ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Tier distribution — governed wrapper */}
            <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 16 }}>
                Supplier Tier Distribution
              </div>
              <TierPieChart data={pieData} uiState={tiersQ.data?.uiState ?? 'loading'} />
            </div>

            {/* Contact seniority breakdown */}
            <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  Contact Seniority
                </span>
                <OutputBadge outputType="seeded" freshness={senQ.data?.freshness} />
              </div>

              {senQ.data?.uiState === 'loading'      && <LoadingSkeleton rows={4} height="h-5" />}
              {senQ.data?.uiState === 'awaiting_key' && <AwaitingKeyCard engine="Wave 9 Contact Intelligence" requirement="Apollo enrichment or manual contact upload" />}
              {senQ.data?.uiState === 'empty'        && <EmptyState title="No contacts" description="Wave 9 contact intelligence not yet loaded." />}
              {senQ.data?.uiState === 'error'        && <ErrorCard error={senQ.data.error ?? 'server_error'} />}

              {(senQ.data?.uiState === 'operational' || senQ.data?.uiState === 'stale') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                  {(bySen?.by_seniority ?? []).map((s: SeniorityStat) => {
                    const pct = Math.round((s.contacts / totalContacts) * 100);
                    const color = SENIORITY_COLORS[s.seniority] ?? '#64748b';
                    const label = s.seniority === 'c_suite' ? 'C-Suite (CEO/CTO/COO)' : s.seniority.toUpperCase();
                    return (
                      <div key={s.seniority}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{label}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color }}>{s.contacts}</span>
                            {s.with_email > 0 && <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--green)' }}>✉ {s.with_email} emailable</span>}
                          </div>
                        </div>
                        <div style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, backgroundColor: color, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Contacts by BOP category — governed wrapper */}
          {catData.length > 0 && (
            <div style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 16 }}>
                Contact Coverage by BOP Category
              </div>
              <ContactCoverageChart data={catData} uiState={catQ.data?.uiState ?? 'empty'} />
            </div>
          )}

          {/* Apollo upgrade deferred capability */}
          {(catQ.data?.uiState === 'awaiting_key' || catQ.data?.uiState === 'empty') && catData.length === 0 && (
            <DeferredCard
              capability="Apollo Contact Enrichment"
              activationRequirement="Apollo Basic plan ($49/mo)"
              activatedBy="Upgrade Apollo → POST /api/wave9/enrich-contacts → contacts enriched with verified emails"
            />
          )}
        </>
      )}
    </div>
  );
}
