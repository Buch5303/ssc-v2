import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from comparable_machines import normalize_to_current, normalize_by_mw, get_bop_benchmark_from_kw, ENR_CCI

def test_same_year_no_change():
    val, note = normalize_to_current(1_000_000, 2024, 2024)
    assert abs(val - 1_000_000) < 1

def test_escalation_increases_value():
    val_2010, _ = normalize_to_current(1_000_000, 2010, 2024)
    assert val_2010 > 1_000_000

def test_mw_scale_up():
    val, factor = normalize_by_mw(1_000_000, source_mw=42, target_mw=50)
    assert val > 1_000_000
    assert factor > 1.0

def test_mw_scale_down():
    val, factor = normalize_by_mw(1_000_000, source_mw=87, target_mw=50)
    assert val < 1_000_000
    assert factor < 1.0

def test_mw_power_law():
    val, factor = normalize_by_mw(1_000_000, source_mw=50, target_mw=100)
    expected_factor = (100/50) ** 0.7
    assert abs(factor - expected_factor) < 0.001

def test_benchmark_returns_positive():
    for machine_id in ["GE_6B", "GE_7EA", "W251_SELF"]:
        low, mid, high, note = get_bop_benchmark_from_kw(machine_id)
        assert mid > 0, f"{machine_id} returned zero mid"
        assert low < mid < high

if __name__ == "__main__":
    test_same_year_no_change()
    test_escalation_increases_value()
    test_mw_scale_up()
    test_mw_scale_down()
    test_mw_power_law()
    test_benchmark_returns_positive()
    print("test_normalization: ALL PASSED")
