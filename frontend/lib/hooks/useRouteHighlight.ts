'use client';
/**
 * useRouteHighlight — EQS v1.0 / Directive 25D
 * Detects URL hash on mount and scrolls to + briefly highlights
 * the target section, preserving route-state context when an
 * executive navigates from an ActionRouteCard.
 *
 * Usage:
 *   const highlightRef = useRouteHighlight('rfq-drafts');
 *   <div ref={highlightRef} id="rfq-drafts"> ... </div>
 */
import { useEffect, useRef } from 'react';

export function useRouteHighlight(sectionId: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (hash !== sectionId) return;

    // Small delay to allow page render
    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el) return;

      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Apply highlight ring — uses token colors, fades out after 2s
      el.style.transition = 'outline 0.1s ease, outline-offset 0.1s ease';
      el.style.outline = '2px solid var(--cyan)';
      el.style.outlineOffset = '4px';
      el.style.borderRadius = '8px';

      setTimeout(() => {
        if (ref.current) {
          ref.current.style.outline = '2px solid transparent';
          ref.current.style.outlineOffset = '0px';
        }
      }, 2000);
    }, 150);

    return () => clearTimeout(timer);
  }, [sectionId]);

  return ref;
}
