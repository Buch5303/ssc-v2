'use client';
import type { ErrorClass, UiState } from '../../lib/types/ui';

// ── Loading skeleton — matches content shape, never a spinner ─────────────
export function LoadingSkeleton({ rows = 3, height = 'h-4' }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2 animate-pulse" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${height} bg-white/[0.04] rounded`} style={{ width: `${85 - i * 10}%` }} />
      ))}
    </div>
  );
}

// ── Empty state — Directive 28B: always explains what, why, and what unlocks it ──
export function EmptyState({
  title,
  description,
  action,
  blocker,
  readiness = 'NOT STARTED',
}: {
  title: string;
  description: string;
  action?: string;
  blocker?: string;        // plain-English blocker if applicable
  readiness?: 'NOT STARTED' | 'AWAITING ENRICHMENT' | 'AWAITING KEY' | 'BLOCKED';
}) {
  const READINESS_STYLE = {
    'NOT STARTED':        { color: 'var(--slate)',  bg: 'var(--slate-dim)',  border: 'var(--slate-border)'  },
    'AWAITING ENRICHMENT':{ color: 'var(--amber)',  bg: 'var(--amber-dim)',  border: 'var(--amber-border)'  },
    'AWAITING KEY':       { color: 'var(--amber)',  bg: 'var(--amber-dim)',  border: 'var(--amber-border)'  },
    'BLOCKED':            { color: 'var(--red)',    bg: 'var(--red-dim)',    border: 'var(--red-border)'    },
  };
  const rs = READINESS_STYLE[readiness];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '32px 24px', textAlign: 'center',
      gap: 8,
    }}>
      <span style={{
        fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
        backgroundColor: rs.bg, border: `1px solid ${rs.border}`, color: rs.color,
        letterSpacing: '0.05em', marginBottom: 4,
      }}>
        {readiness}
      </span>
      <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-secondary)' }}>
        {title}
      </div>
      <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', maxWidth: 280, lineHeight: 1.6 }}>
        {description}
      </div>
      {blocker && (
        <div style={{
          fontSize: 8, fontFamily: 'monospace', padding: '6px 12px', borderRadius: 5,
          backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
          color: 'var(--amber)', marginTop: 4,
        }}>
          Blocked by: {blocker}
        </div>
      )}
      {action && (
        <div style={{
          fontSize: 8, fontFamily: 'monospace', padding: '6px 12px', borderRadius: 5,
          backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)',
          color: 'var(--cyan)', marginTop: 4,
        }}>
          → {action}
        </div>
      )}
    </div>
  );
}

// ── Partial state — Directive 28C: what is usable, what is missing ────────
export function PartialState({
  availableLabel,
  missingLabel,
  canProceed,
  nextStep,
}: {
  availableLabel: string;
  missingLabel: string;
  canProceed: boolean;
  nextStep?: string;
}) {
  return (
    <div style={{
      padding: '10px 16px', borderRadius: 6,
      backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
        backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
        color: 'var(--amber)', flexShrink: 0,
      }}>
        PARTIAL
      </span>
      <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--amber)', fontWeight: 600, flex: 1, minWidth: 0 }}>
        {availableLabel}
      </span>
      <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', flexShrink: 0 }}>
        Missing: {missingLabel.length > 60 ? missingLabel.slice(0, 57) + '…' : missingLabel}
      </span>
      {nextStep && (
        <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--cyan)', flexShrink: 0 }}>
          → {nextStep.length > 50 ? nextStep.slice(0, 47) + '…' : nextStep}
        </span>
      )}
    </div>
  );
}

// ── Degraded state — Directive 28C: what is still usable, what to do ──────
export function DegradedState({
  what,
  stillUsable,
  nextStep,
}: {
  what: string;
  stillUsable: string;
  nextStep?: string;
}) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 6,
      backgroundColor: 'var(--red-dim)', border: '1px solid var(--red-border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
          backgroundColor: 'var(--red-dim)', border: '1px solid var(--red-border)',
          color: 'var(--red)',
        }}>
          DEGRADED
        </span>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--red)', fontWeight: 600 }}>
          {what}
        </span>
      </div>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
        Still usable: <span style={{ color: 'var(--green)' }}>{stillUsable}</span>
      </div>
      {nextStep && (
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--cyan)' }}>
          → {nextStep}
        </div>
      )}
    </div>
  );
}

