import type { DataState } from '../types/ui';

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
  summary: {
    bop_total_low_usd: number;
    bop_total_mid_usd: number;
    bop_total_high_usd: number;
    pricing_records: number;
    categories_priced: number;
    basis: string;
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

// Type-safe query fn — used by supplier-network
export type TierStatsState = DataState<TierStats>;
