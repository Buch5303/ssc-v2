"""
Test: Procurement strategy — spend tiers, RFQ readiness, avoid flags.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import PricingResult, CONF_COMPONENT_BUILDUPS, CONF_RFQ_VERIFIED, CONFIDENCE_SCORES
from procurement_strategy import (
    classify_spend_tier, assess_rfq_readiness, build_strategy, build_all_strategies,
    TIER_STRATEGIC, TIER_TARGETED,
)

def make_result(code, mid, conf=CONF_COMPONENT_BUILDUPS, score=65, evidence_count=3):
    return PricingResult(
        category=code, category_code=code,
        mid_usd=mid, low_usd=mid*0.85, high_usd=mid*1.15,
        confidence_label=conf, confidence_score=score,
        evidence_count=evidence_count, bom_total_mid=mid*0.95,
    )

def test_spend_tier_strategic():
    assert classify_spend_tier(600_000) == "STRATEGIC"
    assert classify_spend_tier(500_001) == "STRATEGIC"

def test_spend_tier_targeted():
    assert classify_spend_tier(200_000) == "TARGETED"

def test_spend_tier_minor():
    assert classify_spend_tier(10_000) == "MINOR"

def test_rfq_readiness_ready():
    result = make_result("VIB_MON", 220_000, score=70, evidence_count=3)
    assert assess_rfq_readiness(result) == "READY"

def test_rfq_readiness_verified():
    result = make_result("VIB_MON", 220_000, conf=CONF_RFQ_VERIFIED, score=100)
    assert assess_rfq_readiness(result) == "VERIFIED"

def test_rfq_readiness_not_ready():
    result = make_result("VIB_MON", 220_000, score=20, evidence_count=1)
    assert assess_rfq_readiness(result) == "NOT_READY"

def test_avoid_supplier_flagged():
    result = make_result("PIPING_VALVES", 500_000)
    strategy = build_strategy(result)
    # Trillium is in PIPING_VALVES suppliers — should be flagged
    assert "Trillium" in strategy.avoid_suppliers
    assert "AVOID" in strategy.avoid_suppliers.upper() or "CRITICAL" in strategy.avoid_suppliers

def test_strategy_to_dict():
    result = make_result("VIB_MON", 220_000)
    strategy = build_strategy(result)
    d = strategy.to_dict()
    required = ["category_code", "spend_tier", "rfq_readiness", "next_action",
                "single_source_risk", "preferred_suppliers"]
    for f in required:
        assert f in d, f"Missing: {f}"

def test_build_all_strategies_sorted_by_tier():
    results = [
        make_result("WATER_WASH", 120_000),
        make_result("GENERATOR",  2_000_000),
        make_result("VIB_MON",    220_000),
    ]
    strategies = build_all_strategies(results)
    assert strategies[0].spend_tier == "STRATEGIC"
    assert strategies[0].category_code == "GENERATOR"

if __name__ == "__main__":
    test_spend_tier_strategic()
    test_spend_tier_targeted()
    test_spend_tier_minor()
    test_rfq_readiness_ready()
    test_rfq_readiness_verified()
    test_rfq_readiness_not_ready()
    test_avoid_supplier_flagged()
    test_strategy_to_dict()
    test_build_all_strategies_sorted_by_tier()
    print("test_procurement_strategy: ALL PASSED")
