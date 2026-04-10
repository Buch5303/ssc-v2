"""
procurement_strategy.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — Block F

Per-category procurement strategy output.
For each BOP category, produces:
  - Single-source concentration risk
  - Preferred supplier recommendation
  - RFQ readiness flag
  - Competitive tension assessment
  - Spend tier classification
  - Next action recommendation
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from models import PricingResult, CONF_RFQ_VERIFIED, CONF_SUPPLIER_CATALOG, CONF_PUBLIC_CONTRACT
from bom_library import BOM_LIBRARY


# Spend tier thresholds
TIER_STRATEGIC  = 500_000   # >$500K — major strategic sourcing effort
TIER_TARGETED   = 150_000   # $150K–$500K — targeted competitive RFQ
TIER_STANDARD   = 50_000    # $50K–$150K — standard bidding
TIER_MINOR      = 0         # <$50K — simplified procurement


@dataclass
class ProcurementStrategy:
    """Sourcing strategy for one BOP category."""
    category_code:          str
    category_name:          str
    mid_estimate_usd:       float
    spend_tier:             str    # STRATEGIC | TARGETED | STANDARD | MINOR
    rfq_readiness:          str    # READY | NEEDS_VERIFICATION | NOT_READY
    single_source_risk:     str    # HIGH | MEDIUM | LOW | NONE
    competitive_tension:    str    # HIGH | MEDIUM | LOW
    preferred_suppliers:    str    # comma-separated top 2 suppliers
    avoid_suppliers:        str    # any flagged suppliers
    confidence_label:       str
    confidence_score:       int
    evidence_count:         int
    next_action:            str
    sourcing_note:          str
    timestamp:              str = ""

    def to_dict(self) -> dict:
        return {
            "category_code":       self.category_code,
            "category_name":       self.category_name,
            "mid_estimate_usd":    round(self.mid_estimate_usd),
            "spend_tier":          self.spend_tier,
            "rfq_readiness":       self.rfq_readiness,
            "single_source_risk":  self.single_source_risk,
            "competitive_tension": self.competitive_tension,
            "preferred_suppliers": self.preferred_suppliers,
            "avoid_suppliers":     self.avoid_suppliers,
            "confidence_label":    self.confidence_label,
            "confidence_score":    self.confidence_score,
            "evidence_count":      self.evidence_count,
            "next_action":         self.next_action,
            "sourcing_note":       self.sourcing_note,
            "timestamp":           self.timestamp,
        }


# Known supplier flags — avoid markers from analysis
FLAGGED_SUPPLIERS: Dict[str, str] = {
    "Trillium Flow Technologies": "CRITICAL AVOID — revenue too small for single-source risk on W251",
}

# Known single-source risk categories (few qualified suppliers globally)
SINGLE_SOURCE_RISK_OVERRIDES: Dict[str, str] = {
    "VIB_MON":    "MEDIUM",   # Bently Nevada dominant but alternatives exist
    "TRANSFORMER":"MEDIUM",   # ABB/Siemens dominate large power transformers
    "EMISSIONS":  "LOW",      # Multiple catalyst suppliers
    "GENERATOR":  "HIGH",     # GE/Siemens dominate 50MW+ class generators
}


def classify_spend_tier(mid_usd: float) -> str:
    if mid_usd >= TIER_STRATEGIC:
        return "STRATEGIC"
    if mid_usd >= TIER_TARGETED:
        return "TARGETED"
    if mid_usd >= TIER_STANDARD:
        return "STANDARD"
    return "MINOR"


def assess_rfq_readiness(result: PricingResult) -> str:
    if result.confidence_label == CONF_RFQ_VERIFIED:
        return "VERIFIED"
    if result.confidence_score >= 65 and result.evidence_count >= 2:
        return "READY"
    if result.confidence_score >= 40:
        return "NEEDS_VERIFICATION"
    return "NOT_READY"


def assess_competitive_tension(suppliers: List[str]) -> str:
    if len(suppliers) >= 4:
        return "HIGH"
    if len(suppliers) >= 2:
        return "MEDIUM"
    return "LOW"


def get_next_action(
    category_code: str,
    spend_tier: str,
    rfq_readiness: str,
    single_source_risk: str,
    avoid_suppliers: str,
) -> str:
    if avoid_suppliers:
        return f"URGENT: Resolve avoid flag before RFQ. Select alternative supplier. Then {spend_tier.lower()} RFQ."
    if rfq_readiness == "VERIFIED":
        return "RFQ response received. Update pricing record and close category."
    if spend_tier == "STRATEGIC" and rfq_readiness == "READY":
        return "Issue competitive RFQ immediately — highest spend tier. Target 3+ suppliers."
    if spend_tier == "STRATEGIC" and rfq_readiness == "NEEDS_VERIFICATION":
        return "Verify pricing estimate via supplier contact before RFQ. Budget stake too high for unverified estimate."
    if spend_tier == "TARGETED":
        return "Issue targeted RFQ to top 2 preferred suppliers. Compare responses."
    if single_source_risk == "HIGH":
        return "Investigate alternative suppliers before RFQ. Single-source risk unacceptable at this spend level."
    return "Add to standard bidding round. Monitor for responses."


def build_strategy(
    result: PricingResult,
    timestamp: str = "",
) -> ProcurementStrategy:
    """Build procurement strategy for one category result."""
    cat_def   = BOM_LIBRARY.get(result.category_code, {})
    suppliers = cat_def.get("suppliers", [])

    # Check for flagged suppliers
    avoid = [
        name for name in suppliers
        if name in FLAGGED_SUPPLIERS
    ]
    avoid_str = "; ".join(f"{s} ({FLAGGED_SUPPLIERS[s]})" for s in avoid)

    # Preferred = non-flagged suppliers, top 2
    preferred = [s for s in suppliers if s not in FLAGGED_SUPPLIERS][:2]
    preferred_str = ", ".join(preferred)

    spend_tier  = classify_spend_tier(result.mid_usd)
    rfq_ready   = assess_rfq_readiness(result)
    comp_tension = assess_competitive_tension(suppliers)

    # Single source risk
    single_source = SINGLE_SOURCE_RISK_OVERRIDES.get(result.category_code, "")
    if not single_source:
        if len(suppliers) == 1:
            single_source = "HIGH"
        elif len(suppliers) == 2:
            single_source = "MEDIUM"
        else:
            single_source = "LOW"

    next_action = get_next_action(
        result.category_code, spend_tier, rfq_ready, single_source, avoid_str
    )

    sourcing_note = (
        f"{len(suppliers)} qualified suppliers identified. "
        f"BOM bottom-up: ${result.bom_total_mid:,.0f}. "
        f"Confidence: {result.confidence_score}/100."
    )

    return ProcurementStrategy(
        category_code=result.category_code,
        category_name=result.category,
        mid_estimate_usd=result.mid_usd,
        spend_tier=spend_tier,
        rfq_readiness=rfq_ready,
        single_source_risk=single_source,
        competitive_tension=comp_tension,
        preferred_suppliers=preferred_str,
        avoid_suppliers=avoid_str,
        confidence_label=result.confidence_label,
        confidence_score=result.confidence_score,
        evidence_count=result.evidence_count,
        next_action=next_action,
        sourcing_note=sourcing_note,
        timestamp=timestamp,
    )


def build_all_strategies(
    results: List[PricingResult],
    timestamp: str = "",
) -> List[ProcurementStrategy]:
    """Build procurement strategies for all category results, sorted by spend tier."""
    strategies = [build_strategy(r, timestamp) for r in results]
    tier_order = {"STRATEGIC": 0, "TARGETED": 1, "STANDARD": 2, "MINOR": 3}
    return sorted(strategies, key=lambda s: (tier_order.get(s.spend_tier, 9), -s.mid_estimate_usd))
