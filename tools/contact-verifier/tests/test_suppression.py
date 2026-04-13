"""
Test: Deduplication, already-verified skip, bad email suppression.
"""
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from suppression import (
    SuppressionLayer, RunDeduplicator, BadEmailList,
    normalize_domain, contact_identity_key, has_sufficient_identity,
)
from models import SUPP_DUPLICATE_IN_RUN, SUPP_BOUNCED_EMAIL, SUPP_INSUFFICIENT_ID, SUPP_ALREADY_VERIFIED


def make_contact(name="Test User", company="Acme", domain="acme.com", email=""):
    return {"full_name": name, "company": company, "company_domain": domain, "email": email}


def test_in_run_dedupe():
    dedup = RunDeduplicator()
    c = make_contact()
    assert dedup.check_and_register(c) is None       # first time — OK
    assert dedup.check_and_register(c) == SUPP_DUPLICATE_IN_RUN  # second time — suppressed


def test_domain_normalization_dedup():
    dedup = RunDeduplicator()
    c1 = make_contact(domain="https://www.acme.com/path")
    c2 = make_contact(domain="acme.com")
    dedup.check_and_register(c1)
    # Same normalized domain — should deduplicate
    assert dedup.check_and_register(c2) == SUPP_DUPLICATE_IN_RUN


def test_bad_email_suppression():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"bad@acme.com": "bounced"}, f)
        path = f.name
    bl = BadEmailList(path)
    assert bl.check("bad@acme.com") == SUPP_BOUNCED_EMAIL
    assert bl.check("good@acme.com") is None
    os.unlink(path)


def test_insufficient_identity():
    ok, reason = has_sufficient_identity({"full_name": "", "company": "", "company_domain": ""})
    assert not ok
    assert reason == SUPP_INSUFFICIENT_ID

    ok, _ = has_sufficient_identity({"full_name": "Test User", "company": "Acme", "company_domain": ""})
    assert ok


def test_suppression_layer_full():
    sl = SuppressionLayer()
    c  = make_contact()
    suppressed, reason = sl.check(c)
    assert not suppressed

    suppressed, reason = sl.check(c)
    assert suppressed
    assert reason == SUPP_DUPLICATE_IN_RUN


def test_already_verified_skip():
    import csv, tempfile
    rows = [{"full_name": "Alice Smith", "company": "Acme", "company_domain": "acme.com",
              "email": "a@acme.com", "verification_status": "VERIFIED_EMAIL"}]
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader(); writer.writerows(rows)
        path = f.name

    sl = SuppressionLayer(prior_output_path=path)
    contact = {"full_name": "Alice Smith", "company": "Acme",
               "company_domain": "acme.com", "email": "a@acme.com"}
    suppressed, reason = sl.check(contact)
    assert suppressed
    assert reason == SUPP_ALREADY_VERIFIED
    os.unlink(path)


if __name__ == "__main__":
    test_in_run_dedupe()
    test_domain_normalization_dedup()
    test_bad_email_suppression()
    test_insufficient_identity()
    test_suppression_layer_full()
    test_already_verified_skip()
    print("test_suppression: ALL PASSED")
