'use client';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Panel } from '../../../components/ui/Panel';
import { TierLabel } from '../../../components/ui/TierLabel';
import { DataState } from '../../../components/ui/DataState';

const SIGNAL_FAMILIES = [
  { id: 'nat', name: 'Natural Disasters', icon: '🌊', desc: 'Earthquakes, hurricanes, floods, wildfires affecting supplier regions', signals: 2, severity: 'LOW' },
  { id: 'pol', name: 'Political & Regulatory', icon: '⚖️', desc: 'Sanctions, tariffs, trade policy changes, ITAR/EAR shifts', signals: 1, severity: 'MODERATE' },
  { id: 'lab', name: 'Labor & Workforce', icon: '👷', desc: 'Strikes, labor shortages, union disputes, wage disruptions', signals: 0, severity: 'NONE' },
  { id: 'ldr', name: 'Leadership & Governance', icon: '👤', desc: 'CEO/CFO departures, M&A activity, board instability', signals: 3, severity: 'ELEVATED' },
  { id: 'fin', name: 'Financial Distress', icon: '📉', desc: 'Credit downgrades, missed filings, liquidity warnings', signals: 1, severity: 'HIGH' },
  { id: 'raw', name: 'Raw Materials', icon: '⛏️', desc: 'Commodity price spikes, supply constraints, allocation notices', signals: 2, severity: 'MODERATE' },
  { id: 'ene', name: 'Energy & Infrastructure', icon: '⚡', desc: 'Grid instability, energy cost surges, facility shutdowns', signals: 0, severity: 'NONE' },
];

const THREAT_ALERTS = [
  { supplier: 'Virginia Transformer', signal: 'Leadership & Governance', detail: 'CEO transition announced Q1 2026 — new leadership impact on delivery commitments unknown', severity: 'ELEVATED', value: '$760K', family: 'ldr', age: '3 days ago' },
  { supplier: 'Baker Hughes', signal: 'Financial Distress', detail: 'Moody\'s placed on negative watch — potential impact on long-term supply agreements', severity: 'HIGH', value: '$340K', family: 'fin', age: '5 days ago' },
  { supplier: 'Nooter Eriksen', signal: 'Raw Materials', detail: 'Nickel alloy price spike +18% in March — direct impact on HRSG fabrication costs', severity: 'MODERATE', value: '$1.15M', family: 'raw', age: '8 days ago' },
  { supplier: 'Universal AET', signal: 'Natural Disasters', detail: 'Flood warning in Houston manufacturing corridor — production facility at risk', severity: 'LOW', value: '$431K', family: 'nat', age: '12 days ago' },
];

const sevColor: Record<string, string> = {
  CRITICAL: '#DC2626', HIGH: '#EF4444', ELEVATED: '#F59E0B', MODERATE: '#EAB308', LOW: '#22C55E', NONE: 'var(--t3)',
};

const sevBadge: Record<string, 'critical' | 'warning' | 'estimated' | 'silent'> = {
  CRITICAL: 'critical', HIGH: 'critical', ELEVATED: 'warning', MODERATE: 'estimated', LOW: 'silent', NONE: 'silent',
};

export default function ThreatRadarPage() {
  const [hasKey] = useState(false); // Will be true when Perplexity key is active

  return (
    <div className="p-6 max-w-[1400px]">
      <TierLabel>Supplier Threat Radar — Negative Signal Surveillance</TierLabel>

      {/* Signal Family Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 20 }}>
        {SIGNAL_FAMILIES.map(f => (
          <div key={f.id} style={{
            background: 'var(--bg1)', border: `1px solid ${f.signals > 0 ? `${sevColor[f.severity]}30` : 'var(--line)'}`,
            borderRadius: 6, padding: 12, textAlign: 'center' as const,
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t0)', marginBottom: 2 }}>{f.name}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 700, color: sevColor[f.severity] }}>{f.signals}</div>
            <div style={{ marginTop: 4 }}><Badge variant={sevBadge[f.severity]}>{f.severity}</Badge></div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 20 }}>
        {/* Active Threat Alerts */}
        <Panel title="Active Threat Signals" meta={<Badge variant="warning">{THREAT_ALERTS.length} Active</Badge>}>
          {THREAT_ALERTS.map((t, i) => (
            <div key={i} style={{
              padding: '10px 0', borderBottom: i < THREAT_ALERTS.length - 1 ? '1px solid var(--line)' : 'none',
              display: 'flex', gap: 10, alignItems: 'start',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                background: sevColor[t.severity],
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>{t.supplier}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: sevColor[t.severity] }}>{t.value}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--t2)', marginBottom: 3 }}>{t.detail}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge variant={sevBadge[t.severity]}>{t.severity}</Badge>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: 'var(--t3)' }}>{t.signal} · {t.age}</span>
                </div>
              </div>
            </div>
          ))}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Radar Status */}
          <Panel title="Radar Status" meta={<Badge variant={hasKey ? 'verified' : 'estimated'}>{hasKey ? 'Active' : 'Demo Mode'}</Badge>}>
            <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 10 }}>
              {hasKey
                ? 'Threat Radar is actively scanning 7 signal families across 73 suppliers daily via Perplexity Sonar Pro.'
                : 'Running in demo mode with sample data. Activate Perplexity API key to enable live threat scanning across all 73 suppliers.'
              }
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { l: 'Signal Families', v: '7 / 7', a: 'ok' },
                { l: 'Suppliers Monitored', v: '73', a: 'ok' },
                { l: 'Scan Frequency', v: hasKey ? 'Daily 04:00 UTC' : 'Inactive', a: hasKey ? 'ok' : undefined },
                { l: 'Last Scan', v: hasKey ? 'Today 04:00 UTC' : 'N/A', a: hasKey ? 'ok' : undefined },
                { l: 'Perplexity API', v: hasKey ? 'Connected' : 'Not Connected', a: hasKey ? 'ok' : 'c' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 10, color: 'var(--t2)' }}>{s.l}</span>
                  <span style={{
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 500,
                    color: s.a === 'ok' ? '#22C55E' : s.a === 'c' ? '#E83535' : 'var(--t1)',
                  }}>{s.v}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Cross-Correlation */}
          <Panel title="Cross-Supplier Correlation" meta={<Badge variant="silent">Part 20.3</Badge>}>
            <DataState state="awaiting_key" awaitingKey="PERPLEXITY_API_KEY" label="Cross-correlation requires 14 days of live data" minHeight={80} />
          </Panel>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
        <span>Supplier Threat Radar · Integration Spec v1.4 Part 20 · 7 Signal Families</span>
        <span>{hasKey ? 'LIVE — Perplexity Sonar Pro' : 'DEMO MODE — Sample Data'} · EQS v1.0</span>
      </div>
    </div>
  );
}
