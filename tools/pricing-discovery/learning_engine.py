"""
learning_engine.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — Block G

When RFQ responses arrive, this module:
  1. Ingests the RFQ truth (actual supplier response price)
  2. Computes delta vs. prior estimate
  3. Classifies the error (overestimate / underestimate / accurate)
  4. Updates confidence for that category
  5. Computes cross-category learning signals (e.g., if VIB_MON was
     consistently underestimated, other instrumentation categories
     should be adjusted upward)
  6. Writes pricing_learning_deltas.csv

Only runs when rfq_truths are provided — otherwise produces no output.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from models import (
    PricingResult,
    CONF_RFQ_VERIFIED,
    CONFIDENCE_SCORES,
)


# Classification thresholds
ACCURATE_BAND    = 0.15   # within ±15% = accurate
MISS_THRESHOLD   = 0.30   # >30% miss = significant


@dataclass
class LearningDelta:
    """Delta between prior estimate and RFQ truth for one category."""
    category_code:          str
    category_name:          str
    prior_estimate_usd:     float
    rfq_truth_usd:          float
    delta_usd:              float
    delta_pct:              float
    classification:         str    # ACCURATE | OVERESTIMATE | UNDERESTIMATE | SIGNIFICANT_MISS
    prior_confidence_label: str
    prior_confidence_score: int
    updated_confidence:     str    # RFQ_VERIFIED
    updated_confidence_score: int  # always 100 after RFQ truth
    source_vector:          str
    supplier_name:          str
    rfq_date:               str
    error_direction:        str    # OVER | UNDER | NEUTRAL
    error_magnitude:        str    # MINOR | MODERATE | SIGNIFICANT
    cross_category_signal:  str    # learning signal for related categories
    notes:                  str = ""
    timestamp:              str = ""

    def to_dict(self) -> dict:
        return {
            "category_code":           self.category_code,
            "category_name":           self.category_name,
            "prior_estimate_usd":      round(self.prior_estimate_usd),
            "rfq_truth_usd":           round(self.rfq_truth_usd),
            "delta_usd":               round(self.delta_usd),
            "delta_pct":               round(self.delta_pct, 1),
            "classification":          self.classification,
            "prior_confidence_label":  self.prior_confidence_label,
            "prior_confidence_score":  self.prior_confidence_score,
            "updated_confidence":      self.updated_confidence,
            "updated_confidence_score":self.updated_confidence_score,
            "source_vector":           self.source_vector,
            "supplier_name":           self.supplier_name,
            "rfq_date":                self.rfq_date,
            "error_direction":         self.error_direction,
            "error_magnitude":         self.error_magnitude,
            "cross_category_signal":   self.cross_category_signal,
            "notes":                   self.notes,
            "timestamp":               self.timestamp,
        }


# Category groupings for cross-category signal propagation
CATEGORY_GROUPS: Dict[str, str] = {
    "VIB_MON":      "instrumentation",
    "CONTROLS_DCS": "instrumentation",
    "TELECOMS":     "instrumentation",
    "FUEL_GAS":     "mechanical_skid",
    "LUBE_OIL":     "mechanical_skid",
    "WATER_WASH":   "mechanical_skid",
    "FUEL_OIL":     "mechanical_skid",
    "INLET_AIR":    "filtration_acoustic",
    "ACOUSTIC":     "filtration_acoustic",
    "EXHAUST":      "exhaust_emissions",
    "EMISSIONS":    "exhaust_emissions",
    "PIPING_VALVES":"civil_mechanical",
    "CIVIL_STRUCT": "civil_mechanical",
    "COOLING":      "civil_mechanical",
    "FIRE_FIGHT":   "safety",
    "ELEC_DIST":    "electrical",
    "STARTING":     "electrical",
    "TRANSFORMER":  "electrical",
    "GENERATOR":    "electrical",
}


def _classify(delta_pct: float) -> Tuple[str, str, str]:
    """Returns (classification, error_direction, error_magnitude)."""
    abs_pct = abs(delta_pct)

    if abs_pct <= ACCURATE_BAND * 100:
        direction = "NEUTRAL"
        magnitude = "MINOR"
        classification = "ACCURATE"
    elif delta_pct > 0:
        direction = "OVER"
        magnitude = "SIGNIFICANT" if abs_pct > MISS_THRESHOLD * 100 else "MODERATE"
        classification = "OVERESTIMATE" if abs_pct <= MISS_THRESHOLD * 100 else "SIGNIFICANT_MISS"
    else:
        direction = "UNDER"
        magnitude = "SIGNIFICANT" if abs_pct > MISS_THRESHOLD * 100 else "MODERATE"
        classification = "UNDERESTIMATE" if abs_pct <= MISS_THRESHOLD * 100 else "SIGNIFICANT_MISS"

    return classification, direction, magnitude


def _cross_category_signal(
    category_code: str,
    error_direction: str,
    delta_pct: float,
) -> str:
    """Generate cross-category learning signal."""
    group = CATEGORY_GROUPS.get(category_code, "")
    if not group or error_direction == "NEUTRAL":
        return "No cross-category adjustment signal"

    related = [c for c, g in CATEGORY_GROUPS.items() if g == group and c != category_code]
    if not related:
        return "No related categories in same group"

    direction_word = "upward" if error_direction == "UNDER" else "downward"
    adjustment = min(abs(delta_pct) * 0.5, 15.0)  # propagate at 50% weight, cap at ±15%

    return (
        f"Group '{group}' signal: consider {adjustment:.1f}% {direction_word} adjustment "
        f"for related categories: {', '.join(related[:3])}"
    )


def compute_delta(
    result: PricingResult,
    rfq_truth_usd: float,
    supplier_name: str = "",
    rfq_date: str = "",
    timestamp: str = "",
) -> LearningDelta:
    """
    Compute learning delta for one category given RFQ truth.
    Updates the result object's confidence to RFQ_VERIFIED.
    """
    delta_usd = result.mid_usd - rfq_truth_usd
    delta_pct = (delta_usd / rfq_truth_usd * 100) if rfq_truth_usd > 0 else 0.0
    classification, direction, magnitude = _classify(delta_pct)
    cross_signal = _cross_category_signal(result.category_code, direction, delta_pct)

    notes = []
    if magnitude == "SIGNIFICANT":
        notes.append(
            f"Significant {direction.lower()}estimate of {abs(delta_pct):.1f}%. "
            "Review BOM scope and comparable machine assumptions for this category."
        )
    if result.bom_total_mid > 0:
        bom_delta = (result.bom_total_mid - rfq_truth_usd) / rfq_truth_usd * 100
        notes.append(f"BOM bottom-up was {bom_delta:+.1f}% vs truth.")

    return LearningDelta(
        category_code=result.category_code,
        category_name=result.category,
        prior_estimate_usd=result.mid_usd,
        rfq_truth_usd=rfq_truth_usd,
        delta_usd=delta_usd,
        delta_pct=delta_pct,
        classification=classification,
        prior_confidence_label=result.confidence_label,
        prior_confidence_score=result.confidence_score,
        updated_confidence=CONF_RFQ_VERIFIED,
        updated_confidence_score=CONFIDENCE_SCORES[CONF_RFQ_VERIFIED],
        source_vector="RFQ_RESPONSE",
        supplier_name=supplier_name,
        rfq_date=rfq_date,
        error_direction=direction,
        error_magnitude=magnitude,
        cross_category_signal=cross_signal,
        notes=" | ".join(notes),
        timestamp=timestamp,
    )


def compute_all_deltas(
    results: List[PricingResult],
    rfq_truths: Dict[str, dict],
    timestamp: str = "",
) -> List[LearningDelta]:
    """
    Compute learning deltas for all categories where RFQ truths exist.
    rfq_truths: {category_code: {"price": float, "supplier": str, "date": str}}
    """
    deltas: List[LearningDelta] = []
    result_map = {r.category_code: r for r in results}

    for code, truth in rfq_truths.items():
        result = result_map.get(code)
        if not result:
            continue
        delta = compute_delta(
            result=result,
            rfq_truth_usd=float(truth.get("price", 0)),
            supplier_name=truth.get("supplier", ""),
            rfq_date=truth.get("date", ""),
            timestamp=timestamp,
        )
        deltas.append(delta)

    # Sort by absolute delta magnitude
    return sorted(deltas, key=lambda d: abs(d.delta_pct), reverse=True)
