/**
 * FlowSeer Platform Type Definitions
 * TG20/W251 — Client: Borderplex — Santa Teresa NM
 */

export interface ProgramSummary {
  program:             string;
  location:            string;
  client:              string;
  gt_supplier:         string;
  program_manager:     string;
  total_bop_mid:       number;
  total_bop_low:       number;
  total_bop_high:      number;
  bop_categories:      number;
  total_contacts:      number;
  verified_contacts:   number;
  total_rfqs:          number;
  rfqs_responded:      number;
  rfqs_drafted:        number;
  rfq_send_date:       string;
  days_to_rfq_send:    number;
  baker_hughes_quote:  number;
  last_updated:        string;
}

export type Confidence = 'RFQ_VERIFIED' | 'MARKET_ANCHOR' | 'COMPONENT_BUILDUPS' | 'ESTIMATED';
export type SpendTier  = 'STRATEGIC' | 'TARGETED' | 'STANDARD';

export interface PricingCategory {
  category:           string;
  category_code:      string;
  spend_tier:         SpendTier;
  bom_low:            number;
  bom_mid:            number;
  bom_high:           number;
  rfq_quoted?:        number | null;
  rfq_variance_pct?:  number | null;
  confidence:         Confidence;
  confidence_score?:  number;
  preferred_supplier: string;
  avoid_supplier?:    string;
  scenario_optimistic?: number;
  scenario_base?:       number;
  scenario_pessimistic?: number;
}

export interface PricingData {
  categories:   PricingCategory[];
  total_mid:    number;
  verified:     number;
  estimated:    number;
  last_updated: string;
}

export type RFQStatus = 'RESPONDED' | 'DRAFTED' | 'SENT' | 'AWARDED' | 'BLOCKED' | 'DECLINED';

export interface RFQ {
  id:              string;
  contact:         string;
  company:         string;
  category:        string;
  category_code:   string;
  est_value_usd:   number;
  status:          RFQStatus;
  sent_date?:      string | null;
  response_date?:  string | null;
  quoted_price?:   number | null;
  variance_pct?:   number | null;
  notes?:          string;
}

export interface RFQPipeline {
  rfqs:           RFQ[];
  total:          number;
  responded:      number;
  drafted:        number;
  pipeline_value: number;
  rfq_send_date:  string;
  days_out:       number;
  last_updated?:  string;
}

export interface SupplierProfile {
  name:         string;
  category:     string;
  status:       string;
  alert?:       string;
}

export interface SupplierNetwork {
  total_suppliers:     number;
  by_tier:             Record<string, number>;
  strategic_tier1:     number;
  preferred_suppliers: SupplierProfile[];
  avoid_suppliers:     Array<{ name: string; reason: string }>;
  last_updated?:       string;
}

export interface ContactStats {
  total:             number;
  verified:          number;
  by_priority:       Record<string, number>;
  verification_rate: number;
  top_contacts:      Array<{ name: string; company: string; status: string; score?: number }>;
  last_updated?:     string;
}

export interface KPIBand {
  primary_signal:        string;
  primary_action:        string;
  critical_alert:        string;
  days_to_rfq:           number;
  rfq_date:              string;
  total_bop:             string;
  pipeline_value:        string;
  categories_verified:   string;
  last_updated:          string;
}

export interface Alert {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  code:     string;
  title:    string;
  detail:   string;
  action:   string;
}
