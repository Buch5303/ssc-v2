'use client';
/**
 * TermHelper — EQS v1.0 / Directive 38 Block P
 * Inline zero-training contextual helper for domain-specific terms.
 * Renders a muted sublabel directly beside or below a term.
 * Always visible — not hover-only. Mobile-safe.
 * Extremely concise. Integrated into design system.
 */

interface TermHelperProps {
  term: string;
  definition: string;
  inline?: boolean;   // true = side-by-side, false (default) = below
}

export function TermHelper({ term, definition, inline = false }: TermHelperProps) {
  if (inline) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        <span>{term}</span>
        <span style={{
          fontSize: 7, fontFamily: 'monospace',
          color: 'var(--text-tertiary)',
          fontWeight: 400,
          letterSpacing: '0.02em',
        }}>
          {definition}
        </span>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <span>{term}</span>
      <span style={{
        fontSize: 7, fontFamily: 'monospace',
        color: 'var(--text-tertiary)',
        fontWeight: 400,
        letterSpacing: '0.02em',
        lineHeight: 1.3,
      }}>
        {definition}
      </span>
    </span>
  );
}

/**
 * Pre-built helpers for approved platform terms.
 * Import and use directly — no prop needed.
 */
export const TERM_BOP = () => (
  <TermHelper term="BOP" definition="Balance of Plant — supporting equipment outside the core turbine unit" inline />
);

export const TERM_TIER = ({ tier }: { tier: 1 | 2 | 3 | 4 }) => {
  const defs: Record<number, string> = {
    1: 'Tier 1 — Global OEM / strategic direct supplier',
    2: 'Tier 2 — Specialist supplier',
    3: 'Tier 3 — Regional supplier',
    4: 'Tier 4 — Niche or component supplier',
  };
  return <TermHelper term={`Tier ${tier}`} definition={defs[tier]} inline />;
};

export const TERM_FLAG = () => (
  <TermHelper term="FLAG" definition="Risk or attention marker — review before proceeding" inline />
);
