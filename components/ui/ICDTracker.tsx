'use client';
import { useState } from 'react';
import { Badge } from './Badge';
import { Panel } from './Panel';

const ICD_REQUEST_DATE = new Date('2026-03-15');
const ICD_DUE_DATE = new Date('2026-05-01');
const BLOCKED_VALUE = 1_725_700;

const ESCALATION_CHAIN = [
  { name: 'Alberto Malandra', role: 'EthosEnergy Italia — Program Lead', email: 'alberto.malandra@ethosenergy.com', level: 1 },
  { name: 'Todd Dunlop', role: 'EthosEnergy — VP Operations', email: 'todd.dunlop@ethosenergy.com', level: 2 },
  { name: 'Ante Kušurin', role: 'One Equity Partners — Board', email: '', level: 3 },
];

const BLOCKED_PACKAGES = [
  { category: 'Main Power Transformer', code: 'XFMR', value: 760_000, lead_time: '52–70 wk', impact: 'Longest lead — directly delays First Power' },
  { category: 'Exhaust & Silencing System', code: 'EXHST', value: 431_000, lead_time: '28–36 wk', impact: 'Cannot size without turbine exhaust specs' },
  { category: 'Electrical Distribution', code: 'ELEC_DIST', value: 535_000, lead_time: '24–32 wk', impact: 'Switchgear/MCC sizing requires ICD data' },
];

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

export function ICDTracker() {
  const [showDraft, setShowDraft] = useState(false);
  const today = new Date();
  const daysSinceRequest = daysBetween(ICD_REQUEST_DATE, today);
  const daysUntilDue = daysBetween(today, ICD_DUE_DATE);
  const overdue = daysUntilDue < 0;
  const urgency = overdue ? 'OVERDUE' : daysUntilDue <= 7 ? 'CRITICAL' : daysUntilDue <= 14 ? 'URGENT' : 'TRACKING';

  const urgencyColor: Record<string, string> = {
    OVERDUE: '#DC2626', CRITICAL: '#EF4444', URGENT: '#F59E0B', TRACKING: '#22C55E',
  };

  return (
    <Panel
      title="EthosEnergy ICD Tracker"
      meta={
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
          fontFamily: 'IBM Plex Mono, monospace', color: '#fff',
          background: urgencyColor[urgency],
        }}>
          {urgency}
        </span>
      }
    >
      {/* Countdown Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        <div style={{ textAlign: 'center' as const, padding: 10, borderRadius: 6, background: 'var(--bg1)', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t0)' }}>{daysSinceRequest}</div>
          <div style={{ fontSize: 9, color: 'var(--t3)' }}>Days Since Request</div>
        </div>
        <div style={{ textAlign: 'center' as const, padding: 10, borderRadius: 6, background: overdue ? 'rgba(220,38,38,0.08)' : 'var(--bg1)', border: `1px solid ${overdue ? 'rgba(220,38,38,0.3)' : 'var(--line)'}` }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: overdue ? '#DC2626' : daysUntilDue <= 7 ? '#EF4444' : 'var(--t0)' }}>
            {overdue ? `+${Math.abs(daysUntilDue)}` : daysUntilDue}
          </div>
          <div style={{ fontSize: 9, color: 'var(--t3)' }}>{overdue ? 'Days Overdue' : 'Days to Deadline'}</div>
        </div>
        <div style={{ textAlign: 'center' as const, padding: 10, borderRadius: 6, background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: '#EF4444' }}>$1.73M</div>
          <div style={{ fontSize: 9, color: 'var(--t3)' }}>Value Blocked</div>
        </div>
        <div style={{ textAlign: 'center' as const, padding: 10, borderRadius: 6, background: 'var(--bg1)', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t0)' }}>3</div>
          <div style={{ fontSize: 9, color: 'var(--t3)' }}>Packages Blocked</div>
        </div>
      </div>

      {/* Blocked Packages */}
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>Blocked Packages</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' as const, marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' as const, padding: '4px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Package</th>
            <th style={{ textAlign: 'right' as const, padding: '4px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Value</th>
            <th style={{ textAlign: 'right' as const, padding: '4px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Lead Time</th>
            <th style={{ textAlign: 'left' as const, padding: '4px 0', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)' }}>Impact</th>
          </tr>
        </thead>
        <tbody>
          {BLOCKED_PACKAGES.map((pkg, i) => (
            <tr key={i}>
              <td style={{ padding: '6px 0', fontSize: 11, fontWeight: 500, color: 'var(--t0)' }}>
                {pkg.category} <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t3)' }}>{pkg.code}</span>
              </td>
              <td style={{ padding: '6px 0', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#EF4444', textAlign: 'right' as const }}>${(pkg.value / 1000).toFixed(0)}K</td>
              <td style={{ padding: '6px 0', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t2)', textAlign: 'right' as const }}>{pkg.lead_time}</td>
              <td style={{ padding: '6px 0', fontSize: 10, color: 'var(--t2)' }}>{pkg.impact}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Escalation Chain */}
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>Escalation Chain</div>
      {ESCALATION_CHAIN.map((contact, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < ESCALATION_CHAIN.length - 1 ? '1px solid var(--line)' : 'none' }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
            background: i === 0 ? '#1E6FCC' : i === 1 ? '#F59E0B' : '#EF4444', color: '#fff',
          }}>L{contact.level}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>{contact.name}</div>
            <div style={{ fontSize: 10, color: 'var(--t2)' }}>{contact.role}</div>
          </div>
          <Badge variant={i === 0 ? 'verified' : i === 1 ? 'warning' : 'critical'}>Level {contact.level}</Badge>
        </div>
      ))}

      {/* Draft Email Button */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => setShowDraft(!showDraft)}
          style={{
            padding: '6px 14px', fontSize: 11, fontWeight: 600,
            background: '#1E6FCC', color: '#fff', border: 'none',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          {showDraft ? 'Hide Draft' : '📧 Draft Escalation Email'}
        </button>
        {showDraft && (
          <div style={{ marginTop: 10, padding: 14, borderRadius: 6, background: 'var(--bg0)', border: '1px solid var(--line)', fontSize: 11, lineHeight: 1.7, color: 'var(--t1)', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'pre-wrap' as const }}>
{`To: Alberto Malandra; Todd Dunlop
Subject: URGENT — EthosEnergy ICD Required — ${daysSinceRequest} Days Outstanding — $1.73M Blocked

Alberto / Todd,

This is a formal escalation regarding the Interface Control Document (ICD) for the TG20/W251 BOP program at Santa Teresa, NM.

The ICD was requested ${daysSinceRequest} days ago. It remains outstanding.

Three BOP packages totaling $1,725,700 cannot proceed to RFQ without this document:
• Main Power Transformer — $760,000 (52–70 week lead time)
• Exhaust & Silencing System — $431,000
• Electrical Distribution — $535,000

Our fixed RFQ send date is May 25, 2026. Every day of additional delay compresses an already tight critical path and directly threatens the Q2 2027 First Power target.

Please confirm receipt of this ICD by end of business ${ICD_DUE_DATE.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

Regards,
Greg Buchanan
CEO, Trans World Power LLC`}
          </div>
        )}
      </div>
    </Panel>
  );
}
