import { apiFetch } from './client';

export interface PricingCategory {
  category: string;
  category_name: string;
  group: string;
  total_low_usd: number;
  total_mid_usd: number;
  total_high_usd: number;
  item_count: number;
}

export interface PricingGroup {
  group: string;
  total_low: number;
  total_mid: number;
  total_high: number;
  categories: string[];
}

export interface PricingSummary {
  _envelope: { output_type: string; freshness: string };
  summary: {
    bop_total_low_usd: number;
    bop_total_mid_usd: number;
    bop_total_high_usd: number;
    pricing_records: number;
    categories_priced: number;
  };
  by_category: PricingCategory[];
  by_group: PricingGroup[];
}

export interface TierStat {
  tier: number;
  count: number;
}

export interface TierStats {
  tier_distribution: TierStat[];
  total: number;
}

export const fetchPricingSummary = () => apiFetch<PricingSummary>('/discovery/pricing/summary');
export const fetchTierStats     = () => apiFetch<TierStats>('/discovery/tier-stats');
