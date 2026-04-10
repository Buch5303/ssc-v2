"""
Test: Output artifact correctness and RFQ-ready safety gate.
"""
import sys, os, csv, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from outputs import write_verified, write_needs_review, write_rfq_ready, write_run_summary_json
from models import ProviderStats


def make_rows():
    return [
        {"full_name": "Alice", "company": "Acme", "title": "CEO",
         "company_domain": "acme.com", "email": "alice@acme.com",
         "verification_status": "VERIFIED_EMAIL", "confidence_label": "VERIFIED_EMAIL",
         "confidence_score": "100", "provider_path": "HUNTER", "primary_evidence_url": "https://x.com",
         "evidence_count": "1", "suppression_reason": "", "rfq_ready_flag": "YES",
         "manual_rfq_approval": "False", "approval_basis": "VERIFIED_EMAIL", "last_checked_at": "2026-01-01"},
        {"full_name": "Bob", "company": "Corp", "title": "VP",
         "company_domain": "corp.com", "email": "bob@corp.com",
         "verification_status": "LIKELY_CORRECT", "confidence_label": "LIKELY_CORRECT",
         "confidence_score": "80", "provider_path": "GOOGLE,SEC_EDGAR", "primary_evidence_url": "",
         "evidence_count": "2", "suppression_reason": "", "rfq_ready_flag": "REVIEW_FIRST",
         "manual_rfq_approval": "False", "approval_basis": "", "last_checked_at": "2026-01-01",
         "likely_email": "bob@corp.com", "ambiguity_reason": ""},
        {"full_name": "Carol", "company": "Ltd", "title": "Dir",
         "company_domain": "ltd.com", "email": "",
         "verification_status": "NEEDS_REVIEW", "confidence_label": "NEEDS_REVIEW",
         "confidence_score": "0", "provider_path": "", "primary_evidence_url": "",
         "evidence_count": "0", "suppression_reason": "", "rfq_ready_flag": "NO",
         "manual_rfq_approval": "False", "approval_basis": "", "last_checked_at": "2026-01-01",
         "likely_email": "", "ambiguity_reason": "No evidence"},
    ]


def test_verified_csv_only_verified():
    rows = make_rows()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w") as f:
        path = f.name
    write_verified(path, rows)
    with open(path) as f:
        records = list(csv.DictReader(f))
    assert len(records) == 1
    assert records[0]["verification_status"] == "VERIFIED_EMAIL"
    os.unlink(path)


def test_rfq_ready_only_yes():
    rows = make_rows()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w") as f:
        path = f.name
    write_rfq_ready(path, rows)
    with open(path) as f:
        records = list(csv.DictReader(f))
    assert all(r["approved_for_rfq"] == "YES" for r in records)
    assert len(records) == 1
    os.unlink(path)


def test_needs_review_excludes_suppressed():
    rows = make_rows()
    rows.append({"full_name": "Dave", "verification_status": "NEEDS_REVIEW",
                 "suppression_reason": "ALREADY_VERIFIED", "rfq_ready_flag": "NO"})
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w") as f:
        path = f.name
    write_needs_review(path, rows)
    with open(path) as f:
        records = list(csv.DictReader(f))
    names = [r.get("full_name", "") for r in records]
    assert "Dave" not in names
    os.unlink(path)


def test_run_summary_json_structure():
    rows = make_rows()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
        path = f.name
    summary = write_run_summary_json(path, rows, {}, dry_run=False, input_count=3)
    assert "counts" in summary
    assert summary["counts"]["total_verified"] == 1
    assert summary["counts"]["total_rfq_ready"] == 1
    os.unlink(path)


if __name__ == "__main__":
    test_verified_csv_only_verified()
    test_rfq_ready_only_yes()
    test_needs_review_excludes_suppressed()
    test_run_summary_json_structure()
    print("test_outputs: ALL PASSED")
