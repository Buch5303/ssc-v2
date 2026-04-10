'use client';
/**
 * KpiCard — EQS v1.0 / Directive 32 Block I
 * Canonical executive KPI card. Unified across all four dashboards.
 * Replaces 4 separate inline definitions — single source of truth.
 * Token-only styling. DataState-aware (undefined value shows em-dash).
 * Supports optional badge, trend indicator, and accent color.
 */
import { OutputBadge } from '../badges/OutputBadge';

interface KpiCardProps {
  label: string;
  value: string | number | undefined;
  sub?: string;
  accent?: string;       // CSS var e.g. 'var(--cyan)'
  badge?: string;        // ESTIMATED / VERIFIED / LIVE etc — uses OutputBadge typing
  outputType?: 'estimated' | 'verified' | 'generated' | 'seeded' | 'live';
  trend?: 'up' | 'down' | 'neutral'; // optional directional cue
}

export function KpiCard({ label, value, sub, accent, badge, outputType, trend }: KpiCardProps) {
  const accentColor = accent ?? 'var(--cyan)';
  const hasValue    = value !== undefined && value !== null;

  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '14px 16px',         // slightly tighter than 16px — improves density
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      position: 'relative',
    }}>
      {/* Label row — always top, with optional badge flush right */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: badge || outputType ? 'space-between' : 'flex-start',
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: 9, fontFamily: 'monospace',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--text-tertiary)',
        }}>
          {label}
        </span>
        {(badge || outputType) && (
          outputType
            ? <OutputBadge outputType={outputType} />
            : (
              <span style={{
                fontSize: 7, fontFamily: 'monospace', padding: '2px 6px',
                borderRadius: 3, border: '1px solid var(--badge-estimated-border)',
                backgroundColor: 'var(--badge-estimated-bg)',
                color: 'var(--badge-estimated-text)',
              }}>
                {badge}
              </span>
            )
        )}
      </div>

      {/* Value — primary KPI number */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: sub ? 5 : 0 }}>
        <span style={{
          fontSize: 22, fontFamily: 'monospace', fontWeight: 700,
          lineHeight: 1,
          color: hasValue ? accentColor : 'var(--text-tertiary)',
        }}>
          {hasValue ? value : '—'}
        </span>
        {trend && hasValue && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace', lineHeight: 1.8,
            color: trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--text-tertiary)',
          }}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>

      {/* Sub — secondary context line */}
      {sub && (
        <div style={{
          fontSize: 8, fontFamily: 'monospace',
          color: 'var(--text-tertiary)', lineHeight: 1.4,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
