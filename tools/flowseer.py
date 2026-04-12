#!/usr/bin/env python3
"""
FlowSeer — Project Jupiter BOP Intelligence Platform
Master CLI — single entry point for all platform functions.

Usage:
  python3 flowseer.py status          # full program status
  python3 flowseer.py alerts          # current alerts
  python3 flowseer.py health          # platform health check
  python3 flowseer.py pricing         # BOP pricing summary
  python3 flowseer.py rfq             # RFQ pipeline status
  python3 flowseer.py rfq send        # show May 25 send plan
  python3 flowseer.py rfq ingest      # ingest a new RFQ response
  python3 flowseer.py contacts        # contact database summary
  python3 flowseer.py suppliers       # supplier network overview
  python3 flowseer.py timeline        # program timeline
  python3 flowseer.py analytics       # spend + scenario analysis
  python3 flowseer.py icd             # EthosEnergy ICD status
  python3 flowseer.py icd escalate    # generate escalation email
  python3 flowseer.py build           # run autonomous build loop
  python3 flowseer.py refresh         # refresh all dashboard data
"""
from __future__ import annotations
import argparse, csv, json, subprocess, sys
from datetime import datetime, date
from pathlib import Path

TOOLS   = Path(__file__).parent
ROOT    = TOOLS.parent
PYTHON  = sys.executable

BANNER = """
╔══════════════════════════════════════════════════════════════╗
║   FlowSeer — Project Jupiter BOP Intelligence Platform       ║
║   Trans World Power LLC | W251B8 50MW | Santa Teresa NM     ║
╚══════════════════════════════════════════════════════════════╝"""


def run(script: str, *args: str) -> int:
    result = subprocess.run([PYTHON, str(TOOLS / script)] + list(args))
    return result.returncode


def load_json(path: str) -> dict:
    p = TOOLS / path
    return json.loads(p.read_text()) if p.exists() else {}


def load_csv(path: str) -> list:
    p = TOOLS / path
    if not p.exists():
        return []
    with open(p) as f:
        return [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]


def cmd_status(args):
    """Full program status dashboard."""
    print(BANNER)
    rfqs    = load_json("rfq-generator/rfq_status.json").get("rfqs", [])
    pricing = load_csv("pricing-discovery/outputs/pricing_updated.csv") or \
              load_csv("pricing-discovery/outputs/bop_cost_model.csv")
    summary = load_json("dashboard/data/program_summary.json")

    days    = (date(2026, 5, 25) - date.today()).days
    total   = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in pricing)
    resp    = [r for r in rfqs if r["status"] == "RESPONDED"]
    draft   = [r for r in rfqs if r["status"] == "DRAFTED"]
    verif   = [r for r in pricing if r.get("confidence_label") == "RFQ_VERIFIED"]

    print(f"""
  PROGRAM STATUS — {datetime.now().strftime('%B %d, %Y')}
  {'─'*56}
  BOP Baseline:         ${total:,.0f}
  Categories Priced:    19 / 19
  Categories Verified:  {len(verif)} / 19
  Total RFQs:           {len(rfqs)} ({len(resp)} responded, {len(draft)} drafted)
  RFQ Pipeline Value:   ${sum(r.get('est_value_usd',0) for r in rfqs):,.0f}
  Days to RFQ Send:     {days} (May 25, 2026)
  BH VIB_MON Quote:     $340,000 (+26.7% vs estimate)
  {'─'*56}""")

    icd_flag = TOOLS / "reports/ethosenergy_icd_received.flag"
    icd_status = "✅ RECEIVED" if icd_flag.exists() else "🔴 PENDING (blocks $1.725M in RFQs)"
    print(f"  EthosEnergy ICD:      {icd_status}")
    print(f"  Trillium AVOID:       ✅ RESOLVED — Flowserve selected")
    print(f"  Generator RFQ:        ✅ Drafted (GE Vernova + Siemens — critical path)")
    print(f"  Platform Health:      Run 'python3 flowseer.py health'")
    print()


def cmd_alerts(args):
    run("notifications/alert_manager.py")


def cmd_health(args):
    run("monitoring/platform_health.py")


def cmd_pricing(args):
    print(BANNER)
    pricing = load_csv("pricing-discovery/outputs/bop_cost_model.csv") or \
              load_csv("pricing-discovery/outputs/pricing_updated.csv")
    total = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in pricing)
    print(f"\n  BOP PRICING SUMMARY — {len(pricing)} categories")
    print(f"  {'─'*56}")
    print(f"  {'CATEGORY':<38} {'MID':>10}  {'TIER':<10}  STATUS")
    print(f"  {'─'*56}")
    for r in sorted(pricing, key=lambda x: -float(x.get("mid_usd") or x.get("bom_mid", 0))):
        mid  = float(r.get("mid_usd") or r.get("bom_mid", 0))
        conf = r.get("confidence_label","")
        icon = "✅" if conf == "RFQ_VERIFIED" else "○"
        avd  = " ⚠AVOID" if r.get("avoid_supplier") else ""
        print(f"  {icon} {r.get('category','')[:36]:<36} ${mid:>10,.0f}  {r.get('spend_tier',''):<10}{avd}")
    print(f"  {'─'*56}")
    print(f"  {'TOTAL':<38} ${total:>10,.0f}")
    print(f"\n  Scenarios: Optimistic $9.14M | Base $9.27M | Conservative $10.08M\n")


