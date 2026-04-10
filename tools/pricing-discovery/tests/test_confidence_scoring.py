import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import PricingEvidence, VECTOR_UTILITY, CONF_FERC_RATE_CASE, CONF_BUDGETARY, CONFIDENCE_SCORES
from scoring import aggregate_price_estimate, compute_delta, select_best_confidence

def make_ev(value, conf_label, vector=VECTOR_UTILITY):
    return PricingEvidence(
        vector=vector, provider="TEST", source_name="test",
        raw_value_usd=value, normalized_value_usd=value,
        confidence_label=conf_label,
        confidence_score=CONFIDENCE_SCORES[conf_label],
    )

def test_single_evidence_returns_value():
    ev = [make_ev(1_000_000, CONF_FERC_RATE_CASE)]
    low, mid, high, conf, score = aggregate_price_estimate(ev)
    assert mid > 0
    assert low <= mid <= high

def test_multiple_evidence_weighted_mean():
    ev = [make_ev(800_000, CONF_BUDGETARY), make_ev(1_200_000, CONF_FERC_RATE_CASE)]
    low, mid, high, conf, score = aggregate_price_estimate(ev)
    assert 800_000 < mid < 1_200_000  # weighted, not simple mean

def test_outlier_deweighted():
    ev = [
        make_ev(1_000_000, CONF_FERC_RATE_CASE),
        make_ev(1_100_000, CONF_FERC_RATE_CASE),
        make_ev(9_000_000, CONF_BUDGETARY),  # outlier
    ]
    low, mid, high, conf, score = aggregate_price_estimate(ev)
    assert mid < 2_000_000  # outlier should not dominate

def test_bom_blend():
    ev = [make_ev(1_000_000, CONF_FERC_RATE_CASE)]
    low, mid, high, conf, score = aggregate_price_estimate(ev, bom_mid=800_000)
    assert mid < 1_000_000  # BOM pulled mid down

def test_no_evidence_no_bom_returns_zero():
    low, mid, high, conf, score = aggregate_price_estimate([])
    assert mid == 0 and score == 0

def test_compute_delta():
    assert compute_delta(1_100_000, 1_000_000) == 10.0
    assert compute_delta(900_000, 1_000_000) == -10.0
    assert compute_delta(1_000_000, 0) == 0.0

if __name__ == "__main__":
    test_single_evidence_returns_value()
    test_multiple_evidence_weighted_mean()
    test_outlier_deweighted()
    test_bom_blend()
    test_no_evidence_no_bom_returns_zero()
    test_compute_delta()
    print("test_confidence_scoring: ALL PASSED")
