#!/usr/bin/env python3
"""
tools/reports/generate_weekly_report.py
Auto-generates weekly program status report. Run every Monday.

Usage:
  python3 generate_weekly_report.py
"""
from __future__ import annotations
import csv, json
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"
PRICE_CSV= ROOT / "pricing-discovery/outputs/pricing_updated.csv"

def load_rfqs():
    try: return json.loads(RFQ_FILE.read_text()).get("rfqs", [])
    except: return []

def load_pricing():
    try:
        with open(PRICE_CSV) as f: return list(csv.DictReader(f))
    except: return []

def main():
    rfqs    = load_rfqs()
    pricing = load_pricing()
    today   = date.today()
    rfq_day = date(2026, 5, 25)
    days    = (rfq_day - today).days
    total   = sum(float(r.get("mid_usd") or r.get("bom_mid",0))
                  for r in pricing if r.get("category") != "TOTAL")
    resp    = [r for r in rfqs if r["status"] == "RESPONDED"]
    draft   = [r for r in rfqs if r["status"] == "DRAFTED"]
    verif   = [r for r in pricing if r.get("confidence_label") == "RFQ_VERIFIED"]

    lines = [
        f"# Project Jupiter — Weekly Status {today.strftime('%B %d, %Y')}",
        f"**Days to RFQ Send:** {days} | **RFQ Date:** May 25, 2026",
        "",
        "## Scorecard",
        f"- BOP Budget Mid: ${total:,.0f}",
        f"- Categories Verified: {len(verif)} / 19",
        f"- RFQs Responded: {len(resp)}",
        f"- RFQs Drafted: {len(draft)}",
        "",
        "## Pipeline",
    ]
    for r in rfqs:
        icon = "✅" if r["status"] == "RESPONDED" else "📝"
        val  = f"${r.get('quoted_price') or r.get('est_value_usd',0):,.0f}"
        lines.append(f"- {icon} {r['company']} — {r['category']} — {val}")

    report = "\n".join(lines)
    out = ROOT / "reports" / f"weekly_{today.strftime('%Y_%m_%d')}.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(report)
    print(f"Report: {out}")
    return report

if __name__ == "__main__":
    main()
