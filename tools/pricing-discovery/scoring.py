"""
scoring.py — FlowSeer Pricing Discovery Engine
Directive 53 — Confidence Scoring + Range Calculation

Aggregates evidence from multiple vectors into a single
confidence-weighted price estimate with floor/mid/ceiling range.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from models import (
    PricingEvidence,
    CONFIDENCE_SCORES,
    CONF_BUDGETARY,
    CONF_COMPONENT_BUILDUPS,
    CONF_MARKET_ANCHOR,
    CONF_EIA_BENCHMARK,
    CONF_FERC_RATE_CASE,
    CONF_PUBLIC_CONTRACT,
    CONF_SUPPLIER_CATALOG,
    CONF_RFQ_VERIFIED,
)


def aggregate_price_estimate(
    evidence_items: List[PricingEvidence],
    bom_mid: Optional[float] = None,
) -> Tuple[float, float, float, str, int]:
    """
    Aggregate multiple evidence points into a floor/mid/ceiling estimate.

    Strategy:
    - Highest-confidence sources get most weight
    - BOM bottom-up provides a sanity check floor
    - Outliers (>50% from weighted mean) are flagged and de-weighted
    - Returns (low, mid, high, confidence_label, confidence_score)
    """
    if not evidence_items and not bom_mid:
        return 0, 0, 0, CONF_BUDGETARY, 0

    # Filter to items with actual values
    valid = [e for e in evidence_items if e.normalized_value_usd > 0]

    if not valid and bom_mid:
        # BOM only
        low  = bom_mid * 0.85
        high = bom_mid * 1.25
        return low, bom_mid, high, CONF_COMPONENT_BUILDUPS, CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS]

    if not valid:
        return 0, 0, 0, CONF_BUDGETARY, 0

    # Compute weighted mean (weight = confidence score)
    total_weight = sum(e.confidence_score for e in valid)
    if total_weight == 0:
        return 0, 0, 0, CONF_BUDGETARY, 0

    weighted_mean = sum(e.normalized_value_usd * e.confidence_score for e in valid) / total_weight

    # De-weight outliers (>60% from mean)
    filtered = [
        e for e in valid
        if abs(e.normalized_value_usd - weighted_mean) / max(weighted_mean, 1) <= 0.60
    ]
    outlier_count = len(valid) - len(filtered)

    if not filtered:
        filtered = valid  # fall back if all are outliers

    # Re-compute with filtered set
    total_weight = sum(e.confidence_score for e in filtered)
    mid = sum(e.normalized_value_usd * e.confidence_score for e in filtered) / total_weight

    # Blend with BOM if available
    if bom_mid and bom_mid > 0:
        bom_weight = CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS]
        market_weight = total_weight
        mid = (mid * market_weight + bom_mid * bom_weight) / (market_weight + bom_weight)

    # Range: floor/ceiling based on data spread + uncertainty
    values = [e.normalized_value_usd for e in filtered]
    if bom_mid:
        values.append(bom_mid)

    spread = max(values) - min(values) if len(values) > 1 else mid * 0.15
    base_uncertainty = 0.15  # minimum ±15%

    low_raw  = min(values) if len(values) > 1 else mid * (1 - base_uncertainty)
    high_raw = max(values) if len(values) > 1 else mid * (1 + base_uncertainty)

    # Ensure at least ±10% range even with tight data
    low  = min(low_raw,  mid * 0.85)
    high = max(high_raw, mid * 1.15)

    # Best confidence label = highest confidence source that contributed
    best_conf = max(filtered, key=lambda e: e.confidence_score).confidence_label
    best_score = CONFIDENCE_SCORES.get(best_conf, 40)

    # Bonus: multiple independent sources increase confidence
    if len(filtered) >= 3:
        best_score = min(best_score + 5, 100)
    if outlier_count > 0:
        best_score = max(best_score - 5, 10)

    return low, mid, high, best_conf, best_score


def select_best_confidence(evidence_items: List[PricingEvidence]) -> Tuple[str, int]:
    """Return the highest confidence label and score from evidence items."""
    if not evidence_items:
        return CONF_BUDGETARY, CONFIDENCE_SCORES[CONF_BUDGETARY]
    best = max(evidence_items, key=lambda e: e.confidence_score)
    return best.confidence_label, best.confidence_score


def compute_delta(current_mid: float, prior_mid: float) -> float:
    """Compute percentage change from prior estimate."""
    if prior_mid <= 0:
        return 0.0
    return round((current_mid - prior_mid) / prior_mid * 100, 1)


def summarize_vectors(evidence_items: List[PricingEvidence]) -> dict:
    """Return count of evidence items per vector."""
    counts: dict = {}
    for e in evidence_items:
        counts[e.vector] = counts.get(e.vector, 0) + 1
    return counts
