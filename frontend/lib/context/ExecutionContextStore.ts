/**
 * ExecutionContextStore — EQS v1.0 / Directive 26A + 27D
 * Lightweight sessionStorage-backed execution context persistence.
 * Persists: last active section, page, item id, timestamp.
 * Expires after 30 minutes (session-scoped).
 *
 * Directive 27D additions:
 * - Validates target section exists in DOM before restore
 * - Clears hash from URL if invalid target — no confusing leftover
 * - Graceful fallback on every failure path
 */

const STORE_KEY = 'flowseer_exec_ctx';
const TTL_MS    = 30 * 60 * 1000; // 30 minutes

export interface ExecutionContext {
  page: string;
  section: string;
  itemId?: string;
  timestamp: number;
}

const VALID_SECTIONS = new Set([
  'rfq-drafts', 'rfq-queue', 'ai-analysis',
  'enrichment-status', 'contact-coverage',
  'cost-verification', 'category-table',
]);

function isValid(ctx: ExecutionContext): boolean {
  if (!ctx.page || !ctx.section) return false;
  if (!VALID_SECTIONS.has(ctx.section)) return false;
  if (Date.now() - ctx.timestamp > TTL_MS) return false;
  return true;
}

export const ExecutionContextStore = {
  save(ctx: Omit<ExecutionContext, 'timestamp'>): void {
    if (typeof window === 'undefined') return;
    try {
      const entry: ExecutionContext = { ...ctx, timestamp: Date.now() };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(entry));
    } catch { /* noop */ }
  },

  load(): ExecutionContext | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const ctx = JSON.parse(raw) as ExecutionContext;
      if (!isValid(ctx)) {
        ExecutionContextStore.clear();
        return null;
      }
      return ctx;
    } catch {
      return null;
    }
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* noop */ }
  },

  clearIfStale(currentPage: string): void {
    void currentPage; // cross-page context is intentional — do not clear on mismatch
    const ctx = ExecutionContextStore.load();
    if (!ctx) return;
    if (Date.now() - ctx.timestamp > TTL_MS) ExecutionContextStore.clear();
  },

  /**
   * Directive 27D — validate hash in current URL.
   * If hash target is not in VALID_SECTIONS, clear it from the URL silently.
   * Prevents confusing dead-end hash artifacts after bad deep-links.
   */
  sanitizeHash(): void {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (hash && !VALID_SECTIONS.has(hash)) {
      // Replace current history entry with hash-free URL — no back-nav side-effects
      try {
        const cleanUrl = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', cleanUrl);
      } catch { /* noop */ }
    }
  },
};
