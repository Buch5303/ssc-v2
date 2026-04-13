#!/usr/bin/env python3
"""
tools/notifications/alert_manager.py
Program alert manager — surfaces critical issues requiring attention.
Runs on-demand or scheduled. Outputs alerts sorted by severity.

Usage:
  python3 alert_manager.py
  python3 alert_manager.py --json
  python3 alert_manager.py --since 2026-04-01
"""
from __future__ import annotations
import argparse, csv, json
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"
PRICE_CSV= ROOT / "pricing-discovery/outputs/pricing_updated.csv"


def check_alerts():
    alerts = []
    today  = date.today()
    rfq_send = date(2026, 5, 25)
    days_out = (rfq_send - today).days

    # Load data
    rfqs = []
    if RFQ_FILE.exists():
        rfqs = json.loads(RFQ_FILE.read_text()).get("rfqs", [])

    pricing = []
    if PRICE_CSV.exists():
        with open(PRICE_CSV) as f:
            pricing = [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]

    # ── CRITICAL alerts ───────────────────────────────────────────────────────

    # EthosEnergy ICD
    icd_flag = ROOT / "reports/ethosenergy_icd_received.flag"
    if not icd_flag.exists():
        alerts.append({
            "severity": "CRITICAL",
            "code":     "ICD-001",
            "title":    "EthosEnergy ICD Not Received",
            "detail":   f"Blocks Transformer ($760K), Exhaust ($430K), Electrical ($535K) = $1.725M. "
                        f"Required by May 1. {days_out} days to RFQ send.",
            "action":   "Run: python3 tools/reports/ethosenergy_icd_tracker.py --escalate 1",
            "days_out": days_out,
        })

    # Trillium AVOID unresolved
    piping_rfq = next((r for r in rfqs if r.get("category_code") == "PIPING_VALVES"), None)
    if not piping_rfq:
        alerts.append({
            "severity": "CRITICAL",
            "code":     "SUP-001",
            "title":    "Piping & Valves Supplier Not Confirmed",
            "detail":   "Trillium AVOID flag active on $507,600 scope. Flowserve recommended replacement. No RFQ drafted.",
            "action":   "Add Flowserve Piping & Valves RFQ to rfq_status.json and draft RFQ",
        })

    # ── HIGH alerts ───────────────────────────────────────────────────────────

    # Baker Hughes decision pending
    bh = next((r for r in rfqs if r.get("company","").startswith("Baker") and r["status"] == "RESPONDED"), None)
    if bh and not bh.get("decision"):
        alerts.append({
            "severity": "HIGH",
            "code":     "RFQ-001",
            "title":    "Baker Hughes VIB_MON Decision Pending",
            "detail":   f"Quoted $340,000 (+26.7% above $268K estimate). Decision needed before May 1.",
            "action":   "Accept, negotiate, or rebid. Run ingest_response.py to formally record.",
        })

    # Generator RFQ not in pipeline
    gen_rfq = next((r for r in rfqs if r.get("category_code") == "GENERATOR"), None)
    if not gen_rfq:
        alerts.append({
            "severity": "HIGH",
            "code":     "RFQ-002",
            "title":    "Generator + Switchgear RFQ Not Drafted ($2.09M)",
            "detail":   "Highest value BOP item. 40-56 week lead time. Must issue May 25 — no slippage.",
            "action":   "Draft Generator RFQ to GE Vernova AND Siemens Energy (competitive bid required)",
        })

    # ── MEDIUM alerts ─────────────────────────────────────────────────────────

    # Unverified STRATEGIC categories
    unverified_strategic = [
        r for r in pricing
        if r.get("spend_tier") == "STRATEGIC"
        and r.get("confidence_label") != "RFQ_VERIFIED"
        and not any(rfq for rfq in rfqs if rfq.get("category_code") == r.get("category_code"))
    ]
    if unverified_strategic:
        vals = [float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in unverified_strategic]
        alerts.append({
            "severity": "MEDIUM",
            "code":     "PRICE-001",
            "title":    f"{len(unverified_strategic)} STRATEGIC Categories Unverified (no RFQ drafted)",
            "detail":   f"${sum(vals):,.0f} total unverified across: " +
                        ", ".join(r.get("category","")[:20] for r in unverified_strategic[:3]),
            "action":   "Draft RFQs for remaining STRATEGIC categories before May 25",
        })

    # Approaching send date
    if days_out <= 30:
        alerts.append({
            "severity": "MEDIUM",
            "code":     "SCHED-001",
            "title":    f"RFQ Send Date {days_out} Days Away",
            "detail":   f"May 25, 2026. Run pre_rfq_readiness.py to check all gates.",
            "action":   "python3 tools/scheduling/pre_rfq_readiness.py --report",
        })

    # Contact enrichment gap
    alerts.append({
        "severity": "LOW",
        "code":     "CONTACT-001",
        "title":    "167 Contacts Not Enriched",
        "detail":   "64/231 contacts verified. Free pipeline available. Apollo/Hunter unlock full enrichment.",
        "action":   "python3 tools/contact-verifier/run_enrichment.py --dry-run",
    })

    return sorted(alerts, key=lambda a: {"CRITICAL":0,"HIGH":1,"MEDIUM":2,"LOW":3}[a["severity"]])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    alerts = check_alerts()
    counts = {"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0}
    for a in alerts:
        counts[a["severity"]] += 1

    if args.json:
        print(json.dumps({"alerts": alerts, "counts": counts,
                          "generated": datetime.now().isoformat()}, indent=2))
        return

    rag = "🔴 CRITICAL" if counts["CRITICAL"] else ("🟡 HIGH" if counts["HIGH"] else "🟢 NOMINAL")
    print(f"\n{'='*65}")
    print(f"FlowSeer Alert Manager — {datetime.now().strftime('%B %d, %Y %H:%M')}")
    print(f"Status: {rag}  |  "
          f"🔴 {counts['CRITICAL']} critical  🟡 {counts['HIGH']} high  "
          f"⚪ {counts['MEDIUM']} medium  🔵 {counts['LOW']} low")
    print(f"{'='*65}")

    for a in alerts:
        icon = {"CRITICAL":"🔴","HIGH":"🟡","MEDIUM":"⚪","LOW":"🔵"}[a["severity"]]
        print(f"\n{icon} [{a['code']}] {a['title']}")
        print(f"   {a['detail']}")
        print(f"   → {a['action']}")

    print(f"\n{'='*65}")

    # Save alerts
    out = ROOT / "notifications/current_alerts.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"alerts": alerts, "counts": counts,
                               "generated": datetime.now().isoformat()}, indent=2))


if __name__ == "__main__":
    main()
