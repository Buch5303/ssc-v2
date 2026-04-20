'use client';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Panel } from '../../../components/ui/Panel';
import { TierLabel } from '../../../components/ui/TierLabel';
import { DataState } from '../../../components/ui/DataState';

const SIGNAL_FAMILIES = [
  { id: 'carbon', name: 'Carbon Markets', icon: '🌿', desc: 'Verra, Gold Standard, CARB, RGGI', opps: 3, tier: 'PURSUE' },
  { id: 'fedtax', name: 'Federal Tax', icon: '🏛️', desc: '§45Q, §45V, §45X, §48C, §48E', opps: 5, tier: 'URGENT' },
  { id: 'statetax', name: 'State Tax', icon: '🗺️', desc: 'Property, sales, income tax credits', opps: 2, tier: 'QUALIFY' },
  { id: 'fedgrant', name: 'Federal Grants', icon: '💰', desc: 'DOE LPO, OCED, EPA GHG Fund', opps: 4, tier: 'PURSUE' },
  { id: 'stategrant', name: 'State Grants', icon: '🏗️', desc: 'Energy office, green banks, PUC', opps: 1, tier: 'HOLD' },
  { id: 'intl', name: 'International', icon: '🌍', desc: 'EU CBAM, UK ETS, K-ETS, CCER', opps: 2, tier: 'QUALIFY' },
  { id: 'utility', name: 'Utility / ISO', icon: '⚡', desc: 'PJM, ERCOT, demand response', opps: 3, tier: 'PURSUE' },
];

const OPPORTUNITIES = [
  { program: '§45Q Carbon Oxide Sequestration', family: 'Federal Tax', value: '$2.4M/yr', npv: '$12.8M', tier: 'URGENT', stack: 3, deadline: 'Dec 31, 2026', eligibility: 0.85, capture: 0.72 },
  { program: '§48C Advanced Energy Project', family: 'Federal Tax', value: '$1.8M', npv: '$1.8M', tier: 'URGENT', stack: 2, deadline: 'Round 3 TBD', eligibility: 0.90, capture: 0.55 },
  { program: 'DOE LPO Title XVII Loan', family: 'Federal Grants', value: '$50M+', npv: '—', tier: 'PURSUE', stack: 1, deadline: 'Rolling', eligibility: 0.70, capture: 0.40 },
  { program: 'NM Renewable Energy Tax Credit', family: 'State Tax', value: '$380K', npv: '$380K', tier: 'QUALIFY', stack: 2, deadline: 'Annual filing', eligibility: 0.60, capture: 0.65 },
  { program: 'PJM Capacity Performance', family: 'Utility / ISO', value: '$420K/yr', npv: '$2.1M', tier: 'PURSUE', stack: 2, deadline: 'BRA 2027/28', eligibility: 0.75, capture: 0.60 },
  { program: 'Voluntary Carbon Credits (VCS)', family: 'Carbon Markets', value: '$180K/yr', npv: '$900K', tier: 'PURSUE', stack: 3, deadline: 'Continuous', eligibility: 0.80, capture: 0.50 },
  { program: 'ERCOT Emergency Response Service', family: 'Utility / ISO', value: '$150K/yr', npv: '$750K', tier: 'QUALIFY', stack: 1, deadline: 'Seasonal', eligibility: 0.55, capture: 0.70 },
];

const tierColor: Record<string, string> = {
  URGENT: '#DC2626', PURSUE: '#F59E0B', QUALIFY: '#1E6FCC', HOLD: 'var(--t3)',
};

const tierBadge: Record<string, 'critical' | 'warning' | 'estimated' | 'silent'> = {
  URGENT: 'critical', PURSUE: 'warning', QUALIFY: 'estimated', HOLD: 'silent',
};

