"""
Test: Confidence scoring from evidence items.
Deterministic — no API calls.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import EvidenceItem, STATUS_VERIFIED, STATUS_LIKELY, STATUS_PATTERN, STATUS_REVIEW
from scoring import score_evidence, rfq_gate


def make_item(provider, match_type, email="", contradiction=False):
    return EvidenceItem(
        provider=provider, match_type=match_type,
        matched_name="Test User", matched_company="Acme Corp",
        matched_email=email, contradiction=contradiction,
        timestamp="2026-01-01T00:00:00+00:00",
    )


def test_verified_email_from_hunter():
    items = [make_item("HUNTER_FINDER+VERIFY", "hunter_verified", email="test@acme.com")]
    score, status, _ = score_evidence(items, domain_valid=True)
    assert status == STATUS_VERIFIED
    assert score >= 95


def test_likely_correct_public_evidence():
    items = [
        make_item("SEC_EDGAR", "person_company_confirmed"),
        make_item("GOOGLE", "person_company_confirmed"),
    ]
    score, status, _ = score_evidence(items, domain_valid=True)
    assert status in {STATUS_LIKELY, STATUS_VERIFIED}
    assert score >= 60


def test_needs_review_no_evidence():
    score, status, _ = score_evidence([], domain_valid=False)
    assert status == STATUS_REVIEW
    assert score == 0


def test_contradiction_flagged():
    item1 = make_item("GOOGLE", "person_company_confirmed", email="a@acme.com")
    item2 = make_item("NEWSAPI", "person_company_confirmed", email="b@acme.com")
    score, status, ambiguity = score_evidence([item1, item2], domain_valid=True)
    assert "CONTRADICTION" in ambiguity or "multiple" in ambiguity.lower()


def test_domain_pattern_only():
    score, status, _ = score_evidence([], domain_valid=True)
    assert status == STATUS_PATTERN
    assert score == 20


def test_rfq_gate_verified():
    flag, basis = rfq_gate(STATUS_VERIFIED, 100)
    assert flag == "YES"
    assert basis == "VERIFIED_EMAIL"


def test_rfq_gate_likely_no_approval():
    flag, basis = rfq_gate(STATUS_LIKELY, 80, manual_approval=False)
    assert flag == "REVIEW_FIRST"
    assert basis == ""


def test_rfq_gate_likely_with_approval():
    flag, basis = rfq_gate(STATUS_LIKELY, 80, manual_approval=True)
    assert flag == "YES"
    assert basis == "MANUAL_APPROVAL"


def test_rfq_gate_pattern_never_rfq_ready():
    flag, _ = rfq_gate(STATUS_PATTERN, 60)
    assert flag == "REVIEW_FIRST"


def test_rfq_gate_review_never_rfq_ready():
    flag, _ = rfq_gate(STATUS_REVIEW, 0)
    assert flag == "NO"


if __name__ == "__main__":
    test_verified_email_from_hunter()
    test_likely_correct_public_evidence()
    test_needs_review_no_evidence()
    test_contradiction_flagged()
    test_domain_pattern_only()
    test_rfq_gate_verified()
    test_rfq_gate_likely_no_approval()
    test_rfq_gate_likely_with_approval()
    test_rfq_gate_pattern_never_rfq_ready()
    test_rfq_gate_review_never_rfq_ready()
    print("test_scoring: ALL PASSED")
