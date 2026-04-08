import { apiFetch } from './client';

export interface PricingRecord {
  bop_category: string;
  sub_category: string;
  price_low_usd: number;
  price_mid_usd: number;
  price_high_usd: number;
}

export interface PricingSummary {
  _envelope: { output_type: string; freshness: string };
  total_low_usd: number;
  total_mid_usd: number;
  total_high_usd: number;
  category_count: number;
  records: PricingRecord[];
}

export interface TierStat {
  tier: number;
  count: number;
  label: string;
}

export interface TierStats {
  tier_distribution: TierStat[];
  total: number;
}

export const fetchPricingSummary = () => apiFetch<PricingSummary>('/discovery/pricing/summary');
export const fetchTierStats     = () => apiFetch<TierStats>('/discovery/tier-stats');
