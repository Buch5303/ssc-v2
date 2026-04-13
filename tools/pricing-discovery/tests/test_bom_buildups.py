import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from bom_library import get_category_bom, get_bom_total, get_all_categories, BOM_LIBRARY

def test_all_19_categories_present():
    cats = get_all_categories()
    assert len(cats) == 19, f"Expected 19 categories, got {len(cats)}"

def test_each_category_has_bom():
    for code in get_all_categories():
        items = get_category_bom(code)
        assert len(items) >= 2, f"{code} has fewer than 2 BOM items"

def test_integration_item_appended():
    for code in get_all_categories():
        items = get_category_bom(code)
        last = items[-1]
        assert "Integration" in last.component or "Installation" in last.component

def test_bom_totals_positive():
    for code in get_all_categories():
        low, mid, high = get_bom_total(code)
        assert low > 0 and mid > 0 and high > 0, f"{code} has zero BOM total"
        assert low <= mid <= high, f"{code} range order wrong"

def test_bom_reasonable_range():
    for code in get_all_categories():
        low, mid, high = get_bom_total(code)
        assert 10_000 < mid < 20_000_000, f"{code} mid ${mid:,.0f} out of reasonable range"

if __name__ == "__main__":
    test_all_19_categories_present()
    test_each_category_has_bom()
    test_integration_item_appended()
    test_bom_totals_positive()
    test_bom_reasonable_range()
    print("test_bom_buildups: ALL PASSED")
