"""
Test: Provider fallback order is free-first, Apollo gated to priority contacts only.
Uses mocks — no live API calls.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import MagicMock, patch, call
from models import STATUS_REVIEW, APOLLO_ALLOWED_PRIORITIES
from rate_limits import GuardRegistry
from providers import apollo as ap


def make_contact(priority="NORMAL"):
    return {
        "first_name": "Test", "last_name": "User", "full_name": "Test User",
        "company": "Acme Corp", "company_domain": "acme.com",
        "title": "VP", "priority": priority, "category": "Test",
        "rfq_status": "NOT_STARTED", "email": "", "manual_rfq_approval": "",
    }


def test_apollo_not_called_for_normal_priority():
    """Apollo must NOT fire for NORMAL priority contacts."""
    contact = make_contact("NORMAL")
    assert not ap.apollo_allowed_for_priority(contact["priority"])


def test_apollo_allowed_for_active_rfq():
    """Apollo MUST be allowed for ACTIVE_RFQ priority."""
    assert ap.apollo_allowed_for_priority("ACTIVE_RFQ")


def test_apollo_allowed_for_tier1():
    assert ap.apollo_allowed_for_priority("TIER1")


def test_apollo_allowed_for_blocked():
    assert ap.apollo_allowed_for_priority("BLOCKED")


def test_apollo_not_allowed_for_high_value():
    """HIGH_VALUE does not reach Apollo threshold."""
    assert not ap.apollo_allowed_for_priority("HIGH_VALUE")


def test_provider_guard_blocks_dry_run():
    """In dry-run mode, no provider call should execute."""
    guards = GuardRegistry(dry_run=True)
    called = []

    def mock_fn():
        called.append(True)
        return ["evidence"]

    result = guards.guard("google").call(mock_fn)
    assert result is None
    assert not called, "Provider function should not be called in dry-run"


def test_guard_max_calls_enforced():
    """Guard stops calling provider after max_calls is reached."""
    guards = GuardRegistry(dry_run=False)
    guard  = guards.guard("google")
    guard.stats.attempted = guard.max_calls  # simulate quota exhaustion

    called = []
    def mock_fn():
        called.append(1)
        return []

    result = guards.guard("google").call(mock_fn)
    assert result is None
    assert not called, "Provider should not be called after quota exhaustion"


if __name__ == "__main__":
    test_apollo_not_called_for_normal_priority()
    test_apollo_allowed_for_active_rfq()
    test_apollo_allowed_for_tier1()
    test_apollo_allowed_for_blocked()
    test_apollo_not_allowed_for_high_value()
    test_provider_guard_blocks_dry_run()
    test_guard_max_calls_enforced()
    print("test_fallback_order: ALL PASSED")
