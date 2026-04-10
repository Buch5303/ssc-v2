'use client';
/**
 * DecisionStateSummary — EQS v1.0 / Directive 22A
 * Compact executive summary row answering:
 * "What is ready now / blocked / needs review / can execute next?"
 * Token-only styling. Zero raw values. Self-describing. 5-second scannable.
 */

interface DecisionBucket {
  ready: number;
  blocked: number;
  needsReview: number;
  nextAction: string;
  nextActionEndpoint?: string;
}

interface DecisionStateSummaryProps {
  buckets: DecisionBucket;
  uiState?: string;
}

interface PillProps {
  count: number;
  label: string;
  color: string;
  bg: string;
  border: string;
}

function Pill({ count, label, color, bg, border }: PillProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '9px 12px', borderRadius: 6,
      backgroundColor: bg, border: `1px solid ${border}`,
      flex: 1, minWidth: 0,
    }}>
      <span style={{
        fontSize: 18, fontFamily: 'monospace', fontWeight: 700,
        color, lineHeight: 1,
      }}>
        {count}
      </span>
      <span style={{
        fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase',
        letterSpacing: '0.06em', color, lineHeight: 1.3,
      }}>
        {label}
      </span>
    </div>
  );
}

export function DecisionStateSummary({ buckets, uiState = 'operational' }: DecisionStateSummaryProps) {
  if (uiState === 'loading') {
    return (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
      }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{
            height: 52, borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
    );
  }

  if (uiState === 'error') {
    return (
      <div style={{
        padding: '10px 16px', borderRadius: 6,
        backgroundColor: 'var(--red-dim)', border: '1px solid var(--red-border)',
        fontSize: 9, fontFamily: 'monospace', color: 'var(--red)',
      }}>
        DECISION STATE UNAVAILABLE — Platform state could not be loaded
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Status pills row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 2fr', gap: 8 }}>
        <Pill
          count={buckets.ready}
          label="Ready to Execute"
          color="var(--green)"
          bg="var(--green-dim)"
          border="var(--green-border)"
        />
        <Pill
          count={buckets.needsReview}
          label="Needs Review"
          color="var(--amber)"
          bg="var(--amber-dim)"
          border="var(--amber-border)"
        />
        <Pill
          count={buckets.blocked}
          label="Blocked"
          color="var(--red)"
          bg="var(--red-dim)"
          border="var(--red-border)"
        />

        {/* Next action cell */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', borderRadius: 6,
          backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)',
          gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 7, fontFamily: 'monospace', textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--cyan)', marginBottom: 2,
            }}>
              DO NOW
            </div>
            <div style={{
              fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)',
              fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {buckets.nextAction}
            </div>
          </div>
          {buckets.nextActionEndpoint && (
            <code style={{
              fontSize: 7, fontFamily: 'monospace', flexShrink: 0,
              color: 'var(--cyan)', backgroundColor: 'rgba(6,182,212,0.08)',
              border: '1px solid var(--cyan-border)', padding: '3px 8px', borderRadius: 3,
              whiteSpace: 'nowrap',
            }}>
              {buckets.nextActionEndpoint}
            </code>
          )}
        </div>
      </div>
    </div>
  );
}
