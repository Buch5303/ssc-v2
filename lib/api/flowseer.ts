/**
 * FlowSeer Data Fetchers
 * All data reads from GitHub JSON files — updates within 60s of any push.
 */
import { ghFetch } from './client';
import type {
  ProgramSummary, PricingData, RFQPipeline,
  SupplierNetwork, ContactStats, KPIBand,
} from '../types/flowseer';

export const fetchProgramSummary  = () => ghFetch<ProgramSummary>('program_summary.json');
export const fetchPricingData      = () => ghFetch<PricingData>('pricing_data.json');
export const fetchRFQPipeline      = () => ghFetch<RFQPipeline>('rfq_pipeline.json');
export const fetchSupplierNetwork  = () => ghFetch<SupplierNetwork>('supplier_network.json');
export const fetchContactStats     = () => ghFetch<ContactStats>('contact_stats.json');
export const fetchKPIBand          = () => ghFetch<KPIBand>('kpi_band.json');

/** Compute days until May 25, 2026 RFQ send */
export function daysToSend(): number {
  return Math.ceil((new Date('2026-05-25').getTime() - Date.now()) / 86_400_000);
}

/** Format currency values */
export function fmtCurrency(n: number, decimals = 2): string {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

/** Format with commas */
export function fmtNum(n: number): string {
  return n?.toLocaleString() ?? '—';
}

/** Variance display */
export function fmtVariance(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
