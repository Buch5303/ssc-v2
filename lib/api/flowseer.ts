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
export const fetchPricingData      = async () => {
  const raw = await ghFetch<any>('pricing_data.json').catch(() => null);
  if (!raw) return null;
  // Normalize: API may return numbers as strings
  return {
    ...raw,
    total_mid: Number(raw.total_mid) || 0,
    verified: Number(raw.verified) || 0,
    estimated: Number(raw.estimated) || 0,
    categories: (raw.categories || []).map((c: any) => ({
      ...c,
      bom_low: Number(c.bom_low) || 0,
      bom_mid: Number(c.bom_mid) || 0,
      bom_high: Number(c.bom_high) || 0,
      rfq_quoted: c.rfq_quoted && String(c.rfq_quoted) !== '' ? Number(c.rfq_quoted) : null,
      rfq_variance_pct: c.rfq_variance_pct && String(c.rfq_variance_pct) !== '' ? Number(c.rfq_variance_pct) : null,
      confidence_score: c.confidence_score ? Number(c.confidence_score) : undefined,
      scenario_optimistic: c.scenario_optimistic ? Number(c.scenario_optimistic) : undefined,
      scenario_base: c.scenario_base ? Number(c.scenario_base) : undefined,
      scenario_pessimistic: c.scenario_pessimistic ? Number(c.scenario_pessimistic) : undefined,
    })),
  } as PricingData;
};
export const fetchRFQPipeline      = () => ghFetch<RFQPipeline>('rfq_pipeline.json');
export const fetchSupplierNetwork  = () => ghFetch<SupplierNetwork>('supplier_network.json');
export const fetchContactStats     = () => ghFetch<ContactStats>('contact_stats.json');
export const fetchKPIBand          = () => ghFetch<KPIBand>('kpi_band.json');

/** Compute days until May 25, 2026 RFQ send */
export function daysToSend(): number {
  return Math.ceil((new Date('2026-05-25').getTime() - Date.now()) / 86_400_000);
}

/** Format currency values */
export function fmtCurrency(n: number | string, decimals = 2): string {
  const num = Number(n);
  if (!num && num !== 0) return '—';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(decimals)}M`;
  if (num >= 1_000)     return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
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
