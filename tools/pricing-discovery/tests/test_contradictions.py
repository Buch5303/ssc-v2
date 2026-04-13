"""
Test: Contradiction detection — contradictions surfaced, never averaged through.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import PricingEvidence, VECTOR_UTILITY, VECTOR_TRADE, CONF_FERC_RATE_CASE, CONF_BUDGETARY, CONFIDENCE_SCORES
from contradiction_detector import (
    detect_magnitude_contradictions,
    detect_source_class_contradictions,
    detect_vintage_contradictions,
    run_all_detectors,
)

def make_ev(value, provider, year=2024, conf=CONF_FERC_RATE_CASE, vector=VECTOR_UTILITY):
    return PricingEvidence(
        vector=vector, provider=provider, source_name=provider,
        raw_value_usd=value, normalized_value_usd=value,
        year_of_data=year,
        confidence_label=conf, confidence_score=CONFIDENCE_SCORES[conf],
    )

def test_magnitude_contradiction_detected():
    items = [
        make_ev(1_000_000, "FERC_ELIBRARY"),
        make_ev(1_100_000, "EIA_FORM860"),
        make_ev(5_000_000, "USASPENDING"),  # outlier >50% from mean
    ]
    results = detect_magnitude_contradictions("VIB_MON", "Vibration Monitoring", items)
    assert len(results) > 0
    assert any(r.contradiction_type == "MAGNITUDE" for r in results)

def test_no_contradiction_within_threshold():
    items = [
        make_ev(1_000_000, "FERC_ELIBRARY"),
        make_ev(1_100_000, "EIA_FORM860"),
        make_ev(950_000,   "USASPENDING"),
    ]
    results = detect_magnitude_contradictions("VIB_MON", "Vibration Monitoring", items)
    assert len(results) == 0

def test_source_class_contradiction():
    items = [
        make_ev(1_000_000, "USASPENDING"),
        make_ev(1_800_000, "BOM_LIBRARY", vector=VECTOR_TRADE),   # >40% from public
    ]
    results = detect_source_class_contradictions("FUEL_GAS", "Fuel Gas", items)
    assert len(results) > 0
    assert results[0].contradiction_type == "SOURCE_CLASS"

def test_vintage_contradiction():
    items = [
        make_ev(800_000, "FERC_FORM1_BENCHMARK", year=2010),
        make_ev(1_100_000, "FERC_FORM1_BENCHMARK", year=2024),  # 14-year gap
    ]
    results = detect_vintage_contradictions("LUBE_OIL", "Lube Oil", items)
    assert len(results) > 0
    assert results[0].contradiction_type == "VINTAGE"

def test_run_all_detectors_combines_results():
    items = [
        make_ev(1_000_000, "FERC_ELIBRARY"),
        make_ev(5_000_000, "USASPENDING"),  # magnitude
        make_ev(700_000, "BOM_LIBRARY", vector=VECTOR_TRADE),   # source class
    ]
    results = run_all_detectors("VIB_MON", "Vibration Monitoring", items)
    assert len(results) >= 1

def test_single_evidence_no_contradiction():
    items = [make_ev(1_000_000, "FERC_ELIBRARY")]
    results = run_all_detectors("VIB_MON", "Vibration Monitoring", items)
    assert len(results) == 0  # can't contradict with one source

def test_contradiction_to_dict():
    items = [make_ev(1_000_000, "FERC_ELIBRARY"), make_ev(5_000_000, "USASPENDING")]
    results = detect_magnitude_contradictions("VIB_MON", "Vibration Monitoring", items)
    assert len(results) > 0
    d = results[0].to_dict()
    assert "category_code" in d
    assert "contradiction_type" in d
    assert "severity" in d
    assert "recommendation" in d

if __name__ == "__main__":
    test_magnitude_contradiction_detected()
    test_no_contradiction_within_threshold()
    test_source_class_contradiction()
    test_vintage_contradiction()
    test_run_all_detectors_combines_results()
    test_single_evidence_no_contradiction()
    test_contradiction_to_dict()
    print("test_contradictions: ALL PASSED")