export default function IncentiveRadarPage() {
  const [hasKey] = useState(false);

  const totalAnnual = '$5.4M';
  const totalNPV = '$18.7M';
  const urgentCount = OPPORTUNITIES.filter(o => o.tier === 'URGENT').length;

  return (
    <div className="p-6 max-w-[1400px]">
      <TierLabel>GreenAi Carbon Incentive Opportunity Radar — Positive Signal Surveillance</TierLabel>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--line)', borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
        {[
          { l: 'Total Opportunities', v: String(OPPORTUNITIES.length), s: 'Across 7 families', badge: <Badge variant="estimated">Scanning</Badge> },
          { l: 'Annual Value', v: totalAnnual, s: 'Identified opportunity value' },
          { l: 'Total NPV', v: totalNPV, s: '5-year discounted value', badge: <Badge variant="warning">Estimated</Badge> },
          { l: 'Urgent', v: String(urgentCount), s: 'Time-sensitive — escalate', accent: 'c', badge: <Badge variant="critical">Action</Badge> },
          { l: 'Stacking Detected', v: '4', s: 'Multi-program combinations', badge: <Badge variant="verified">Stacks</Badge> },
        ].map((k, i) => (
          <div key={i} style={{ background: 'var(--bg1)', padding: '14px 12px', borderRight: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k.l}</span>
              {k.badge}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 20, fontWeight: 700, color: k.accent === 'c' ? '#E83535' : 'var(--t0)' }}>{k.v}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8.5, color: 'var(--t3)', marginTop: 3 }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* Signal Family Grid */}
      <TierLabel>Signal Families</TierLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 20 }}>
        {SIGNAL_FAMILIES.map(f => (
          <div key={f.id} style={{
            background: 'var(--bg1)', border: `1px solid ${f.opps > 0 ? `${tierColor[f.tier]}30` : 'var(--line)'}`,
            borderRadius: 6, padding: 12, textAlign: 'center' as const,
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--t0)', marginBottom: 2 }}>{f.name}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 700, color: tierColor[f.tier] }}>{f.opps}</div>
            <div style={{ marginTop: 4 }}><Badge variant={tierBadge[f.tier]}>{f.tier}</Badge></div>
          </div>
        ))}
      </div>

      {/* Opportunity Pipeline */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 20 }}>
        <Panel title="Opportunity Pipeline" meta={<div style={{ display: 'flex', gap: 5 }}><Badge variant="critical">{urgentCount} Urgent</Badge><Badge variant="warning">{OPPORTUNITIES.filter(o => o.tier === 'PURSUE').length} Pursue</Badge></div>}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Program', 'Annual', 'NPV', 'Tier', 'Stack', 'Deadline'].map((h, i) => (
                <th key={i} style={{ textAlign: i === 1 || i === 2 ? 'right' : 'left', padding: '5px 6px', fontSize: 8.5, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {OPPORTUNITIES.map((o, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                  <td style={{ padding: '7px 6px' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--t0)' }}>{o.program}</div>
                    <div style={{ fontSize: 9, color: 'var(--t3)' }}>{o.family}</div>
                  </td>
                  <td style={{ padding: '7px 6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--t0)', textAlign: 'right' }}>{o.value}</td>
                  <td style={{ padding: '7px 6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--t1)', textAlign: 'right' }}>{o.npv}</td>
                  <td style={{ padding: '7px 6px' }}><Badge variant={tierBadge[o.tier]}>{o.tier}</Badge></td>
                  <td style={{ padding: '7px 6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: o.stack >= 3 ? '#22C55E' : 'var(--t2)', textAlign: 'center' }}>{o.stack}x</td>
                  <td style={{ padding: '7px 6px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t2)' }}>{o.deadline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Stacking Engine */}
          <Panel title="Stacking Engine" meta={<Badge variant="verified">4 Stacks</Badge>}>
            {[
              { name: '§45Q + VCS + State Grant + Utility Rebate', type: 'Horizontal', value: '$3.0M/yr', programs: 4 },
              { name: '§45X (Vendor) + §48C (TWP)', type: 'Vertical', value: '$2.2M', programs: 2 },
              { name: 'DR → Capacity → Efficiency Rebate', type: 'Temporal', value: '$570K/yr', programs: 3 },
              { name: '§48E + NM Tax Credit', type: 'Horizontal', value: '$420K', programs: 2 },
            ].map((s, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < 3 ? '1px solid var(--line)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--t0)' }}>{s.name}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#22C55E', fontWeight: 600 }}>{s.value}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge variant="estimated">{s.type}</Badge>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)' }}>{s.programs} programs</span>
                </div>
              </div>
            ))}
          </Panel>

          {/* Compliance Boundary */}
          <Panel title="Compliance Boundary" meta={<Badge variant="silent">Part 21.7</Badge>}>
            <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.6 }}>
              The Incentive Radar is an identification and quantification engine — not a tax advisor, legal advisor, or regulatory filing service. Every opportunity includes a mandatory advisor-referral flag. No opportunity can transition to CLAIMED status without independent professional sign-off.
            </div>
          </Panel>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
        <span>GreenAi Carbon Incentive Opportunity Radar · Integration Spec v1.4 Part 21 · 7 Signal Families</span>
        <span>{hasKey ? 'LIVE' : 'DEMO MODE'} · EQS v1.0 · Advisor referral enforced</span>
      </div>
    </div>
  );
}
