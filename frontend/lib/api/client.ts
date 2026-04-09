import type { DataState, UiState, OutputType, Freshness, ErrorClass, BackendEnvelope } from '../types/ui';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const MAX_RETRIES = 2;
const RETRY_ON = new Set([408, 429, 500, 502, 503, 504]);
const NEVER_RETRY = new Set([400, 401, 403, 404]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const backoff = (a: number) => Math.min(1000 * 2 ** a, 8000);

function deriveOutputType(e: Partial<BackendEnvelope>): OutputType {
  const m: Record<string, OutputType> = {
    estimated:'estimated', generated_analysis:'generated', generated_draft:'generated',
    generated_recommendation:'generated', verified:'verified', derived:'derived',
    cached:'seeded', seeded:'seeded', live:'live', placeholder:'placeholder',
  };
  return m[e.output_type ?? ''] ?? 'derived';
}

function deriveUiState(e: Partial<BackendEnvelope>|null, status: number, hasData: boolean): UiState {
  if (status >= 500 || status === 401 || status === 403) return 'error';
  if (!e) return 'error';
  if (e.readiness === 'awaiting_key' || e.output_type === 'placeholder') return 'awaiting_key';
  if (e.readiness === 'error' || e.freshness === 'unavailable') return 'error';
  if (e.freshness === 'stale') return 'stale';
  if (!hasData) return 'empty';
  return 'operational';
}

function classifyError(status: number, msg?: string): ErrorClass {
  if (!status || msg?.includes('fetch') || msg?.includes('network')) return 'network_unreachable';
  if (status === 401) return 'auth_required';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 408 || msg?.includes('abort')) return 'timeout';
  if (status === 429) return 'rate_limited';
  return 'server_error';
}

function extractData<T>(body: Record<string, unknown>): T | null {
  if (!body || typeof body !== 'object') return null;
  const { _envelope, ok, ...rest } = body as Record<string, unknown>;
  void _envelope; void ok;
  if (Object.keys(rest).length === 0) return null;
  return rest as unknown as T;
}

function errState<T>(err: ErrorClass, msg: string, retries: number): DataState<T> {
  return { data: null, uiState: 'error', freshness: 'unavailable', outputType: 'placeholder', lastUpdated: null, error: err, errorMessage: msg, retryCount: retries };
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<DataState<T>> {
  const url = `${API_BASE}/api${path}`;
  let lastErr: ErrorClass = 'network_unreachable';
  let lastMsg = '';
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt - 1));
    let status = 0;
    try {
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 10_000);
      const res = await fetch(url, { cache: 'no-store', signal: ctl.signal, ...opts });
      clearTimeout(tid);
      status = res.status;
      if (NEVER_RETRY.has(status)) return errState<T>(classifyError(status), `HTTP ${status}`, retries);
      if (!res.ok && RETRY_ON.has(status)) { lastErr = classifyError(status); retries++; continue; }
      const body = await res.json().catch(() => ({}));
      const env: Partial<BackendEnvelope> = body?._envelope ?? {};
      const data = extractData<T>(body);
      const hasData = data !== null && (!Array.isArray(data) || (data as unknown[]).length > 0);
      const uiState = deriveUiState(env, status, hasData);
      if (uiState === 'error') return errState<T>(classifyError(status, env.error ?? ''), env.error ?? '', retries);
      return { data, uiState, freshness: (env.freshness as Freshness) ?? 'cached', outputType: deriveOutputType(env), lastUpdated: new Date(), error: null, retryCount: retries };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lastMsg = msg; lastErr = classifyError(status, msg); retries++;
    }
  }
  return errState<T>(lastErr, lastMsg, retries);
}

export const makeQueryFn = <T>(path: string) => () => apiFetch<T>(path);
