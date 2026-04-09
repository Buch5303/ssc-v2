'use client';
import type { OutputType, Freshness } from '../../lib/types/ui';

interface BadgeProps {
  outputType: OutputType;
  freshness?: Freshness;
  className?: string;
}

const BADGE_CONFIG: Record<OutputType, { label: string; style: string }> = {
  estimated:   { label: 'ESTIMATED · ±15%',        style: 'bg-[var(--badge-estimated-bg)] border-[var(--badge-estimated-border)] text-[var(--badge-estimated-text)]' },
  verified:    { label: 'VERIFIED',                  style: 'bg-[var(--badge-verified-bg)] border-[var(--badge-verified-border)] text-[var(--badge-verified-text)]' },
  generated:   { label: 'AI GENERATED',              style: 'bg-[var(--badge-generated-bg)] border-[var(--badge-generated-border)] text-[var(--badge-generated-text)]' },
  seeded:      { label: 'SEEDED',                    style: 'bg-[var(--badge-seeded-bg)] border-[var(--badge-seeded-border)] text-[var(--badge-seeded-text)]' },
  live:        { label: '● LIVE',                    style: 'bg-[var(--badge-live-bg)] border-[var(--badge-live-border)] text-[var(--badge-live-text)]' },
  derived:     { label: 'DERIVED',                   style: 'bg-[var(--badge-stale-bg)] border-[var(--badge-stale-border)] text-[var(--badge-stale-text)]' },
  placeholder: { label: 'AWAITING',                  style: 'bg-[var(--badge-deferred-bg)] border-[var(--badge-deferred-border)] text-[var(--badge-deferred-text)]' },
};

export function OutputBadge({ outputType, freshness, className = '' }: BadgeProps) {
  const config = BADGE_CONFIG[outputType] ?? BADGE_CONFIG.derived;
  const isStale = freshness === 'stale';

  return (
    <span
      className={`text-[7px] font-mono px-2 py-0.5 rounded border ${isStale ? 'bg-[var(--badge-stale-bg)] border-[var(--badge-stale-border)] text-[var(--badge-stale-text)]' : config.style} ${className}`}
      title={outputType === 'estimated' ? 'Web research · Not RFQ · For budgeting reference only' : undefined}
    >
      {isStale ? 'STALE' : config.label}
    </span>
  );
}
