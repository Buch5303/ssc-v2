"""
Test: Dry-run guarantees no external API calls and produces labeled outputs.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import MagicMock, patch
from rate_limits import GuardRegistry
from models import STATUS_REVIEW


def test_dry_run_guard_returns_none():
    guards = GuardRegistry(dry_run=True)
    called = []
    def live_fn(*args, **kwargs):
        called.append(True)
        return ["real_result"]
    result = guards.guard("google").call(live_fn)
    assert result is None
    assert not called, "No live function should execute in dry-run"


def test_dry_run_all_providers_blocked():
    guards = GuardRegistry(dry_run=True)
    providers = ["google", "sec_edgar", "wikidata", "github", "newsapi",
                 "orcid", "opencorporates", "domain_mx", "hunter", "apollo"]
    for name in providers:
        called = []
        def fn():
            called.append(True)
        guards.guard(name).call(fn)
        assert not called, f"{name} should not fire in dry-run"


def test_dry_run_result_status():
    """verify_one in dry-run should return STATUS_REVIEW with DRY_RUN source."""
    from contact_verifier import verify_one
    from unittest.mock import MagicMock
    contact = {
        "first_name": "Test", "last_name": "User", "full_name": "Test User",
        "company": "Acme", "company_domain": "acme.com",
        "priority": "NORMAL", "email": "", "manual_rfq_approval": "",
    }
    guards = GuardRegistry(dry_run=True)
    result = verify_one(contact, MagicMock(), guards, dry_run=True)
    assert result.verification_status == STATUS_REVIEW
    assert result.verification_source == "DRY_RUN"
    assert result.rfq_ready_flag == "NO"


if __name__ == "__main__":
    test_dry_run_guard_returns_none()
    test_dry_run_all_providers_blocked()
    test_dry_run_result_status()
    print("test_dry_run: ALL PASSED")
