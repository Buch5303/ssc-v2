"""
normalization_trace.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — Block E

Full normalization audit trail per evidence item.
Every MW scaling factor, ENR CCI escalation, and scope
adjustment is recorded so any estimate can be reproduced
from its raw inputs.

Outputs: pricing_normalization_trace.csv
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from models import PricingEvidence
from comparable_machines import ENR_CCI


@dataclass
class NormalizationTrace:
    """Complete normalization record for one evidence item."""
    category_code:          str
    category_name:          str
    provider:               str
    vector:                 str
    source_name:            str
    raw_value_usd:          float
    # Year normalization
    data_year:              int
    target_year:            int = 2024
    cci_data_year:          float = 0.0
    cci_target_year:        float = 0.0
    year_escalation_factor: float = 1.0
    year_escalated_value:   float = 0.0
    # MW normalization
    source_mw:              float = 0.0
    target_mw:              float = 50.0
    power_law_exponent:     float = 0.7
    mw_scale_factor:        float = 1.0
    mw_scaled_value:        float = 0.0
    # Final
    final_normalized_value: float = 0.0
    normalization_steps:    str   = ""   # human-readable step description
    confidence_label:       str   = ""
    confidence_score:       int   = 0
    evidence_url:           str   = ""
    timestamp:              str   = ""

    def to_dict(self) -> dict:
        return {
            "category_code":          self.category_code,
            "category_name":          self.category_name,
            "provider":               self.provider,
            "vector":                 self.vector,
            "source_name":            self.source_name,
            "raw_value_usd":          round(self.raw_value_usd),
            "data_year":              self.data_year,
            "target_year":            self.target_year,
            "cci_data_year":          round(self.cci_data_year, 1),
            "cci_target_year":        round(self.cci_target_year, 1),
            "year_escalation_factor": round(self.year_escalation_factor, 4),
            "year_escalated_value":   round(self.year_escalated_value),
            "source_mw":              self.source_mw,
            "target_mw":              self.target_mw,
            "power_law_exponent":     self.power_law_exponent,
            "mw_scale_factor":        round(self.mw_scale_factor, 4),
            "mw_scaled_value":        round(self.mw_scaled_value),
            "final_normalized_value": round(self.final_normalized_value),
            "normalization_steps":    self.normalization_steps,
            "confidence_label":       self.confidence_label,
            "confidence_score":       self.confidence_score,
            "evidence_url":           self.evidence_url,
            "timestamp":              self.timestamp,
        }


def build_trace(
    category_code: str,
    category_name: str,
    evidence: PricingEvidence,
    target_year: int = 2024,
    target_mw: float = 50.0,
) -> NormalizationTrace:
    """
    Build a full normalization trace for one evidence item.
    Reconstructs every calculation step from the evidence metadata.
    """
    trace = NormalizationTrace(
        category_code=category_code,
        category_name=category_name,
        provider=evidence.provider,
        vector=evidence.vector,
        source_name=evidence.source_name,
        raw_value_usd=evidence.raw_value_usd,
        data_year=evidence.year_of_data,
        target_year=target_year,
        target_mw=target_mw,
        confidence_label=evidence.confidence_label,
        confidence_score=evidence.confidence_score,
        evidence_url=evidence.evidence_url,
        timestamp=evidence.timestamp,
    )

    steps = []
    current_value = evidence.raw_value_usd

    # Step 1: Year normalization via ENR CCI
    cci_data   = ENR_CCI.get(evidence.year_of_data, ENR_CCI[2024])
    cci_target = ENR_CCI.get(target_year, ENR_CCI[2024])
    year_factor = cci_target / cci_data if cci_data > 0 else 1.0

    trace.cci_data_year          = cci_data
    trace.cci_target_year        = cci_target
    trace.year_escalation_factor = year_factor
    year_escalated               = current_value * year_factor
    trace.year_escalated_value   = year_escalated

    if abs(year_factor - 1.0) > 0.001:
        steps.append(
            f"Year: ${current_value:,.0f} × ENR CCI ({evidence.year_of_data}={cci_data:.1f}→{target_year}={cci_target:.1f}) "
            f"× {year_factor:.4f} = ${year_escalated:,.0f}"
        )
    else:
        steps.append(f"Year: no escalation needed ({evidence.year_of_data} = target year)")

    current_value = year_escalated

    # Step 2: MW normalization (only if source_mw is known and differs from target)
    source_mw = evidence.mw_ref or 0.0
    if source_mw > 0 and abs(source_mw - target_mw) > 0.5:
        mw_factor = (target_mw / source_mw) ** 0.7
        mw_scaled = current_value * mw_factor
        trace.source_mw        = source_mw
        trace.mw_scale_factor  = mw_factor
        trace.mw_scaled_value  = mw_scaled
        steps.append(
            f"MW: ${current_value:,.0f} × ({target_mw}/{source_mw})^0.7 "
            f"× {mw_factor:.4f} = ${mw_scaled:,.0f}"
        )
        current_value = mw_scaled
    else:
        trace.source_mw       = source_mw or target_mw
        trace.mw_scale_factor = 1.0
        trace.mw_scaled_value = current_value
        steps.append(f"MW: no scaling needed (source MW = target MW = {target_mw})")

    trace.final_normalized_value = current_value
    trace.normalization_steps    = " | ".join(steps)

    return trace


def build_traces_for_category(
    category_code: str,
    category_name: str,
    evidence_items: List[PricingEvidence],
    target_year: int = 2024,
    target_mw: float = 50.0,
) -> List[NormalizationTrace]:
    """Build normalization traces for all evidence items in a category."""
    return [
        build_trace(category_code, category_name, e, target_year, target_mw)
        for e in evidence_items
        if e.raw_value_usd > 0
    ]
