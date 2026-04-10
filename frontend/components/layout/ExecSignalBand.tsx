'use client';
/**
 * ExecSignalBand — EQS v1.0 / Directive 38 Block O
 * Dominant above-the-fold executive signal strip.
 * One per page. Max 4 signals. Primary signal visually outranks all others.
 * Answers "What matters now" in under 3 seconds.
 * Token-only. Self-describing. Zero training required.
 */

export type SignalState = 'healthy' | 'at-risk' | 'do-now' | 'blocked' | 'watch';

export interface ExecSignal {
  state: SignalState;
  label: string;        // short: "1 Draft Ready", "$10.1M Estimated"
  sublabel?: string;    // one-line context: "Baker Hughes · $340K"
  primary?: boolean;    // visually dominant — only one per band
}

interface ExecSignalBandProps {
  signals: ExecSignal[];
  uiState?: string;
}

const STATE_STYLE: Record<SignalState, {
  color: string; bg: string; border: string; dot: string; chipLabel: string;
}> = {
  'healthy':  { color: 'var(--green)',  bg: 'var(--green-dim)',  border: 'var(--green-border)',  dot: 'var(--green)',  chipLabel: 'HEALTHY'  },
  'at-risk':  { color: 'var(--amber)',  bg: 'var(--amber-dim)',  border: 'var(--amber-border)',  dot: 'var(--amber)',  chipLabel: 'AT RISK'  },
  'do-now':   { color: 'var(--cyan)',   bg: 'var(--cyan-dim)',   border: 'var(--cyan-border)',   dot: 'var(--cyan)',   chipLabel: 'DO NOW'   },
  'blocked':  { color: 'var(--red)',    bg: 'var(--red-dim)',    border: 'var(--red-border)',    dot: 'var(--red)',    chipLabel: 'BLOCKED'  },
  'watch':    { color: 'var(--purple)', bg: 'var(--purple-dim)', border: 'var(--purple-border)', dot: 'var(--purple)', chipLabel: 'WATCH'    },
};

export function ExecSignalBand({ signals, uiState = 'operational' }: ExecSignalBandProps) {
  if (uiState === 'loading') {
    return (
      <div style={{
        display: 'flex', gap: 8,
        padding: '10px 0', animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: 52, borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
          }} />
        ))}
      </div>
    );
  }

  if (!signals.length) return null;

  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap',
      padding: '2px 0',
    }}>
      {signals.map((sig, i) => {
        const s = STATE_STYLE[sig.state];
        const isPrimary = sig.primary === true;

        return (
          <div key={i} style={{
            flex: isPrimary ? 2 : 1,
            minWidth: isPrimary ? 200 : 120,
            padding: isPrimary ? '12px 16px' : '10px 14px',
            borderRadius: 6,
            backgroundColor: s.bg,
            border: `1px solid ${s.border}`,
            // Primary gets a subtle left accent bar
            borderLeft: isPrimary ? `3px solid ${s.dot}` : `1px solid ${s.border}`,
          }}>
            {/* State chip */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: isPrimary ? 6 : 4,
            }}>
              <div style={{
                width: isPrimary ? 7 : 6,
                height: isPrimary ? 7 : 6,
                borderRadius: '50%',
                backgroundColor: s.dot,
                flexShrink: 0,
                boxShadow: isPrimary ? `0 0 6px ${s.dot}` : 'none',
              }} />
              <span style={{
                fontSize: 7, fontFamily: 'monospace', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                color: s.color,
              }}>
                {s.chipLabel}
              </span>
            </div>

            {/* Label — primary is larger */}
            <div style={{
              fontSize: isPrimary ? 13 : 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
              marginBottom: sig.sublabel ? 3 : 0,
            }}>
              {sig.label}
            </div>

            {/* Sublabel */}
            {sig.sublabel && (
              <div style={{
                fontSize: 8, fontFamily: 'monospace',
                color: 'var(--text-tertiary)', lineHeight: 1.4,
              }}>
                {sig.sublabel}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
