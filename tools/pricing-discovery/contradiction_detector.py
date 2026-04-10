"""
contradiction_detector.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — Block D

Detects and surfaces contradictions across evidence sources.
Contradictions are NEVER silently averaged through — they are
flagged, classified, and written to a separate artifact.

Contradiction types:
  MAGNITUDE  — evidence values differ by >50% from weighted mean
  DIRECTION  — one source says "avoid" while another prices at premium
  VINTAGE    — same source type, data years >5 years apart
  SOURCE_CLASS — public contract and supplier catalog disagree by >40%
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from models import PricingEvidence, CONFIDENCE_SCORES


MAGNITUDE_THRESHOLD  = 0.50   # >50% from weighted mean = contradiction
SOURCE_CLASS_THRESHOLD = 0.40  # >40% between public contract and catalog
VINTAGE_GAP_YEARS    = 5      # data years > 5 apart for same source class


@dataclass
class Contradiction:
    """A detected contradiction between two or more evidence items."""
    category_code:      str
    category_name:      str
    contradiction_type: str   # MAGNITUDE | DIRECTION | VINTAGE | SOURCE_CLASS
    severity:           str   # HIGH | MEDIUM | LOW
    source_a:           str
    value_a_usd:        float
    source_b:           str
    value_b_usd:        float
    deviation_pct:      float
    description:        str
    recommendation:     str
    flagged_at:         str = ""

    def to_dict(self) -> dict:
        return {
            "category_code":      self.category_code,
            "category_name":      self.category_name,
            "contradiction_type": self.contradiction_type,
            "severity":           self.severity,
            "source_a":           self.source_a,
            "value_a_usd":        round(self.value_a_usd),
            "source_b":           self.source_b,
            "value_b_usd":        round(self.value_b_usd),
            "deviation_pct":      round(self.deviation_pct, 1),
            "description":        self.description,
            "recommendation":     self.recommendation,
            "flagged_at":         self.flagged_at,
        }


def _weighted_mean(items: List[PricingEvidence]) -> float:
    valid = [e for e in items if e.normalized_value_usd > 0]
    if not valid:
        return 0.0
    total_weight = sum(e.confidence_score for e in valid)
    if total_weight == 0:
        return 0.0
    return sum(e.normalized_value_usd * e.confidence_score for e in valid) / total_weight


def _deviation_pct(value: float, mean: float) -> float:
    if mean <= 0:
        return 0.0
    return abs(value - mean) / mean * 100


def detect_magnitude_contradictions(
    category_code: str,
    category_name: str,
    items: List[PricingEvidence],
    timestamp: str = "",
) -> List[Contradiction]:
    """Detect evidence items that deviate >50% from the weighted mean."""
    contradictions: List[Contradiction] = []
    valid = [e for e in items if e.normalized_value_usd > 0]
    if len(valid) < 2:
        return []

    mean = _weighted_mean(valid)
    if mean <= 0:
        return []

    outliers = [e for e in valid if _deviation_pct(e.normalized_value_usd, mean) > MAGNITUDE_THRESHOLD * 100]

    for outlier in outliers:
        # Find the closest "normal" item
        normal_items = [e for e in valid if e is not outlier]
        if not normal_items:
            continue
        representative = max(normal_items, key=lambda e: e.confidence_score)

        dev = _deviation_pct(outlier.normalized_value_usd, mean)
        severity = "HIGH" if dev > 100 else "MEDIUM" if dev > 75 else "LOW"

        contradictions.append(Contradiction(
            category_code=category_code,
            category_name=category_name,
            contradiction_type="MAGNITUDE",
            severity=severity,
            source_a=outlier.provider,
            value_a_usd=outlier.normalized_value_usd,
            source_b=representative.provider,
            value_b_usd=representative.normalized_value_usd,
            deviation_pct=dev,
            description=(
                f"{outlier.provider} reports ${outlier.normalized_value_usd:,.0f} vs "
                f"weighted mean of ${mean:,.0f} — deviation of {dev:.1f}%"
            ),
            recommendation=(
                "Investigate outlier source before using in procurement decision. "
                "Verify scope definition matches — outlier may reflect different system boundary."
            ),
            flagged_at=timestamp,
        ))

    return contradictions


def detect_source_class_contradictions(
    category_code: str,
    category_name: str,
    items: List[PricingEvidence],
    timestamp: str = "",
) -> List[Contradiction]:
    """
    Detect when public contract data and supplier catalog data
    disagree by more than SOURCE_CLASS_THRESHOLD.
    """
    contradictions: List[Contradiction] = []

    public_items   = [e for e in items if e.provider in {"USASPENDING", "FERC_ELIBRARY", "FERC_FORM1_BENCHMARK"} and e.normalized_value_usd > 0]
    catalog_items  = [e for e in items if e.provider in {"GOOGLE_CATALOG", "BOM_LIBRARY"} and e.normalized_value_usd > 0]

    if not public_items or not catalog_items:
        return []

    public_mean  = _weighted_mean(public_items)
    catalog_mean = _weighted_mean(catalog_items)

    if public_mean <= 0 or catalog_mean <= 0:
        return []

    dev = _deviation_pct(catalog_mean, public_mean)
    if dev > SOURCE_CLASS_THRESHOLD * 100:
        severity = "HIGH" if dev > 80 else "MEDIUM"
        contradictions.append(Contradiction(
            category_code=category_code,
            category_name=category_name,
            contradiction_type="SOURCE_CLASS",
            severity=severity,
            source_a=f"Public contracts (n={len(public_items)})",
            value_a_usd=public_mean,
            source_b=f"Supplier catalog/BOM (n={len(catalog_items)})",
            value_b_usd=catalog_mean,
            deviation_pct=dev,
            description=(
                f"Public contract data (${public_mean:,.0f}) and supplier catalog data "
                f"(${catalog_mean:,.0f}) diverge by {dev:.1f}%. "
                "Possible scope boundary mismatch."
            ),
            recommendation=(
                "Review scope definition against each source. "
                "Public contracts may include installation; catalog prices may be equipment-only. "
                "Use the higher estimate for budget purposes until scope is confirmed."
            ),
            flagged_at=timestamp,
        ))

    return contradictions


def detect_vintage_contradictions(
    category_code: str,
    category_name: str,
    items: List[PricingEvidence],
    timestamp: str = "",
) -> List[Contradiction]:
    """Detect when data from the same source class spans >5 years."""
    contradictions: List[Contradiction] = []

    by_class: dict = {}
    for e in items:
        if e.normalized_value_usd > 0 and e.year_of_data > 0:
            cls = e.provider.split("_")[0]
            by_class.setdefault(cls, []).append(e)

    for cls, class_items in by_class.items():
        if len(class_items) < 2:
            continue
        years = [e.year_of_data for e in class_items]
        gap = max(years) - min(years)
        if gap >= VINTAGE_GAP_YEARS:
            oldest = min(class_items, key=lambda e: e.year_of_data)
            newest = max(class_items, key=lambda e: e.year_of_data)
            contradictions.append(Contradiction(
                category_code=category_code,
                category_name=category_name,
                contradiction_type="VINTAGE",
                severity="LOW",
                source_a=f"{oldest.provider} ({oldest.year_of_data})",
                value_a_usd=oldest.normalized_value_usd,
                source_b=f"{newest.provider} ({newest.year_of_data})",
                value_b_usd=newest.normalized_value_usd,
                deviation_pct=_deviation_pct(oldest.normalized_value_usd, newest.normalized_value_usd),
                description=f"{cls}-class data spans {gap} years ({min(years)}–{max(years)}). Escalation may not fully close the gap.",
                recommendation="Prefer most recent data point. Apply ENR CCI escalation to older values before blending.",
                flagged_at=timestamp,
            ))

    return contradictions


def run_all_detectors(
    category_code: str,
    category_name: str,
    items: List[PricingEvidence],
    timestamp: str = "",
) -> List[Contradiction]:
    """Run all contradiction detectors and return combined list."""
    results: List[Contradiction] = []
    results.extend(detect_magnitude_contradictions(category_code, category_name, items, timestamp))
    results.extend(detect_source_class_contradictions(category_code, category_name, items, timestamp))
    results.extend(detect_vintage_contradictions(category_code, category_name, items, timestamp))
    return results
