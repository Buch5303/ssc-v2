// lib/pricing/computeIndicative.ts
// ─────────────────────────────────────────────────────────────────────────────
// The indicative-price engine. Pure, deterministic, no side effects — given a
// line item's data-point ledger and the Master Ruleset, it recomputes the
// indicative low / mid / high. Isolated: it never touches the live listing.

import type { DataPoint, MasterRuleset } from './masterRuleset';

export interface AdjustedPoint {
  price_usd: number;      // original observed price
  adjusted_usd: number;   // normalized to today's dollars (+ material multiplier)
  weight: number;         // recency x confidence
  source: string;
  source_date: string;
  confidence: string;
  ageMonths: number;
}

export interface IndicativeResult {
  low: number | null;
  mid: number | null;
  high: number | null;
  pointsUsed: number;
  bandMethod: 'spread' | 'fixed' | 'none';
  reasoning: string;
  adjustedPoints: AdjustedPoint[];
}

function monthsBetween(fromISO: string, to: Date): number {
  const from = new Date(fromISO);
  if (isNaN(from.getTime())) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.4375));
}

// Weighted percentile over (value, weight) pairs. p in [0,1].
function weightedPercentile(pairs: { v: number; w: number }[], p: number): number {
  const sorted = [...pairs].sort((a, b) => a.v - b.v);
  const totalW = sorted.reduce((s, x) => s + x.w, 0);
  if (totalW <= 0) return sorted.length ? sorted[Math.floor(p * (sorted.length - 1))].v : 0;
  const target = p * totalW;
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= target) return x.v;
  }
  return sorted[sorted.length - 1].v;
}

export function computeIndicative(points: DataPoint[], rules: MasterRuleset): IndicativeResult {
  const now = new Date();

  const adjusted: AdjustedPoint[] = points
    .filter((p) => typeof p.price_usd === 'number' && p.price_usd > 0)
    .map((p) => {
      const ageMonths = monthsBetween(p.source_date, now);
      const years = ageMonths / 12;
      const inflationFactor = Math.pow(1 + rules.inflationAnnualPct / 100, years);
      const adjusted_usd = p.price_usd * inflationFactor * (rules.materialMultiplier || 1);

      const recencyWeight = Math.pow(0.5, ageMonths / Math.max(1, rules.recencyHalfLifeMonths));
      const confWeight = rules.confidenceWeights[p.confidence] ?? 0.5;
      const weight = Math.max(0.0001, recencyWeight * confWeight);

      return {
        price_usd: p.price_usd,
        adjusted_usd,
        weight,
        source: p.source,
        source_date: p.source_date,
        confidence: p.confidence,
        ageMonths: Math.round(ageMonths),
      };
    });

  if (adjusted.length === 0) {
    return {
      low: null, mid: null, high: null, pointsUsed: 0, bandMethod: 'none',
      reasoning: 'No data points in the ledger yet. Add a point (or seed from the current listing) to compute an indicative price.',
      adjustedPoints: [],
    };
  }

  const pairs = adjusted.map((a) => ({ v: a.adjusted_usd, w: a.weight }));
  const mid = weightedPercentile(pairs, 0.5);

  let low: number, high: number, bandMethod: 'spread' | 'fixed';
  if (rules.bandMethod === 'spread' && adjusted.length >= rules.minPointsForSpread) {
    low = weightedPercentile(pairs, 0.25);
    high = weightedPercentile(pairs, 0.75);
    bandMethod = 'spread';
    // Guard against a degenerate band collapsing onto mid.
    if (high - low < mid * 0.02) {
      low = mid * (1 - rules.fixedBandPct / 100);
      high = mid * (1 + rules.fixedBandPct / 100);
      bandMethod = 'fixed';
    }
  } else {
    low = mid * (1 - rules.fixedBandPct / 100);
    high = mid * (1 + rules.fixedBandPct / 100);
    bandMethod = 'fixed';
  }

  const round = (n: number) => Math.round(n / 100) * 100;
  const reasoning =
    `${adjusted.length} data point(s), each inflated to today at ${rules.inflationAnnualPct}%/yr and weighted by recency ` +
    `(half-life ${rules.recencyHalfLifeMonths}mo) and confidence. Mid = weighted median of adjusted prices` +
    (bandMethod === 'spread'
      ? `; band = weighted P25/P75 of the adjusted points.`
      : `; band = +/-${rules.fixedBandPct}% of mid` +
        (adjusted.length < rules.minPointsForSpread ? ` (fewer than ${rules.minPointsForSpread} points, spread not yet derivable).` : '.')) +
    (rules.materialMultiplier !== 1 ? ` Material multiplier x${rules.materialMultiplier} applied.` : '');

  return {
    low: round(low),
    mid: round(mid),
    high: round(high),
    pointsUsed: adjusted.length,
    bandMethod,
    reasoning,
    adjustedPoints: adjusted.sort((a, b) => b.weight - a.weight),
  };
}
