"""
Test: Normalization trace — every MW and year adjustment is recorded.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import PricingEvidence, VECTOR_ANALOGOUS, CONF_COMPONENT_BUILDUPS, CONFIDENCE_SCORES
from normalization_trace import build_trace, build_traces_for_category

def make_ev(value, provider="COMPARABLE_MACHINES", year=2019, mw_ref=42.0):
    return PricingEvidence(
        vector=VECTOR_ANALOGOUS, provider=provider, source_name="test",
        raw_value_usd=value, normalized_value_usd=value,
        year_of_data=year, mw_ref=mw_ref, mw_target=50.0,
        confidence_label=CONF_COMPONENT_BUILDUPS,
        confidence_score=CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS],
    )

def test_year_escalation_recorded():
    ev = make_ev(1_000_000, year=2019)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev, target_year=2024)
    assert trace.year_escalation_factor > 1.0  # 2019 → 2024 escalates up
    assert trace.year_escalated_value > trace.raw_value_usd
    assert trace.cci_data_year > 0
    assert trace.cci_target_year > trace.cci_data_year

def test_mw_scaling_recorded():
    ev = make_ev(1_000_000, mw_ref=42.0)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev, target_mw=50.0)
    assert trace.mw_scale_factor > 1.0  # 42→50 MW scales up
    assert trace.mw_scaled_value > trace.year_escalated_value

def test_same_year_no_escalation():
    ev = make_ev(1_000_000, year=2024)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev, target_year=2024)
    assert abs(trace.year_escalation_factor - 1.0) < 0.001

def test_same_mw_no_scaling():
    ev = make_ev(1_000_000, mw_ref=50.0)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev, target_mw=50.0)
    assert abs(trace.mw_scale_factor - 1.0) < 0.001

def test_steps_documented():
    ev = make_ev(1_000_000, year=2018, mw_ref=87.0)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev)
    assert len(trace.normalization_steps) > 0
    assert "Year" in trace.normalization_steps
    assert "MW" in trace.normalization_steps

def test_to_dict_complete():
    ev = make_ev(1_000_000)
    trace = build_trace("VIB_MON", "Vibration Monitoring", ev)
    d = trace.to_dict()
    required = ["category_code", "provider", "raw_value_usd", "year_escalation_factor",
                "mw_scale_factor", "final_normalized_value", "normalization_steps"]
    for field in required:
        assert field in d, f"Missing field: {field}"

def test_batch_traces():
    items = [make_ev(1_000_000, year=y, mw_ref=m) for y, m in [(2018, 42), (2022, 87), (2024, 50)]]
    traces = build_traces_for_category("VIB_MON", "Vibration Monitoring", items)
    assert len(traces) == 3

if __name__ == "__main__":
    test_year_escalation_recorded()
    test_mw_scaling_recorded()
    test_same_year_no_escalation()
    test_same_mw_no_scaling()
    test_steps_documented()
    test_to_dict_complete()
    test_batch_traces()
    print("test_normalization_trace: ALL PASSED")
