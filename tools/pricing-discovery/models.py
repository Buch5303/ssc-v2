"""
models.py — FlowSeer Pricing Discovery Engine
Directive 53 — W251 BOP Pricing Intelligence

Dataclasses, confidence vocabulary, and type definitions.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional


# ── Confidence vocabulary ─────────────────────────────────────────────────────
CONF_RFQ_VERIFIED        = "RFQ_VERIFIED"           # 100
CONF_SUPPLIER_CATALOG    = "SUPPLIER_CATALOG"        # 85
CONF_PUBLIC_CONTRACT     = "PUBLIC_CONTRACT"         # 80
CONF_FERC_RATE_CASE      = "FERC_RATE_CASE"          # 78
CONF_EIA_BENCHMARK       = "EIA_BENCHMARK"           # 70
CONF_COMPONENT_BUILDUPS  = "COMPONENT_BUILDUPS"      # 65
CONF_MARKET_ANCHOR       = "MARKET_ANCHOR"           # 60
CONF_PERPLEXITY          = "PERPLEXITY_SYNTHESIS"    # 55
CONF_BUDGETARY           = "BUDGETARY_ESTIMATE"      # 40

CONFIDENCE_SCORES = {
    CONF_RFQ_VERIFIED:       100,
    CONF_SUPPLIER_CATALOG:    85,
    CONF_PUBLIC_CONTRACT:     80,
    CONF_FERC_RATE_CASE:      78,
    CONF_EIA_BENCHMARK:       70,
    CONF_COMPONENT_BUILDUPS:  65,
    CONF_MARKET_ANCHOR:       60,
    CONF_PERPLEXITY:          55,
    CONF_BUDGETARY:           40,
}

# ── Vector labels ─────────────────────────────────────────────────────────────
VECTOR_BOM          = "COMPONENT_BOM"
VECTOR_ANALOGOUS    = "ANALOGOUS_MACHINE"
VECTOR_UTILITY      = "UTILITY_REGULATORY"
VECTOR_TRADE        = "TRADE_PRESS"
VECTOR_SYNTHESIS    = "PERPLEXITY_SYNTHESIS"
VECTOR_RFQ          = "RFQ_RESPONSE"


@dataclass
class BomItem:
    """Single component in a BOP system BOM."""
    component:          str
    description:        str
    low_usd:            float
    mid_usd:            float
    high_usd:           float
    unit:               str = "system"
    source:             str = ""
    confidence:         str = CONF_BUDGETARY
    notes:              str = ""


@dataclass
class PricingEvidence:
    """One piece of evidence supporting a price estimate."""
    vector:             str       # which discovery vector found this
    provider:           str       # which source adapter
    source_name:        str       # human-readable source label
    evidence_url:       str = ""
    raw_value_usd:      float = 0.0
    normalized_value_usd: float = 0.0
    year_of_data:       int = 0
    cost_index_applied: str = ""  # e.g. "ENR CCI 2024"
    machine_ref:        str = ""  # e.g. "GE Frame 6B 42MW"
    mw_ref:             float = 0.0
    mw_target:          float = 50.0  # W251B8
    normalization_factor: float = 1.0
    confidence_label:   str = CONF_BUDGETARY
    confidence_score:   int = 40
    snippet:            str = ""
    timestamp:          str = ""
    notes:              str = ""


@dataclass
class PricingResult:
    """Full pricing result for one BOP category."""
    category:           str
    category_code:      str       # e.g. "VIB_MON"
    low_usd:            float = 0.0
    mid_usd:            float = 0.0
    high_usd:           float = 0.0
    confidence_label:   str = CONF_BUDGETARY
    confidence_score:   int = 40
    primary_vector:     str = ""
    evidence_count:     int = 0
    evidence_items:     List[PricingEvidence] = field(default_factory=list)
    bom_items:          List[BomItem] = field(default_factory=list)
    bom_total_mid:      float = 0.0
    analogous_refs:     List[str] = field(default_factory=list)
    data_year:          int = 0
    cost_index:         str = ""
    notes:              str = ""
    last_updated:       str = ""
    prior_mid_usd:      float = 0.0   # for change tracking
    delta_pct:          float = 0.0

    def to_flat_dict(self) -> dict:
        import json
        return {
            "category":         self.category,
            "category_code":    self.category_code,
            "low_usd":          round(self.low_usd),
            "mid_usd":          round(self.mid_usd),
            "high_usd":         round(self.high_usd),
            "confidence_label": self.confidence_label,
            "confidence_score": self.confidence_score,
            "primary_vector":   self.primary_vector,
            "evidence_count":   self.evidence_count,
            "bom_total_mid":    round(self.bom_total_mid),
            "analogous_refs":   "; ".join(self.analogous_refs),
            "data_year":        self.data_year,
            "cost_index":       self.cost_index,
            "prior_mid_usd":    round(self.prior_mid_usd),
            "delta_pct":        round(self.delta_pct, 1),
            "notes":            self.notes,
            "last_updated":     self.last_updated,
            "evidence_json":    json.dumps(
                [vars(e) for e in self.evidence_items], ensure_ascii=False
            ),
        }
