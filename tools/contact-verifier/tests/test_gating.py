"""
Test: Apollo priority gating — only ACTIVE_RFQ, TIER1, BLOCKED.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from providers.apollo import apollo_allowed_for_priority
from models import APOLLO_ALLOWED_PRIORITIES


def test_all_allowed_priorities():
    for p in APOLLO_ALLOWED_PRIORITIES:
        assert apollo_allowed_for_priority(p), f"{p} should be allowed"


def test_disallowed_priorities():
    for p in ["HIGH_VALUE", "NORMAL", "low", "standard", "", "UNKNOWN"]:
        assert not apollo_allowed_for_priority(p), f"{p} should NOT be allowed"


def test_case_insensitive():
    assert apollo_allowed_for_priority("active_rfq")
    assert apollo_allowed_for_priority("Tier1")
    assert not apollo_allowed_for_priority("high_value")


if __name__ == "__main__":
    test_all_allowed_priorities()
    test_disallowed_priorities()
    test_case_insensitive()
    print("test_gating: ALL PASSED")
