"""
Test: RFQ-ready safety gate — only VERIFIED or manually approved LIKELY reach YES.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from scoring import rfq_gate
from models import STATUS_VERIFIED, STATUS_LIKELY, STATUS_PATTERN, STATUS_REVIEW


def test_verified_always_rfq_ready():
    flag, basis = rfq_gate(STATUS_VERIFIED, 100)
    assert flag == "YES"

def test_likely_without_approval_review_first():
    flag, _ = rfq_gate(STATUS_LIKELY, 80, manual_approval=False)
    assert flag == "REVIEW_FIRST"

def test_likely_with_approval_rfq_ready():
    flag, basis = rfq_gate(STATUS_LIKELY, 80, manual_approval=True)
    assert flag == "YES"
    assert basis == "MANUAL_APPROVAL"

def test_pattern_never_rfq_ready_directly():
    flag, _ = rfq_gate(STATUS_PATTERN, 60, manual_approval=False)
    assert flag != "YES"

def test_pattern_with_approval_still_review_first():
    """Pattern-only contacts cannot bypass gate even with manual_approval."""
    flag, _ = rfq_gate(STATUS_PATTERN, 60, manual_approval=True)
    assert flag != "YES"

def test_review_never_rfq_ready():
    flag, _ = rfq_gate(STATUS_REVIEW, 0)
    assert flag == "NO"

def test_review_with_approval_still_no():
    flag, _ = rfq_gate(STATUS_REVIEW, 0, manual_approval=True)
    assert flag == "NO"


if __name__ == "__main__":
    test_verified_always_rfq_ready()
    test_likely_without_approval_review_first()
    test_likely_with_approval_rfq_ready()
    test_pattern_never_rfq_ready_directly()
    test_pattern_with_approval_still_review_first()
    test_review_never_rfq_ready()
    test_review_with_approval_still_no()
    print("test_rfq_gate: ALL PASSED")
