'use client';
/**
 * SectionLabel — EQS v1.0 / Directive 34 Block K
 * Canonical section header for intra-page content blocks.
 * Standardizes font, weight, color, spacing, and optional right-side badge
 * across all four executive dashboards.
 *
 * Two variants:
 *  - 'page'   : top-level section divider (9px, tertiary, uppercase, 0.06em)
 *  - 'card'   : within-card sub-header (10px, secondary, 600, uppercase, 0.05em)
 *
 * Usage:
 *   <SectionLabel>BOP Program Summary</SectionLabel>
 *   <SectionLabel variant="card" right={<OutputBadge />}>Supplier Tier Distribution</SectionLabel>
 */
import { type ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  variant?: 'page' | 'card';
  right?: ReactNode;        // optional right-side badge or control
  mb?: number;              // marginBottom override — default 10 (page) / 14 (card)
}

export function SectionLabel({
  children,
  variant = 'page',
  right,
  mb,
}: SectionLabelProps) {
  const isCard    = variant === 'card';
  const fontSize  = isCard ? 10 : 9;
  const fontWeight = isCard ? 600 : 400;
  const color     = isCard ? 'var(--text-secondary)' : 'var(--text-tertiary)';
  const tracking  = isCard ? '0.05em' : '0.06em';
  const marginBottom = mb ?? (isCard ? 14 : 10);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: right ? 'space-between' : 'flex-start',
      marginBottom,
    }}>
      <span style={{
        fontSize,
        fontFamily: 'monospace',
        fontWeight,
        textTransform: 'uppercase',
        letterSpacing: tracking,
        color,
      }}>
        {children}
      </span>
      {right && (
        <div style={{ flexShrink: 0 }}>
          {right}
        </div>
      )}
    </div>
  );
}
