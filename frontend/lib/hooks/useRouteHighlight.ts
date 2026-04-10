'use client';
/**
 * useRouteHighlight — EQS v1.0 / Directive 25D + 26C
 * Detects URL hash OR persisted ExecutionContext and scrolls to +
 * highlights the target section on mount.
 *
 * Persistence behavior (Directive 26):
 * - On hash match: saves context to sessionStorage, highlights section
 * - On page revisit without hash: restores from sessionStorage if context valid
 * - Highlight duration: 2.5s for direct nav, 1.5s for restored context
 * - Auto-clears expired or invalid context
 *
 * Usage:
 *   const highlightRef = useRouteHighlight('rfq-drafts', 'rfq-pipeline');
 *   <div ref={highlightRef} id="rfq-drafts"> ... </div>
 */
import { useEffect, useRef } from 'react';
import { ExecutionContextStore } from '../context/ExecutionContextStore';

export function useRouteHighlight(sectionId: string, pageName?: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.replace('#', '');
    const isDirectNav = hash === sectionId;

    // Check persisted context if no direct hash match
    const storedCtx = !isDirectNav ? ExecutionContextStore.load() : null;
    const isRestoredNav = !isDirectNav && storedCtx?.section === sectionId;

    if (!isDirectNav && !isRestoredNav) return;

    const highlightDuration = isDirectNav ? 2500 : 1500;

    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Cyan for direct nav, amber for restored context — visually distinct
      const color = isDirectNav ? 'var(--cyan)' : 'var(--amber)';
      el.style.transition    = 'outline 0.15s ease, outline-offset 0.15s ease';
      el.style.outline       = `2px solid ${color}`;
      el.style.outlineOffset = '4px';
      el.style.borderRadius  = '8px';

      setTimeout(() => {
        if (ref.current) {
          ref.current.style.outline       = '2px solid transparent';
          ref.current.style.outlineOffset = '0px';
        }
      }, highlightDuration);

      // Persist context on direct nav
      if (isDirectNav && pageName) {
        ExecutionContextStore.save({ page: pageName, section: sectionId });
      }

      // Clear restored context after use so it does not re-trigger on every mount
      if (isRestoredNav) {
        ExecutionContextStore.clear();
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [sectionId, pageName]);

  return ref;
}
