"""
Test: Learning engine — RFQ truth ingestion and delta classification.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import PricingResult, CONF_COMPONENT_BUILDUPS, CONF_RFQ_VERIFIED, CONFIDENCE_SCORES
from learning_engine import compute_delta, compute_all_deltas, _classify

def make_result(code, mid, bom_mid=0):
    return PricingResult(
        category=code, category_code=code,
        mid_usd=mid, low_usd=mid*0.85, high_usd=mid*1.15,
        confidence_label=CONF_COMPONENT_BUILDUPS,
        confidence_score=CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS],
        bom_total_mid=bom_mid or mid,
    )

def test_accurate_classification():
    classification, direction, magnitude = _classify(10.0)
    assert classification == "ACCURATE"
    assert direction == "NEUTRAL"

def test_overestimate_classification():
    classification, direction, magnitude = _classify(25.0)
    assert classification == "OVERESTIMATE"
    assert direction == "OVER"

def test_underestimate_classification():
    classification, direction, magnitude = _classify(-25.0)
    assert classification == "UNDERESTIMATE"
    assert direction == "UNDER"

def test_significant_miss():
    classification, direction, magnitude = _classify(45.0)
    assert classification == "SIGNIFICANT_MISS"
    assert magnitude == "SIGNIFICANT"

def test_compute_delta_accurate():
    result = make_result("VIB_MON", 220_000)
    delta = compute_delta(result, rfq_truth_usd=230_000, supplier_name="Baker Hughes")
    assert delta.classification == "ACCURATE"
    assert delta.updated_confidence == CONF_RFQ_VERIFIED
    assert delta.updated_confidence_score == 100

def test_compute_delta_significant_miss():
    result = make_result("VIB_MON", 220_000)
    delta = compute_delta(result, rfq_truth_usd=350_000)
    assert delta.classification in {"UNDERESTIMATE", "SIGNIFICANT_MISS"}
    assert "cross_category_signal" in delta.to_dict()

def test_compute_all_deltas():
    results = [
        make_result("VIB_MON", 220_000),
        make_result("INLET_AIR", 480_000),
    ]
    truths = {
        "VIB_MON":   {"price": 340_000, "supplier": "Baker Hughes", "date": "2026-04-01"},
        "INLET_AIR": {"price": 490_000, "supplier": "Donaldson",    "date": "2026-04-10"},
    }
    deltas = compute_all_deltas(results, truths)
    assert len(deltas) == 2
    # Sorted by abs delta_pct descending
    assert abs(deltas[0].delta_pct) >= abs(deltas[-1].delta_pct)

def test_no_truths_no_deltas():
    results = [make_result("VIB_MON", 220_000)]
    deltas = compute_all_deltas(results, {})
    assert len(deltas) == 0

def test_to_dict_complete():
    result = make_result("VIB_MON", 220_000)
    delta = compute_delta(result, rfq_truth_usd=340_000)
    d = delta.to_dict()
    required = ["category_code", "prior_estimate_usd", "rfq_truth_usd",
                "delta_pct", "classification", "cross_category_signal",
                "updated_confidence", "updated_confidence_score"]
    for f in required:
        assert f in d, f"Missing: {f}"

if __name__ == "__main__":
    test_accurate_classification()
    test_overestimate_classification()
    test_underestimate_classification()
    test_significant_miss()
    test_compute_delta_accurate()
    test_compute_delta_significant_miss()
    test_compute_all_deltas()
    test_no_truths_no_deltas()
    test_to_dict_complete()
    print("test_learning_engine: ALL PASSED")