def cmd_rfq(args):
    sub = args.subcommand if hasattr(args, 'subcommand') else None

    if sub == "send":
        run("scheduling/rfq_send_scheduler.py", "--status")
        return
    if sub == "ingest":
        print("Usage: python3 tools/rfq-generator/ingest_response.py \\")
        print("         --contact NAME --company COMPANY \\")
        print("         --category-code CODE --quoted-price PRICE")
        return

    rfqs  = load_json("rfq-generator/rfq_status.json").get("rfqs", [])
    days  = (date(2026, 5, 25) - date.today()).days
    print(BANNER)
    print(f"\n  RFQ PIPELINE — {len(rfqs)} packages | {days} days to May 25 send")
    print(f"  {'─'*70}")
    print(f"  {'ID':<8} {'COMPANY':<22} {'CATEGORY':<32} {'VALUE':>10}  STATUS")
    print(f"  {'─'*70}")
    for r in rfqs:
        val  = r.get("quoted_price") or r.get("est_value_usd", 0)
        icon = "✅" if r["status"] == "RESPONDED" else "📝"
        print(f"  {icon} {r.get('id',''):<6} {r.get('company',''):<22} "
              f"{r.get('category','')[:30]:<30} ${val:>10,.0f}  {r['status']}")
    total = sum(r.get("est_value_usd", 0) for r in rfqs)
    print(f"  {'─'*70}")
    print(f"  {'TOTAL':<62} ${total:>10,.0f}\n")


def cmd_contacts(args):
    run("contact-verifier/run_enrichment.py", "--dry-run", "--limit", "8")


def cmd_suppliers(args):
    print(BANNER)
    si = (TOOLS / "supplier-intelligence/supplier_profiles.md")
    if si.exists():
        lines = si.read_text().split("\n")
        headers = [l for l in lines if l.startswith("## ")]
        print(f"\n  SUPPLIER INTELLIGENCE — {len(headers)} strategic profiles")
        print(f"  {'─'*50}")
        for h in headers:
            print(f"  {h.replace('## ','  ')}")
        print(f"\n  Full profiles: tools/supplier-intelligence/supplier_profiles.md")
        print(f"  Comparison:    tools/supplier-intelligence/supplier_comparison_matrix.md\n")


def cmd_timeline(args):
    run("reports/ethosenergy_icd_tracker.py", "--status")


def cmd_analytics(args):
    print(BANNER)
    run("analytics/award_scenario_modeler.py")
    print()
    run("analytics/response_predictor.py")


def cmd_icd(args):
    sub = args.subcommand if hasattr(args, 'subcommand') else None
    if sub == "escalate":
        run("reports/ethosenergy_icd_tracker.py", "--escalate", "1")
    else:
        run("reports/ethosenergy_icd_tracker.py", "--status")


def cmd_build(args):
    import os
    os.chdir(TOOLS / "orchestrator")
    subprocess.run([PYTHON, "go.py"])


def cmd_refresh(args):
    print("Refreshing dashboard data...")
    run("dashboard/generate_dashboard_data.py")
    print("Running health check...")
    run("monitoring/platform_health.py")


COMMANDS = {
    "status":    (cmd_status,    "Full program status dashboard"),
    "alerts":    (cmd_alerts,    "Current program alerts"),
    "health":    (cmd_health,    "Platform health check (25 checks)"),
    "pricing":   (cmd_pricing,   "BOP pricing summary (19 categories)"),
    "rfq":       (cmd_rfq,       "RFQ pipeline status"),
    "contacts":  (cmd_contacts,  "Contact database summary"),
    "suppliers": (cmd_suppliers, "Supplier network overview"),
    "timeline":  (cmd_timeline,  "EthosEnergy ICD and program timeline"),
    "analytics": (cmd_analytics, "Spend analysis and award scenarios"),
    "icd":       (cmd_icd,       "EthosEnergy ICD tracker"),
    "build":     (cmd_build,     "Run autonomous build loop"),
    "refresh":   (cmd_refresh,   "Refresh all dashboard data"),
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(BANNER)
        print("\n  Commands:")
        for cmd, (fn, desc) in COMMANDS.items():
            print(f"    {cmd:<12} {desc}")
        print(f"\n  Example: python3 flowseer.py status\n")
        return

    cmd  = sys.argv[1]
    rest = sys.argv[2:]

    class Args:
        subcommand = rest[0] if rest else None

    COMMANDS[cmd][0](Args())


if __name__ == "__main__":
    main()
