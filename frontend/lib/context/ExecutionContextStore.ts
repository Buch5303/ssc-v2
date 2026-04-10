/**
 * ExecutionContextStore — EQS v1.0 / Directive 26A
 * Lightweight sessionStorage-backed execution context persistence.
 * Persists: last active section, page, item id, timestamp.
 * Expires after 30 minutes of inactivity (session-scoped by design).
 * Clears invalid or stale entries automatically.
 * Never persists sensitive or noisy transient state.
 */

const STORE_KEY = 'flowseer_exec_ctx';
const TTL_MS    = 30 * 60 * 1000; // 30 minutes

export interface ExecutionContext {
  page: string;          // e.g. 'rfq-pipeline'
  section: string;       // anchor id e.g. 'rfq-drafts'
  itemId?: string;       // optional selected item e.g. contact id
  timestamp: number;     // epoch ms — used for TTL
}

/** Valid anchor IDs across the platform — used for stale-context detection */
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
  /** Save context — called by ActionRouteCard on navigate */
  save(ctx: Omit<ExecutionContext, 'timestamp'>): void {
    if (typeof window === 'undefined') return;
    try {
      const entry: ExecutionContext = { ...ctx, timestamp: Date.now() };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(entry));
    } catch {
      // sessionStorage unavailable — fail silently, no UX impact
    }
  },

  /** Load context — called by useRouteHighlight on mount */
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

  /** Clear context — explicit reset or stale entry */
  clear(): void {
    if (typeof window === 'undefined') return;
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* noop */ }
  },

  /** Clear if current page is unrelated to stored context */
  clearIfStale(currentPage: string): void {
    const ctx = ExecutionContextStore.load();
    if (!ctx) return;
    // Clear if page mismatch AND not a cross-page route (cross-page routes are intentional)
    const isCrossPage = ctx.page !== currentPage;
    const isExpired   = Date.now() - ctx.timestamp > TTL_MS;
    if (isExpired) ExecutionContextStore.clear();
    // Do not clear on cross-page — that context is intentional navigation
    void isCrossPage;
  },
};
