'use client';
/**
 * RangeKpiCard — EQS v1.0 / Directive 32A
 * Canonical range-value KPI card for cost-intel BOP budget bands.
 * Part of the same executive KPI band system as KpiCard.
 * Shares identical outer shell (padding, border, radius, token discipline).
 * Extends with tri-value range row (floor ↓ · mid · ceiling ↑).
 * DataState-aware: undefined/missing values render '—' consistently.
 */

interface RangeKpiCardProps {
  label: string;
  low: string;
  mid: string;
  high: string;
  sub?: string;
  badge?: string;      // default: 'ESTIMATED · ±15%'
  showRange?: boolean; // show floor/ceiling flanks — default true for Planning Case
}

export function RangeKpiCard({
  label,
  low,
  mid,
  high,
  sub,
  badge = 'ESTIMATED · ±15%',
  showRange = true,
}: RangeKpiCardProps) {
  const hasMid = mid && mid !== '—';

  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '14px 16px',   // canonical KpiCard padding — matches peers exactly
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>

      {/* Label row — same structure as KpiCard */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 8,
      }}>
        <span style={{
          fontSize: 9, fontFamily: 'monospace',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: 'var(--text-tertiary)',
        }}>
          {label}
        </span>
        {badge && (
          <span style={{
            fontSize: 7, fontFamily: 'monospace', padding: '2px 6px',
            borderRadius: 3, border: '1px solid var(--badge-estimated-border)',
            backgroundColor: 'var(--badge-estimated-bg)',
            color: 'var(--badge-estimated-text)',
          }}>
            {badge}
          </span>
        )}
      </div>

      {/* Range value row — tri-value: floor · mid · ceiling */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: sub ? 5 : 0,
      }}>
        {/* Floor — only show flanks when showRange=true and values differ */}
        {showRange && low !== '—' && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace',
            color: 'var(--amber)', lineHeight: 1.8, flexShrink: 0,
          }}>
            ↓ {low}
          </span>
        )}

        {/* Mid — primary value, same weight/size as KpiCard value */}
        <span style={{
          fontSize: 22, fontFamily: 'monospace', fontWeight: 700,
          color: hasMid ? 'var(--cyan)' : 'var(--text-tertiary)',
          lineHeight: 1, flex: showRange ? undefined : 1,
        }}>
          {mid}
        </span>

        {/* Ceiling */}
        {showRange && high !== '—' && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace',
            color: 'var(--green)', lineHeight: 1.8, flexShrink: 0,
          }}>
            ↑ {high}
          </span>
        )}
      </div>

      {/* Sub — same as KpiCard sub */}
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