// ── Stale overlay — shows last data with STALE badge + age ────────────────
export function StaleOverlay({ lastUpdated, children }: { lastUpdated: Date | null; children: React.ReactNode }) {
  const age = lastUpdated ? Math.round((Date.now() - lastUpdated.getTime()) / 1000) : null;
  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10">
        <span className="text-[7px] font-mono px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--badge-stale-bg)', borderColor: 'var(--badge-stale-border)', color: 'var(--badge-stale-text)' }}>
          STALE{age ? ` · ${age}s ago` : ''}
        </span>
      </div>
      <div className="opacity-60">{children}</div>
    </div>
  );
}

// ── Deferred card — capability not yet active ─────────────────────────────
export function DeferredCard({ capability, activationRequirement, activatedBy }: { capability: string; activationRequirement: string; activatedBy?: string }) {
  return (
    <div className="border rounded-lg p-5" style={{ borderColor: 'var(--badge-deferred-border)', backgroundColor: 'var(--badge-deferred-bg)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[7px] font-mono px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--badge-deferred-bg)', borderColor: 'var(--badge-deferred-border)', color: 'var(--badge-deferred-text)' }}>DEFERRED</span>
        <span className="text-[10px] font-mono text-slate-400">{capability}</span>
      </div>
      <div className="text-[9px] font-mono text-slate-600 mb-1">Activates when: <span className="text-slate-400">{activationRequirement}</span></div>
      {activatedBy && <div className="text-[8px] font-mono text-slate-600">Action required: {activatedBy}</div>}
    </div>
  );
}

// ── Error card — classified error + suggested action ──────────────────────
const ERROR_MESSAGES: Record<ErrorClass, { label: string; action: string }> = {
  network_unreachable: { label: 'Network unreachable', action: 'Check your connection and retry' },
  server_error:        { label: 'Server error', action: 'The API returned an error — retry shortly' },
  auth_required:       { label: 'Authentication required', action: 'Please sign in to continue' },
  permission_denied:   { label: 'Permission denied', action: 'You do not have access to this resource' },
  not_found:           { label: 'Resource not found', action: 'The requested data does not exist' },
  rate_limited:        { label: 'Rate limited', action: 'Too many requests — wait a moment and retry' },
  timeout:             { label: 'Request timed out', action: 'The API took too long — retry or check backend health' },
  engine_unavailable:  { label: 'Engine unavailable', action: 'Activate the engine to use this feature' },
};

export function ErrorCard({ error, retryCount, onRetry }: { error: ErrorClass; retryCount?: number; onRetry?: () => void }) {
  const info = ERROR_MESSAGES[error] ?? { label: 'Unknown error', action: 'Retry' };
  return (
    <div className="border rounded-lg p-5" style={{ borderColor: 'var(--red-border)', backgroundColor: 'var(--red-dim)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[7px] font-mono px-2 py-0.5 rounded border border-red-500/20 bg-red-500/10 text-red-400">ERROR</span>
        <span className="text-[10px] font-mono text-red-400">{info.label}</span>
        {retryCount !== undefined && retryCount > 0 && (
          <span className="text-[8px] font-mono text-slate-600 ml-auto">{retryCount} retries</span>
        )}
      </div>
      <div className="text-[9px] font-mono text-slate-500 mb-3">{info.action}</div>
      {onRetry && (
        <button onClick={onRetry} className="text-[8px] font-mono px-3 py-1.5 rounded border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors">
          ↺ Retry
        </button>
      )}
    </div>
  );
}

// ── Awaiting key card ─────────────────────────────────────────────────────
export function AwaitingKeyCard({ engine, requirement }: { engine: string; requirement: string }) {
  return (
    <div className="border rounded-lg p-5" style={{ borderColor: 'var(--badge-deferred-border)', backgroundColor: 'var(--bg-panel)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[7px] font-mono px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--amber-dim)', borderColor: 'var(--amber-border)', color: 'var(--amber)' }}>AWAITING KEY</span>
        <span className="text-[10px] font-mono text-slate-400">{engine}</span>
      </div>
      <div className="text-[9px] font-mono text-slate-600">{requirement}</div>
    </div>
  );
}
