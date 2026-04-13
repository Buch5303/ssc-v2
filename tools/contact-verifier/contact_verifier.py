#!/usr/bin/env python3
"""
FlowSeer / SSC V2 — Contact Verification Orchestrator
Directive 52A — Hardened production-grade verifier

Usage:
    pip install requests python-dotenv
    cp .env.example .env
    python contact_verifier.py
    python contact_verifier.py --limit 20
    python contact_verifier.py --priority ACTIVE_RFQ TIER1
    python contact_verifier.py --dry-run
    python contact_verifier.py --prior-output contacts_verified.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from models import (
    EvidenceItem, VerificationResult,
    PRIORITY_ORDER,
    STATUS_VERIFIED, STATUS_LIKELY, STATUS_PATTERN, STATUS_REVIEW, STATUS_SKIPPED,
)
from rate_limits import GuardRegistry
from scoring import score_evidence, rfq_gate
from suppression import SuppressionLayer
from outputs import (
    write_verified, write_needs_review, write_rfq_ready,
    write_run_summary_json, write_run_summary_md, now_iso,
)
from providers.common import make_session, normalize_domain, infer_email_patterns, safe_get
from providers import free_sources as fs
from providers import hunter as hu
from providers import apollo as ap

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("verifier")

INPUT_CSV = "contacts.csv"
LOG_FILE  = "verification_log.jsonl"


def log_event(event: Dict[str, Any]) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def read_contacts(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def sort_contacts(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return sorted(rows, key=lambda r: (
        PRIORITY_ORDER.get(safe_get(r, "priority", "NORMAL").upper(), 99),
        safe_get(r, "company"), safe_get(r, "full_name"),
    ))


def contact_display(contact: Dict[str, str]) -> str:
    full = safe_get(contact, "full_name") or (
        f"{safe_get(contact,'first_name')} {safe_get(contact,'last_name')}".strip()
    )
    return f"{full[:35]:<35} @ {safe_get(contact,'company')[:28]:<28}"


def verify_one(
    contact: Dict[str, str],
    session: Any,
    guards: GuardRegistry,
    dry_run: bool,
) -> VerificationResult:
    first   = safe_get(contact, "first_name")
    last    = safe_get(contact, "last_name")
    full    = safe_get(contact, "full_name") or f"{first} {last}".strip()
    company = safe_get(contact, "company")
    domain  = normalize_domain(safe_get(contact, "company_domain"))
    existing_email = safe_get(contact, "email")
    priority       = safe_get(contact, "priority", "NORMAL").upper()
    manual_approval = safe_get(contact, "manual_rfq_approval", "").lower() in {"true","yes","1"}

    all_evidence: List[EvidenceItem] = []
    sources_tried: List[str] = []
    best_url = ""

    def add(items: List[EvidenceItem], label: str) -> None:
        nonlocal best_url
        sources_tried.append(label)
        all_evidence.extend(items or [])
        for item in (items or []):
            if item.evidence_url and not best_url:
                best_url = item.evidence_url

    def build(status: str, source: str, score: int, email: str, ambiguity: str = "", notes: str = "") -> VerificationResult:
        rfq_flag, basis = rfq_gate(status, score, manual_approval)
        label_map = {STATUS_VERIFIED: "VERIFIED_EMAIL", STATUS_LIKELY: "LIKELY_CORRECT",
                     STATUS_PATTERN: "DOMAIN_PATTERN_ONLY", STATUS_REVIEW: "NEEDS_REVIEW"}
        final_email = email or existing_email
        contact["email"] = final_email
        return VerificationResult(
            verification_status=status, verification_source=source,
            confidence_score=score, confidence_label=label_map.get(status, status),
            company_domain=domain, likely_email=final_email,
            primary_evidence_url=best_url, evidence_count=len(all_evidence),
            evidence_items=all_evidence, rfq_ready_flag=rfq_flag,
            manual_rfq_approval=manual_approval, approval_basis=basis,
            provider_path=",".join(sources_tried), sources_tried=",".join(sources_tried),
            ambiguity_reason=ambiguity, contradiction_flag=any(e.contradiction for e in all_evidence),
            notes=notes, last_checked_at=now_iso(),
        )

    if dry_run:
        return build(STATUS_REVIEW, "DRY_RUN", 0, existing_email, notes="Dry run — no API calls made")

    # Step 0: verify existing email
    if existing_email and hu.hunter_available():
        items = guards.guard("hunter").call(hu.hunter_verify_existing, session, existing_email, full, company) or []
        add(items, "HUNTER_VERIFY")
        if any(e.match_type == "existing_email_verified" for e in items):
            return build(STATUS_VERIFIED, "HUNTER_VERIFY_EXISTING", 100, existing_email)

    # Steps 1-7: free sources
    add(guards.guard("google").call(fs.google_search, session, full, company, domain, first, last) or [], "GOOGLE")
    add(guards.guard("sec_edgar").call(fs.sec_edgar_search, session, full, company) or [], "SEC_EDGAR")
    add(guards.guard("wikidata").call(fs.wikidata_search, session, full, company) or [], "WIKIDATA")
    add(guards.guard("github").call(fs.github_search, session, full, company) or [], "GITHUB")
    add(guards.guard("newsapi").call(fs.newsapi_search, session, full, company) or [], "NEWSAPI")
    add(guards.guard("orcid").call(fs.orcid_search, session, first, last, company) or [], "ORCID")
    add(guards.guard("opencorporates").call(fs.opencorporates_search, session, full, company) or [], "OPENCORPORATES")

    # Step 8: domain MX
    mx_valid = guards.guard("domain_mx").call(fs.validate_domain_mx, session, domain) or False
    sources_tried.append("DOMAIN_MX")

    score, status, ambiguity = score_evidence(all_evidence, mx_valid)

    # Step 9: Hunter
    patterns: List[str] = []
    if hu.hunter_available() and domain:
        items = guards.guard("hunter").call(hu.hunter_find_and_verify, session, first, last, domain, full, company, best_url) or []
        add(items, "HUNTER_FIND+VERIFY")
        for item in items:
            if item.match_type == "hunter_verified":
                return build(STATUS_VERIFIED, "HUNTER_FINDER+VERIFY", 100, item.matched_email, ambiguity)
        patterns = infer_email_patterns(first, last, domain)
        if patterns and mx_valid:
            p_items = guards.guard("hunter").call(hu.hunter_verify_pattern, session, patterns[0], full, company, domain) or []
            add(p_items, "HUNTER_PATTERN_VERIFY")
            for item in p_items:
                if item.match_type == "hunter_pattern_verified":
                    return build(STATUS_VERIFIED, "HUNTER_PATTERN_VERIFY", 100, item.matched_email, ambiguity)
    else:
        patterns = infer_email_patterns(first, last, domain)

    score, status, ambiguity = score_evidence(all_evidence, mx_valid)

    if status in {STATUS_LIKELY, STATUS_PATTERN} and patterns:
        best_email = next((e.matched_email for e in all_evidence if e.matched_email), patterns[0])
        return build(status, "FREE_SOURCES+PATTERN", score, best_email, ambiguity)

    # Step 10: Apollo (priority gate enforced)
    if ap.apollo_available() and ap.apollo_allowed_for_priority(priority):
        items = guards.guard("apollo").call(ap.apollo_people_search, session, first, last, company, full, domain, best_url) or []
        add(items, "APOLLO_FALLBACK")
        for item in items:
            if item.matched_email:
                return build(STATUS_VERIFIED, "APOLLO_FALLBACK", 100, item.matched_email, ambiguity)

    score, status, ambiguity = score_evidence(all_evidence, mx_valid)
    best_email = next((e.matched_email for e in all_evidence if e.matched_email), patterns[0] if patterns else "")
    return build(status, "ALL_LAYERS_EXHAUSTED", score, best_email, ambiguity)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FlowSeer Contact Verifier v2")
    p.add_argument("--input",        default=INPUT_CSV)
    p.add_argument("--output-dir",   default=".")
    p.add_argument("--limit",        type=int)
    p.add_argument("--priority",     nargs="+")
    p.add_argument("--prior-output", help="Prior contacts_verified.csv — skip already-verified")
    p.add_argument("--bad-emails",   help="bad_emails.json suppression file")
    p.add_argument("--dry-run",      action="store_true")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    out  = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    contacts = sort_contacts(read_contacts(args.input))
    if args.priority:
        pf = {p.upper() for p in args.priority}
        contacts = [c for c in contacts if safe_get(c, "priority", "NORMAL").upper() in pf]
    if args.limit:
        contacts = contacts[:args.limit]

    suppressor = SuppressionLayer(prior_output_path=args.prior_output, bad_email_file=args.bad_emails)
    guards     = GuardRegistry(dry_run=args.dry_run)
    session    = make_session()

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}Processing {len(contacts)} contacts → {out.resolve()}")

    output_rows: List[Dict[str, str]] = []
    warnings:    List[str]            = []

    for idx, contact in enumerate(contacts, 1):
        full    = safe_get(contact, "full_name") or f"{safe_get(contact,'first_name')} {safe_get(contact,'last_name')}".strip()
        display = contact_display(contact)

        suppressed, supp_reason = suppressor.check(contact)
        if suppressed:
            row = {**contact, "verification_status": STATUS_SKIPPED, "verification_source": "SUPPRESSED",
                   "confidence_score": "0", "confidence_label": STATUS_SKIPPED,
                   "suppression_reason": supp_reason, "rfq_ready_flag": "NO", "last_checked_at": now_iso()}
            output_rows.append(row)
            print(f"[{idx:3}/{len(contacts)}] — {display} → SKIPPED ({supp_reason})")
            continue

        try:
            result = verify_one(contact, session, guards, dry_run=args.dry_run)
            row    = {**contact, **result.to_flat_dict()}
            output_rows.append(row)
            log_event({"ts": now_iso(), "idx": idx, "contact": full,
                       "status": result.verification_status, "score": result.confidence_score,
                       "email": result.likely_email, "rfq_ready": result.rfq_ready_flag})
            icon = {"✓": STATUS_VERIFIED, "~": STATUS_LIKELY, "?": STATUS_PATTERN, "✗": STATUS_REVIEW}
            icon = {v: k for k, v in icon.items()}.get(result.verification_status, "?")
            print(f"[{idx:3}/{len(contacts)}] {icon} {display} → {result.verification_status} [score:{result.confidence_score}]")
        except Exception as e:
            msg = f"Error on {full}: {e}"
            warnings.append(msg)
            row = {**contact, "verification_status": STATUS_REVIEW, "verification_source": "ERROR",
                   "confidence_score": "0", "rfq_ready_flag": "NO",
                   "notes": str(e), "last_checked_at": now_iso()}
            output_rows.append(row)
            print(f"[{idx:3}/{len(contacts)}] ✗ {display} → ERROR: {e}")

    paths = {
        "verified":     str(out / "contacts_verified.csv"),
        "needs_review": str(out / "contacts_needs_review.csv"),
        "rfq_ready":    str(out / "contacts_ready_for_rfq.csv"),
        "summary_json": str(out / "run_summary.json"),
        "summary_md":   str(out / "run_summary.md"),
    }
    print()
    write_verified(paths["verified"], output_rows, dry_run=args.dry_run)
    write_needs_review(paths["needs_review"], output_rows, dry_run=args.dry_run)
    write_rfq_ready(paths["rfq_ready"], output_rows, dry_run=args.dry_run)
    summary = write_run_summary_json(paths["summary_json"], output_rows, guards.all_stats(),
                                     dry_run=args.dry_run, input_count=len(contacts),
                                     warnings=warnings, output_paths=paths)
    write_run_summary_md(paths["summary_md"], summary, dry_run=args.dry_run)
    print(f"Log: {LOG_FILE}")


if __name__ == "__main__":
    main()
