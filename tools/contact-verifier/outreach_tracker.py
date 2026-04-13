#!/usr/bin/env python3
"""
tools/contact-verifier/outreach_tracker.py
Tracks all supplier contact attempts and responses.
Updates automatically when RFQs are sent and responses received.

Usage:
  python3 outreach_tracker.py                    # show full tracker
  python3 outreach_tracker.py --company Emerson  # filter by company
  python3 outreach_tracker.py --mark-sent RFQ-002 2026-05-25
  python3 outreach_tracker.py --mark-responded RFQ-002 2026-06-12 685000
"""
from __future__ import annotations
import argparse, json
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
TRACKER  = ROOT / "contact-verifier/outreach_log.json"
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"


def load_rfqs():
    return json.loads(RFQ_FILE.read_text()).get("rfqs", []) if RFQ_FILE.exists() else []


def load_tracker():
    return json.loads(TRACKER.read_text()) if TRACKER.exists() else {"contacts": []}


def save_tracker(data):
    TRACKER.write_text(json.dumps(data, indent=2))


def build_from_rfqs():
    """Build tracker from existing RFQ data."""
    rfqs    = load_rfqs()
    tracker = load_tracker()
    existing_ids = {c.get("rfq_id") for c in tracker.get("contacts", [])}

    for r in rfqs:
        if r.get("id") in existing_ids:
            continue
        tracker.setdefault("contacts", []).append({
            "rfq_id":         r.get("id"),
            "company":        r.get("company",""),
            "contact":        r.get("contact",""),
            "category":       r.get("category",""),
            "category_code":  r.get("category_code",""),
            "est_value":      r.get("est_value_usd", 0),
            "status":         r.get("status","DRAFTED"),
            "touch_1_date":   None,
            "touch_2_date":   None,
            "touch_3_date":   None,
            "sent_date":      r.get("sent_date"),
            "response_date":  r.get("response_date"),
            "quoted_price":   r.get("quoted_price"),
            "variance_pct":   r.get("variance_pct"),
            "notes":          r.get("notes",""),
        })

    save_tracker(tracker)
    return tracker


def show_tracker(filter_company=None):
    tracker = build_from_rfqs()
    contacts = tracker.get("contacts", [])
    if filter_company:
        contacts = [c for c in contacts if filter_company.lower() in c.get("company","").lower()]

    today    = date.today()
    rfq_date = date(2026, 5, 25)
    days_out = (rfq_date - today).days

    print(f"\n{'='*75}")
    print(f"FlowSeer Supplier Outreach Tracker | {days_out} days to May 25 send")
    print(f"{'='*75}")
    print(f"{'ID':<8} {'COMPANY':<22} {'CONTACT':<20} {'VALUE':>10}  {'STATUS':<12} NOTES")
    print(f"{'-'*75}")

    for c in sorted(contacts, key=lambda x: -x.get("est_value",0)):
        val   = c.get("quoted_price") or c.get("est_value", 0)
        icon  = {"RESPONDED":"✅","DRAFTED":"📝","SENT":"📨","AWARDED":"🏆"}.get(c["status"],"❓")
        notes = (c.get("notes","") or "")[:25]
        print(f"{icon} {c.get('rfq_id',''):<6} {c.get('company',''):<22} "
              f"{(c.get('contact','') or 'TBD')[:18]:<18} ${val:>10,.0f}  "
              f"{c['status']:<12} {notes}")

    print(f"{'='*75}")
    print(f"Total: {len(contacts)} contacts | "
          f"{sum(1 for c in contacts if c['status']=='RESPONDED')} responded | "
          f"{sum(1 for c in contacts if c['status']=='DRAFTED')} drafted\n")


def mark_sent(rfq_id, sent_date):
    data = build_from_rfqs()
    for c in data.get("contacts", []):
        if c.get("rfq_id") == rfq_id:
            c["status"]    = "SENT"
            c["sent_date"] = sent_date
            print(f"✅ {rfq_id} marked as SENT on {sent_date}")
            break
    save_tracker(data)
    # Also update rfq_status.json
    rfqs = load_rfqs()
    rfq_data = json.loads(RFQ_FILE.read_text())
    for r in rfq_data.get("rfqs", []):
        if r.get("id") == rfq_id:
            r["status"]    = "SENT"
            r["sent_date"] = sent_date
    RFQ_FILE.write_text(json.dumps(rfq_data, indent=2))


def mark_responded(rfq_id, response_date, quoted_price):
    data = build_from_rfqs()
    for c in data.get("contacts", []):
        if c.get("rfq_id") == rfq_id:
            est    = c.get("est_value", 0)
            var    = (quoted_price - est) / est * 100 if est else 0
            c["status"]        = "RESPONDED"
            c["response_date"] = response_date
            c["quoted_price"]  = quoted_price
            c["variance_pct"]  = round(var, 1)
            print(f"✅ {rfq_id} marked as RESPONDED: ${quoted_price:,.0f} ({var:+.1f}% vs estimate)")
            break
    save_tracker(data)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--company",        help="Filter by company name")
    p.add_argument("--mark-sent",      nargs=2, metavar=("RFQ_ID","DATE"))
    p.add_argument("--mark-responded", nargs=3, metavar=("RFQ_ID","DATE","PRICE"))
    args = p.parse_args()

    if args.mark_sent:
        mark_sent(args.mark_sent[0], args.mark_sent[1])
    elif args.mark_responded:
        mark_responded(args.mark_responded[0], args.mark_responded[1],
                       float(args.mark_responded[2]))
    else:
        show_tracker(args.company)


if __name__ == "__main__":
    main()
