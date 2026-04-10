'use client';
/**
 * useRouteHighlight — EQS v1.0 / Directive 25D + 26C + 27A/B/D
 *
 * Deep-link robustness (Directive 27):
 * - Handles direct load with hash, page-to-page route, refresh on hash,
 *   back/forward navigation (popstate), restored context, invalid targets
 * - Scroll offset accounts for AppShell sidebar top chrome (60px)
 * - Graceful no-op on invalid/missing targets — no stale artifacts
 * - MutationObserver fallback for sections that render after initial mount
 *
 * Persistence (Directive 26):
 * - Direct nav → saves context, cyan highlight (2.5s)
 * - Restored nav → amber highlight (1.5s), clears context after use
 */
import { useEffect, useRef, useCallback } from 'react';
import { ExecutionContextStore } from '../context/ExecutionContextStore';

const SCROLL_OFFSET = 72; // px — clears top chrome / command bar

function scrollToWithOffset(el: HTMLElement) {
  const rect    = el.getBoundingClientRect();
  const absTop  = rect.top + window.scrollY;
  const target  = Math.max(0, absTop - SCROLL_OFFSET);
  window.scrollTo({ top: target, behavior: 'smooth' });
}

function applyHighlight(el: HTMLElement, color: string, duration: number) {
  // Clear any existing highlight first — prevents artifact stacking
  el.style.transition      = 'none';
  el.style.outline         = 'none';
  el.style.outlineOffset   = '0px';

  // Force reflow then apply
  void el.offsetHeight;
  el.style.transition    = 'outline 0.15s ease, outline-offset 0.15s ease';
  el.style.outline       = `2px solid ${color}`;
  el.style.outlineOffset = '6px';
  el.style.borderRadius  = '8px';

  setTimeout(() => {
    if (el) {
      el.style.outline       = '2px solid transparent';
      el.style.outlineOffset = '0px';
    }
  }, duration);
}

export function useRouteHighlight(sectionId: string, pageName?: string) {
  const ref = useRef<HTMLDivElement>(null);

  const attemptHighlight = useCallback((isDirectNav: boolean, isRestoredNav: boolean) => {
    const el = ref.current;
    if (!el) return false; // element not yet rendered

    const highlightDuration = isDirectNav ? 2500 : 1500;
    const color             = isDirectNav ? 'var(--cyan)' : 'var(--amber)';

    scrollToWithOffset(el);
    applyHighlight(el, color, highlightDuration);

    if (isDirectNav && pageName) {
      ExecutionContextStore.save({ page: pageName, section: sectionId });
    }
    if (isRestoredNav) {
      ExecutionContextStore.clear();
    }
    return true;
  }, [sectionId, pageName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function resolve() {
      const hash         = window.location.hash.replace('#', '');
      const isDirectNav  = hash === sectionId;
      const storedCtx    = !isDirectNav ? ExecutionContextStore.load() : null;
      const isRestoredNav = !isDirectNav && storedCtx?.section === sectionId;

      if (!isDirectNav && !isRestoredNav) return;

      // Try immediately — if element is not yet in DOM, retry via MutationObserver
      const timer = setTimeout(() => {
        const success = attemptHighlight(isDirectNav, isRestoredNav);
        if (!success) {
          // Fallback: watch for element to appear (async-rendered sections)
          const observer = new MutationObserver(() => {
            if (ref.current) {
              observer.disconnect();
              attemptHighlight(isDirectNav, isRestoredNav);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          // Safety timeout — stop observing after 3s regardless
          setTimeout(() => observer.disconnect(), 3000);
        }
      }, 200);

      return () => clearTimeout(timer);
    }

    // Initial mount
    const cleanup = resolve();

    // Back/forward navigation — popstate fires when hash changes via browser nav
    function onPopState() { resolve(); }
    window.addEventListener('popstate', onPopState);

    return () => {
      cleanup?.();
      window.removeEventListener('popstate', onPopState);
    };
  }, [sectionId, attemptHighlight]);

  return ref;
}
