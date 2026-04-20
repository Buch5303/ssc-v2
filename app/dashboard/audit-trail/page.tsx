'use client';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Panel } from '../../../components/ui/Panel';
import { TierLabel } from '../../../components/ui/TierLabel';

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  detail: string;
  category: 'data' | 'auth' | 'system' | 'pipeline' | 'rfq';
}

const DEMO_EVENTS: AuditEvent[] = [
  { id: 'aud-001', timestamp: '2026-04-20T14:32:00Z', actor: 'Auto-Builder', action: 'PIPELINE_RUN', resource: 'AUTO-001', detail: 'Cron-triggered pipeline run — Directive AUTO-001: Neon DB write endpoints', category: 'pipeline' },
  { id: 'aud-002', timestamp: '2026-04-20T13:01:10Z', actor: 'Claude Session', action: 'ENV_CHECK', resource: '/api/admin', detail: 'Self-management API status check — ACTIVE', category: 'system' },
  { id: 'aud-003', timestamp: '2026-04-20T12:57:08Z', actor: 'System', action: 'HEALTH_CHECK', resource: '/api/health', detail: 'All 4 subsystem checks passing — pricing, rfq, summary, contacts', category: 'system' },
  { id: 'aud-004', timestamp: '2026-04-19T18:28:00Z', actor: 'Claude Session', action: 'DEPLOY', resource: 'dpl_3qj2SC4q', detail: 'Cost Intel fix: string-to-number normalization + Settings page + ErrorBoundary', category: 'system' },
  { id: 'aud-005', timestamp: '2026-04-19T17:42:00Z', actor: 'Claude Session', action: 'DEPLOY', resource: 'dpl_73WL3WKP', detail: 'Bidirectional Surveillance: Threat Radar + Incentive Radar + DataState + NotificationBell', category: 'system' },
  { id: 'aud-006', timestamp: '2026-04-17T12:27:44Z', actor: 'System', action: 'BOOTSTRAP', resource: 'VERCEL_TOKEN', detail: 'Self-management token bootstrapped — platform now manages its own infrastructure', category: 'system' },
  { id: 'aud-007', timestamp: '2026-04-17T11:30:00Z', actor: 'Claude Session', action: 'DEPLOY', resource: 'dpl_FWEPZZUd', detail: 'Self-managing platform: /api/admin + /api/risk-analysis + /dashboard/risk — 32 routes', category: 'system' },
  { id: 'aud-008', timestamp: '2026-04-17T08:15:00Z', actor: 'Claude Session', action: 'DEPLOY', resource: 'dpl_GxUtFvks', detail: '5-agent orchestrator: Opus Architect, Perplexity Researcher, Gemini Analyst, Sonnet Builder, DeepSeek Auditor', category: 'pipeline' },
  { id: 'aud-009', timestamp: '2026-04-05T14:00:00Z', actor: 'Baker Hughes', action: 'RFQ_RESPONSE', resource: 'VIB_MON', detail: 'Quote received: $340,000 for Bently Nevada 3500 Series vibration monitoring (+26.7% vs $268K estimate)', category: 'rfq' },
  { id: 'aud-010', timestamp: '2026-03-17T09:00:00Z', actor: 'Greg Buchanan', action: 'ICD_REQUEST', resource: 'EthosEnergy', detail: 'Interface Control Document requested from EthosEnergy Italia — blocks $1.73M across 3 packages', category: 'data' },
];

const catColor: Record<string, string> = {
  data: '#1E6FCC', auth: '#F59E0B', system: '#22C55E', pipeline: '#8B5CF6', rfq: '#EC4899',
};

const catBadge: Record<string, 'verified' | 'warning' | 'estimated' | 'silent' | 'critical'> = {
  data: 'estimated', auth: 'warning', system: 'verified', pipeline: 'silent', rfq: 'critical',
};

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function AuditTrailPage() {
  const [filter, setFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');

  const filtered = DEMO_EVENTS.filter(e => {
    const q = filter.toLowerCase();
    const mQ = !q || e.action.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q) || e.actor.toLowerCase().includes(q) || e.resource.toLowerCase().includes(q);
    const mC = !catFilter || e.category === catFilter;
    return mQ && mC;
  });

  return (
    <div className="p-6 max-w-[1400px]">
      <TierLabel>Audit Trail — Immutable Event Log</TierLabel>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--line)', borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { l: 'Total Events', v: String(DEMO_EVENTS.length), s: 'All time' },
          { l: 'System', v: String(DEMO_EVENTS.filter(e => e.category === 'system').length), s: 'Deploys, health, config' },
          { l: 'Pipeline', v: String(DEMO_EVENTS.filter(e => e.category === 'pipeline').length), s: 'Auto-builder runs' },
          { l: 'RFQ', v: String(DEMO_EVENTS.filter(e => e.category === 'rfq').length), s: 'Quotes and responses' },
          { l: 'Data', v: String(DEMO_EVENTS.filter(e => e.category === 'data').length), s: 'Mutations and requests' },
        ].map((k, i) => (
          <div key={i} style={{ background: 'var(--bg1)', padding: '14px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{k.l}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 20, fontWeight: 700, color: 'var(--t0)' }}>{k.v}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8.5, color: 'var(--t3)', marginTop: 3 }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text" placeholder="Search events..." value={filter} onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 300, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--t0)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, outline: 'none' }}
        />
        {['', 'system', 'pipeline', 'rfq', 'data', 'auth'].map(c => (
          <button key={c} onClick={() => setCatFilter(c)}
            style={{
              padding: '4px 10px', fontSize: 9, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
              background: catFilter === c ? 'var(--bg3)' : 'transparent', border: `1px solid ${catFilter === c ? 'var(--t3)' : 'var(--line)'}`,
              color: catFilter === c ? 'var(--t0)' : 'var(--t3)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
            {c || 'All'}
          </button>
        ))}
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)', marginLeft: 'auto' }}>
          {filtered.length} / {DEMO_EVENTS.length} events
        </span>
      </div>

      {/* Event Log */}
      <Panel title="Event Log" meta={<Badge variant="verified">Immutable</Badge>}>
        {filtered.map((e, i) => (
          <div key={e.id} style={{
            display: 'flex', gap: 12, padding: '10px 0', alignItems: 'start',
            borderBottom: i < filtered.length - 1 ? '1px solid var(--line)' : 'none',
          }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: catColor[e.category], marginTop: 6, flexShrink: 0 }} />
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)', width: 100, flexShrink: 0, marginTop: 2 }}>
              {fmtTime(e.timestamp)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                <Badge variant={catBadge[e.category]}>{e.action}</Badge>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t0)' }}>{e.actor}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)' }}>→ {e.resource}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.5 }}>{e.detail}</div>
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: 'var(--t3)', flexShrink: 0 }}>{e.id}</div>
          </div>
        ))}
      </Panel>

      <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
        <span>Audit Trail · EQS v1.0 Section 5 · Immutable append-only log</span>
        <span>Demo data · Full Neon DB integration pending</span>
      </div>
    </div>
  );
}
