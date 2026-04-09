/**
 * FlowSeer UI Type System — EQS v1.0
 * These types are the contract between the API adapter and every component.
 * No component defines its own state semantics.
 */

/** What the backend _envelope.output_type maps to in the UI */
export type OutputType =
  | 'estimated'   // amber  — web-researched, not RFQ
  | 'verified'    // green  — Perplexity-confirmed or RFQ-returned
  | 'generated'   // purple — Claude AI output
  | 'seeded'      // cyan   — approved DB data
  | 'live'        // green pulse — real-time API call result
  | 'derived'     // slate  — computed from other sources
  | 'placeholder';// slate  — awaiting activation

/** From _envelope.freshness */
export type Freshness = 'live' | 'cached' | 'seeded' | 'stale' | 'unavailable';

/** From _envelope.readiness */
export type Readiness = 'operational' | 'awaiting_key' | 'error' | 'transient_error';

/**
 * The 7 mandatory UI states.
 * Every data-driven component handles all 7.
 * null renders and blank outputs are prohibited.
 */
export type UiState =
  | 'loading'      // skeleton shimmer — data in flight
  | 'operational'  // full data render with freshness badge
  | 'stale'        // last known data + STALE badge + age timestamp
  | 'degraded'     // last known data + DEGRADED badge + retry count
  | 'awaiting_key' // DeferredCard — shows what activates the capability
  | 'error'        // ErrorCard — classified error type + suggested action
  | 'empty';       // EmptyState — explains what populates this + next action

/** Classified error types — HTTP codes never reach components */
export type ErrorClass =
  | 'network_unreachable'
  | 'server_error'
  | 'auth_required'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'engine_unavailable';

/** The contract all data-driven components receive */
export interface DataState<T> {
  data: T | null;
  uiState: UiState;
  freshness: Freshness;
  outputType: OutputType;
  lastUpdated: Date | null;
  error: ErrorClass | null;
  errorMessage?: string;
  retryCount?: number;
}

/** Backend _envelope shape */
export interface BackendEnvelope {
  contract_version: string;
  engine: string;
  module: string;
  timestamp: string;
  freshness: string;
  output_type: string;
  source_summary: string;
  readiness: string;
  error: string | null;
}
