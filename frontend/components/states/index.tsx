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

// ── Empty state — always explains what populates this ─────────────────────
export function EmptyState({ title, description, action }: { title: string; description: string; action?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-[10px] font-mono text-slate-400 font-semibold mb-1">{title}</div>
      <div className="text-[9px] font-mono text-slate-600 max-w-xs">{description}</div>
      {action && <div className="text-[8px] font-mono text-cyan-400 mt-3 border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 rounded">{action}</div>}
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
