// lib/pricing/masterRuleset.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Master Pricing Ruleset: the base calculation model that is layered on top
// of EVERY custom directive automatically. Set once, injected into every search.
//
// This module is ADDITIVE and fully isolated — it defines the shape of the rules
// and a sensible default. It does not read, write, or alter any existing pricing
// route, dataset, or table.

export type ConfidenceLevel = 'verified' | 'indicative' | 'estimated';

// A single evidence point in the ledger for a line item.
export interface DataPoint {
  id?: string;
  line_item_key: string;   // line_items.id or item_no
  price_usd: number;       // observed price (in the dollars of source_date)
  source: string;          // where it came from (supplier, quote, web, index)
  source_date: string;     // ISO date the price was observed / quoted
  confidence: ConfidenceLevel;
  material_basis?: string | null; // optional note on material assumptions
  created_at?: string;
}

// The base rules that govern how the indicative price is computed from points.
export interface MasterRuleset {
  // Every point normalized to today's dollars using this annual rate.
  inflationAnnualPct: number;
  inflationBasis: string; // human label for what the rate represents

  // Recency weighting: a point's weight halves every N months.
  recencyHalfLifeMonths: number;

  // Confidence weighting multipliers.
  confidenceWeights: Record<ConfidenceLevel, number>;

  // Band derivation.
  bandMethod: 'spread' | 'fixed';
  fixedBandPct: number;        // used when bandMethod = 'fixed' or as fallback
  minPointsForSpread: number;  // need at least this many points to derive a spread

  // Optional material-cost multiplier applied on top (1 = off).
  materialMultiplier: number;
  materialIndexNote: string;

  // When the indicative price recomputes.
  recomputeOn: 'every_new_point';
}

export const DEFAULT_MASTER_RULESET: MasterRuleset = {
  inflationAnnualPct: 4.0,
  inflationBasis: 'PPI fabricated metal products (proxy) — editable',
  recencyHalfLifeMonths: 12,
  confidenceWeights: { verified: 1.0, indicative: 0.6, estimated: 0.35 },
  bandMethod: 'spread',
  fixedBandPct: 15,
  minPointsForSpread: 3,
  materialMultiplier: 1.0,
  materialIndexNote: 'Off by default. Set >1 to layer a steel/nickel index on top.',
  recomputeOn: 'every_new_point',
};

// Render the ruleset as a compact directive header that gets prepended to every
// custom directive automatically, so detailed rules always sit on top.
export function rulesetToDirectiveHeader(r: MasterRuleset): string {
  return [
    'MASTER PRICING RULESET (applies to every line item, non-negotiable):',
    `1. Normalize every data point to today's dollars: inflate from its source date at ${r.inflationAnnualPct}%/yr (${r.inflationBasis}).`,
    `2. Weight points by recency (half-life ${r.recencyHalfLifeMonths} months) and confidence (verified ${r.confidenceWeights.verified}, indicative ${r.confidenceWeights.indicative}, estimated ${r.confidenceWeights.estimated}).`,
    '3. indicative_mid = weighted median of the adjusted points (median resists outlier quotes).',
    r.bandMethod === 'spread'
      ? `4. Band = weighted P25/P75 of adjusted points once >= ${r.minPointsForSpread} points exist; otherwise +/-${r.fixedBandPct}% of mid.`
      : `4. Band = +/-${r.fixedBandPct}% of mid.`,
    r.materialMultiplier !== 1
      ? `5. Apply material multiplier x${r.materialMultiplier} (${r.materialIndexNote}).`
      : '5. No material multiplier (off).',
    '6. Recompute the indicative price on every new data point found. Numbers are indicative, not RFQ quotes — state assumptions and cite sources.',
  ].join('\n');
}
