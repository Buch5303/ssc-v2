'use client';
import { ReactNode } from 'react';

/**
 * DataState — EQS v1.0 Mandated State Model
 * 
 * Every data-bearing element must render through this wrapper.
 * The dashboard must elegantly distinguish between all 7 states.
 * Degraded dashboards must still feel controlled and intelligent.
 * 
 * States:
 *   loading     — data is being fetched
 *   success     — data is available and current
 *   empty       — query succeeded but returned no data
 *   stale       — data exists but may be outdated (age > threshold)
 *   degraded    — partial data available, some sources failed
 *   awaiting_key — feature requires an API key that is not yet configured
 *   error       — request failed entirely
 */

type DataStateType = 'loading' | 'success' | 'empty' | 'stale' | 'degraded' | 'awaiting_key' | 'error';

interface DataStateProps {
  state: DataStateType;
  children?: ReactNode;
  label?: string;
  detail?: string;
  onRetry?: () => void;
  staleAge?: string;       // e.g. "12 minutes ago"
  degradedSources?: string; // e.g. "Perplexity unavailable"
  awaitingKey?: string;     // e.g. "PERPLEXITY_API_KEY"
  errorMessage?: string;
  minHeight?: number;
}

const stateConfig: Record<DataStateType, { icon: string; title: string; color: string; bg: string; border: string }> = {
  loading:      { icon: '◌', title: 'Loading',         color: 'var(--t3)',  bg: 'transparent',           border: 'var(--line)' },
  success:      { icon: '●', title: 'Current',         color: 'var(--t2)',  bg: 'transparent',           border: 'var(--line)' },
  empty:        { icon: '○', title: 'No Data',          color: 'var(--t3)',  bg: 'transparent',           border: 'var(--line)' },
  stale:        { icon: '◐', title: 'Stale',           color: '#F59E0B',    bg: 'rgba(245,158,11,0.03)', border: 'rgba(245,158,11,0.15)' },
  degraded:     { icon: '◑', title: 'Degraded',        color: '#F59E0B',    bg: 'rgba(245,158,11,0.03)', border: 'rgba(245,158,11,0.15)' },
  awaiting_key: { icon: '◇', title: 'Awaiting Config', color: 'var(--t3)',  bg: 'rgba(30,111,204,0.03)', border: 'rgba(30,111,204,0.15)' },
  error:        { icon: '✗', title: 'Error',           color: '#E83535',    bg: 'rgba(232,53,53,0.03)',  border: 'rgba(232,53,53,0.15)' },
};

export function DataState({
  state,
  children,
  label,
  detail,
  onRetry,
  staleAge,
  degradedSources,
  awaitingKey,
  errorMessage,
  minHeight = 120,
}: DataStateProps) {
  // Success state: render children directly with no chrome
  if (state === 'success') return <>{children || null}</>;

  const cfg = stateConfig[state];

  // Loading: elegant shimmer
  if (state === 'loading') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight, gap: 10,
      }}>
        <div style={{
          width: 160, height: 2, borderRadius: 1,
          background: 'linear-gradient(90deg, transparent, var(--line), transparent)',
          backgroundSize: '200% 100%',
          animation: 'ds-shimmer 1.5s infinite',
        }} />
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
          {label || 'Loading'}
        </span>
        <style>{`@keyframes ds-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
      </div>
    );
  }

  // All non-success, non-loading states: controlled, intelligent placeholder
  const getMessage = (): { title: string; body: string } => {
    switch (state) {
      case 'empty':
        return {
          title: label || 'No data available',
          body: detail || 'This section will populate when data is ingested into the system.',
        };
      case 'stale':
        return {
          title: `Data may be outdated${staleAge ? ` (${staleAge})` : ''}`,
          body: detail || 'Displayed values may not reflect the latest state. The system will refresh automatically.',
        };
      case 'degraded':
        return {
          title: 'Partial data — some sources unavailable',
          body: detail || `${degradedSources ? `Unavailable: ${degradedSources}. ` : ''}Values shown are from available sources. Missing data will populate when all sources recover.`,
        };
      case 'awaiting_key':
        return {
          title: 'Feature requires configuration',
          body: detail || `${awaitingKey ? `API key required: ${awaitingKey}. ` : ''}This capability will activate once the required configuration is provided via the admin panel.`,
        };
      case 'error':
        return {
          title: 'Unable to load this section',
          body: detail || errorMessage || 'An error occurred while fetching data. The system will retry automatically.',
        };
      default:
        return { title: 'Unknown state', body: '' };
    }
  };

  const msg = getMessage();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight, padding: '20px 24px', textAlign: 'center',
      background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 6,
    }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, color: cfg.color, marginBottom: 8 }}>
        {cfg.icon}
      </span>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 600,
        color: cfg.color, letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 6,
      }}>
        {cfg.title}
      </span>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--t1)', marginBottom: 4 }}>
        {msg.title}
      </span>
      <span style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.5, maxWidth: 360 }}>
        {msg.body}
      </span>
      {onRetry && state === 'error' && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 10, padding: '4px 12px', fontSize: 10, fontWeight: 600,
            fontFamily: 'IBM Plex Mono, monospace', background: 'var(--bg3)',
            color: 'var(--t1)', border: '1px solid var(--line)', borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Helper to determine DataState from react-query result
 */
export function getDataState(query: {
  isLoading?: boolean;
  isError?: boolean;
  error?: any;
  data?: any;
  dataUpdatedAt?: number;
}, staleThresholdMs = 300_000): { state: DataStateType; staleAge?: string; errorMessage?: string } {
  if (query.isLoading) return { state: 'loading' };
  if (query.isError) return { state: 'error', errorMessage: query.error?.message };
  if (!query.data) return { state: 'empty' };

  // Check staleness
  if (query.dataUpdatedAt) {
    const age = Date.now() - query.dataUpdatedAt;
    if (age > staleThresholdMs) {
      const mins = Math.floor(age / 60000);
      return { state: 'stale', staleAge: `${mins} minutes ago` };
    }
  }

  return { state: 'success' };
}
