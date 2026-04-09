'use client';
/**
 * EnrichmentStatusBadge — EQS v1.0
 * Surfaces Apollo enrichment state in /dashboard/supplier-network.
 * DataState-aware. Token-only styling. Self-describing plain-English labels.
 * Answers: "Is enrichment active, and how much verification is actually present?"
 */
import type { UiState } from '../../lib/types/ui';

interface EnrichmentStatusBadgeProps {
  totalContacts: number;
  withEmail: number;
  uiState?: UiState;
}

export function EnrichmentStatusBadge({ totalContacts, withEmail, uiState = 'operational' }: EnrichmentStatusBadgeProps) {
  const verificationPct = totalContacts > 0 ? Math.round((withEmail / totalContacts) * 100) : 0;
  const isApolloActive  = false; // Apollo Basic not yet upgraded — hard-coded until enrich-contacts endpoint returns verified flag

  if (uiState === 'loading') {
    return (
      <div style={{
        backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--border)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
          Loading enrichment status…
        </span>
      </div>
    );
  }

  if (uiState === 'error') {
    return (
      <div style={{
        backgroundColor: 'var(--red-dim)', border: '1px solid var(--red-border)',
        borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--red)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--red)' }}>
          ENRICHMENT STATUS UNAVAILABLE — Retry shortly
        </span>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: isApolloActive ? 'var(--green-dim)' : 'var(--bg-panel)',
      border: `1px solid ${isApolloActive ? 'var(--green-border)' : 'var(--amber-border)'}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${isApolloActive ? 'var(--green-border)' : 'var(--amber-border)'}`,
        backgroundColor: isApolloActive ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            backgroundColor: isApolloActive ? 'var(--green)' : 'var(--amber)',
            boxShadow: `0 0 6px ${isApolloActive ? 'var(--green)' : 'var(--amber)'}`,
          }} />
          <span style={{
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: isApolloActive ? 'var(--green)' : 'var(--amber)',
          }}>
            Contact Enrichment
          </span>
          <span style={{
            fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
            backgroundColor: isApolloActive ? 'var(--green-dim)' : 'var(--amber-dim)',
            border: `1px solid ${isApolloActive ? 'var(--green-border)' : 'var(--amber-border)'}`,
            color: isApolloActive ? 'var(--green)' : 'var(--amber)',
          }}>
            {isApolloActive ? 'ACTIVE' : 'AWAITING CONNECTION'}
          </span>
        </div>
        <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: isApolloActive ? 'var(--green)' : 'var(--amber)' }}>
          {withEmail} <span style={{ fontSize: 8, fontWeight: 400, color: 'var(--text-tertiary)' }}>/ {totalContacts} verified</span>
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 20px' }}>
        {/* Progress bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
              Email verification coverage
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
              color: isApolloActive ? 'var(--green)' : 'var(--amber)',
            }}>
              {verificationPct}%
            </span>
          </div>
          <div style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${verificationPct}%`,
              backgroundColor: isApolloActive ? 'var(--green)' : 'var(--amber)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* Activation instruction when not yet connected */}
        {!isApolloActive && (
          <div style={{
            padding: '10px 14px', borderRadius: 6,
            backgroundColor: 'rgba(245,158,11,0.04)', border: '1px solid var(--amber-border)',
          }}>
            <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
              Activates when:{' '}
              <span style={{ color: 'var(--amber)' }}>Apollo Basic plan ($49/mo)</span>
              {' → '}
              <span style={{ color: 'var(--text-secondary)' }}>
                POST /api/wave9/enrich-contacts → all {totalContacts} contacts receive verified emails
              </span>
            </div>
          </div>
        )}

        {/* Verified state summary */}
        {isApolloActive && (
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--green)', lineHeight: 1.6 }}>
            {withEmail} contacts verified · {totalContacts - withEmail} remaining unverified
          </div>
        )}
      </div>
    </div>
  );
}
