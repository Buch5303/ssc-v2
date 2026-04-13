#!/usr/bin/env python3
"""
tools/orchestrator/directive_generator.py
Analyzes program state and auto-generates next directives.
Feeds directly into directive_queue.json.

Usage:
  python3 directive_generator.py           # generate and print
  python3 directive_generator.py --push    # write to queue
"""
from __future__ import annotations
import argparse, csv, json
from datetime import date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
QUEUE    = Path(__file__).parent / "directive_queue.json"


def load_rfqs():
    p = ROOT / "rfq-generator/rfq_status.json"
    return json.loads(p.read_text()).get("rfqs", []) if p.exists() else []


def load_pricing():
    p = ROOT / "pricing-discovery/outputs/pricing_updated.csv"
    if not p.exists(): return []
    with open(p) as f:
        return [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]


def analyze_state():
    """Analyze current program state and return list of needed directives."""
    directives = []
    rfqs    = load_rfqs()
    pricing = load_pricing()
    days    = (date(2026, 5, 25) - date.today()).days

    responded = [r for r in rfqs if r["status"] == "RESPONDED"]
    drafted   = [r for r in rfqs if r["status"] == "DRAFTED"]
    verified  = [r for r in pricing if r.get("confidence_label") == "RFQ_VERIFIED"]
    unverified= [r for r in pricing if r.get("confidence_label") != "RFQ_VERIFIED"]

    # Check 1: Unverified STRATEGIC categories need RFQ prep
    strategic_unverified = [
        r for r in unverified
        if r.get("spend_tier") == "STRATEGIC"
        and not any(rfq for rfq in rfqs if rfq.get("category_code") == r.get("category_code"))
    ]
    if strategic_unverified:
        for r in strategic_unverified[:2]:  # max 2 at a time
            directives.append({
                "id":         f"AUTO-{r.get('category_code','X')}-RFQ",
                "title":      f"Prepare RFQ for {r.get('category','')} ({r.get('spend_tier','')})",
                "task":       f"Create a detailed RFQ package for {r.get('category','')} targeting the preferred supplier. "
                              f"Estimated value ${float(r.get('mid_usd',0) or r.get('bom_mid',0)):,.0f}. "
                              f"Include scope of supply, technical specifications for W251B8, "
                              f"response format, and evaluation criteria. Save to tools/rfq-generator/drafts/.",
                "priority":   2,
                "depends_on": [],
                "context":    f"BOP category: {r.get('category_code','')}. "
                              f"Preferred supplier: {r.get('preferred_supplier','')}. "
                              f"Current estimate: ${float(r.get('mid_usd',0) or r.get('bom_mid',0)):,.0f}. "
                              f"May 25 RFQ send date — {days} days away.",
            })

    # Check 2: RFQ responses received — update learning engine
    new_responses = [r for r in responded if float(r.get("quoted_price") or 0) > 0
                     and r.get("rfq_id") != "RFQ-001"]
    if new_responses:
        for r in new_responses:
            directives.append({
                "id":         f"AUTO-LEARN-{r.get('rfq_id','X')}",
                "title":      f"Ingest {r['company']} RFQ response and update learning model",
                "task":       f"Run tools/rfq-generator/ingest_response.py for {r['company']} "
                              f"quote of ${r.get('quoted_price',0):,.0f} on {r.get('category','')}. "
                              f"Update pricing CSV confidence to RFQ_VERIFIED. "
                              f"Compute cross-category learning signal. Update dashboard data.",
                "priority":   1,
                "depends_on": [],
                "context":    f"RFQ {r.get('rfq_id')}: {r['company']} quoted ${r.get('quoted_price',0):,.0f} "
                              f"on {r.get('response_date','unknown')}.",
            })

    # Check 3: Approaching RFQ send date
    if days <= 14 and days > 0:
        directives.append({
            "id":         "AUTO-PREFLIGHT",
            "title":      f"Pre-RFQ send preflight check ({days} days to May 25)",
            "task":       "Run tools/scheduling/pre_rfq_readiness.py --report. "
                          "Verify all gate checks. Identify any remaining blockers. "
                          "Generate final send list with verified contact emails. "
                          "Write preflight_report.md to tools/scheduling/.",
            "priority":   1,
            "depends_on": [],
            "context":    f"May 25 RFQ send date is {days} days away. Critical to resolve all blockers.",
        })

    return directives


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--push", action="store_true", help="Write directives to queue")
    args = p.parse_args()

    directives = analyze_state()

    if not directives:
        print("Program state nominal — no new directives needed")
        return

    print(f"Generated {len(directives)} directives based on program state:\n")
    for d in directives:
        print(f"  [{d['id']}] {d['title']}")
        print(f"  Priority: {d['priority']} | Deps: {d.get('depends_on',[])}")
        print()

    if args.push:
        existing = []
        if QUEUE.exists():
            existing = json.loads(QUEUE.read_text()).get("directives", [])
        existing_ids = {d["id"] for d in existing}
        new = [d for d in directives if d["id"] not in existing_ids]
        if new:
            all_directives = existing + new
            QUEUE.write_text(json.dumps({"directives": all_directives}, indent=2))
            print(f"Added {len(new)} directives to queue")
        else:
            print("All directives already in queue")


if __name__ == "__main__":
    main()
