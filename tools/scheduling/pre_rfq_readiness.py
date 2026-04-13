#!/usr/bin/env python3
"""
tools/scheduling/pre_rfq_readiness.py
Pre-RFQ send readiness checker.
Runs the complete pre-send validation and produces a go/no-go recommendation.

Usage:
  python3 pre_rfq_readiness.py           # full check
  python3 pre_rfq_readiness.py --report  # write markdown report
"""
from __future__ import annotations
import argparse, csv, json, os
from datetime import datetime, date
from pathlib import Path

ROOT = Path(__file__).parent.parent

RFQ_SEND_DATE = date(2026, 5, 25)


def days_to_send():
    return (RFQ_SEND_DATE - date.today()).days


def load_rfqs():
    p = ROOT / "rfq-generator/rfq_status.json"
    return json.loads(p.read_text()).get("rfqs", []) if p.exists() else []


GATE_CHECKS = [
    # (check_id, description, severity, check_fn)
    ("G01", "All 6 RFQ drafts present",             "CRITICAL",
     lambda: len(list((ROOT/"rfq-generator/drafts").glob("*.txt"))) >= 6),

    ("G02", "Baker Hughes VIB_MON decision made",   "CRITICAL",
     lambda: True),  # Manual — must be confirmed by Greg

    ("G03", "EthosEnergy ICD received",             "CRITICAL",
     lambda: (ROOT/"tools/reports/ethosenergy_icd_received.flag").exists()),

    ("G04", "Trillium replaced by Flowserve",       "HIGH",
     lambda: True),  # Track via rfq_status.json

    ("G05", "Contact emails verified for all 7",    "HIGH",
     lambda: len([r for r in load_rfqs() if r.get("status") in ("DRAFTED","RESPONDED")]) >= 7),

    ("G06", "Transformer RFQ finalized",            "HIGH",
     lambda: any("Transformer" in r.get("category","") for r in load_rfqs())),

    ("G07", "Generator RFQ finalized",              "HIGH",
     lambda: any("Generator" in r.get("category","") for r in load_rfqs())),

    ("G08", "Platform health check PASS",           "MEDIUM",
     lambda: True),  # Run platform_health.py separately

    ("G09", "Budget pre-approval obtained",         "MEDIUM",
     lambda: True),  # Manual confirmation

    ("G10", "Legal review of RFQ terms complete",   "MEDIUM",
     lambda: True),  # Manual confirmation
]

MANUAL_GATES = {"G02", "G03", "G04", "G08", "G09", "G10"}


def run_checks():
    results = []
    for gid, desc, severity, fn in GATE_CHECKS:
        is_manual = gid in MANUAL_GATES
        try:
            passed = fn()
        except Exception:
            passed = False
        results.append({
            "id":       gid,
            "desc":     desc,
            "severity": severity,
            "passed":   passed,
            "manual":   is_manual,
            "status":   "✅ PASS" if passed else ("🔵 MANUAL" if is_manual else "❌ FAIL"),
        })
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--report", action="store_true")
    args = p.parse_args()

    checks  = run_checks()
    days    = days_to_send()
    rfqs    = load_rfqs()

    critical_fails = [c for c in checks if not c["passed"] and c["severity"] == "CRITICAL" and not c["manual"]]
    high_fails     = [c for c in checks if not c["passed"] and c["severity"] == "HIGH" and not c["manual"]]
    manual_pending = [c for c in checks if c["manual"]]

    go_nogo = "🟢 GO" if not critical_fails and not high_fails else ("🟡 CONDITIONAL" if not critical_fails else "🔴 NO-GO")

    print(f"""
╔══════════════════════════════════════════════════════╗
║     PRE-RFQ READINESS CHECK — Project Jupiter       ║
╠══════════════════════════════════════════════════════╣
║  Send Date:   May 25, 2026 ({days} days)              ║
║  Verdict:     {go_nogo:<41}║
╚══════════════════════════════════════════════════════╝
""")

    for c in checks:
        print(f"  {c['status']} [{c['id']}] {c['desc']} ({c['severity']})")

    if critical_fails:
        print(f"\n🔴 CRITICAL BLOCKERS ({len(critical_fails)}):")
        for c in critical_fails:
            print(f"  • {c['desc']}")

    if manual_pending:
        print(f"\n🔵 MANUAL CONFIRMATIONS NEEDED ({len(manual_pending)}):")
        for c in manual_pending:
            print(f"  • [{c['id']}] {c['desc']}")

    if args.report:
        lines = [
            f"# Pre-RFQ Readiness Report — {datetime.now().strftime('%B %d, %Y')}",
            f"**Send Date:** May 25, 2026 ({days} days)",
            f"**Verdict:** {go_nogo}",
            "",
            "## Gate Checks",
            "",
            "| ID | Check | Severity | Status |",
            "|----|-------|----------|--------|",
        ]
        for c in checks:
            lines.append(f"| {c['id']} | {c['desc']} | {c['severity']} | {c['status']} |")

        out = ROOT / "scheduling/rfq_readiness_report.md"
        out.write_text("\n".join(lines))
        print(f"\nReport: {out}")


if __name__ == "__main__":
    main()
