'use client';
/**
 * ReadinessSignal — EQS v1.0 / Directive 22B
 * Unambiguous, self-describing readiness status badge.
 * No ambiguous wording. One of 7 explicit states only.
 * Token-only. Zero inline hex. Zero training required.
 */

export type ReadinessState =
  | 'READY TO SEND'
  | 'READY FOR REVIEW'
  | 'BLOCKED'
  | 'AWAITING ENRICHMENT'
  | 'NOT STARTED'
  | 'IN PROGRESS'
  | 'COMPLETE';

interface ReadinessSignalProps {
  state: ReadinessState;
  compact?: boolean; // smaller pill for inline use
}

const STATE_STYLES: Record<ReadinessState, {
  color: string; bg: string; border: string; dot: string;
}> = {
  'READY TO SEND':       { color: 'var(--green)',  bg: 'var(--green-dim)',  border: 'var(--green-border)',  dot: 'var(--green)'  },
  'READY FOR REVIEW':    { color: 'var(--cyan)',   bg: 'var(--cyan-dim)',   border: 'var(--cyan-border)',   dot: 'var(--cyan)'   },
  'BLOCKED':             { color: 'var(--red)',    bg: 'var(--red-dim)',    border: 'var(--red-border)',    dot: 'var(--red)'    },
  'AWAITING ENRICHMENT': { color: 'var(--amber)',  bg: 'var(--amber-dim)', border: 'var(--amber-border)', dot: 'var(--amber)'  },
  'NOT STARTED':         { color: 'var(--slate)',  bg: 'var(--slate-dim)', border: 'var(--slate-border)', dot: 'var(--slate)'  },
  'IN PROGRESS':         { color: 'var(--purple)', bg: 'var(--purple-dim)',border: 'var(--purple-border)',dot: 'var(--purple)' },
  'COMPLETE':            { color: 'var(--green)',  bg: 'var(--green-dim)', border: 'var(--green-border)', dot: 'var(--green)'  },
};

export function ReadinessSignal({ state, compact = false }: ReadinessSignalProps) {
  const s = STATE_STYLES[state] ?? STATE_STYLES['NOT STARTED'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: compact ? 4 : 6,
      padding: compact ? '2px 7px' : '4px 10px',
      borderRadius: 4, backgroundColor: s.bg, border: `1px solid ${s.border}`,
      fontSize: compact ? 7 : 8, fontFamily: 'monospace', fontWeight: 700,
      color: s.color, whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: compact ? 5 : 6, height: compact ? 5 : 6,
        borderRadius: '50%', backgroundColor: s.dot, flexShrink: 0,
        boxShadow: state === 'READY TO SEND' || state === 'COMPLETE'
          ? `0 0 5px ${s.dot}` : 'none',
      }} />
      {state}
    </span>
  );
}
