#!/usr/bin/env python3
"""
FlowSeer — TG20/W251 BOP Intelligence Platform
Master CLI — single entry point for all platform functions.

Usage:
  python3 flowseer.py status          # full program dashboard
  python3 flowseer.py alerts          # current program alerts
  python3 flowseer.py health          # 25-check platform health
  python3 flowseer.py pricing         # 19-category BOP summary
  python3 flowseer.py rfq             # 13-package pipeline
  python3 flowseer.py rfq send        # May 25 send plan
  python3 flowseer.py log             # log a supplier response
  python3 flowseer.py contacts        # contact database
  python3 flowseer.py suppliers       # supplier network
  python3 flowseer.py analytics       # spend + scenarios
  python3 flowseer.py icd             # EthosEnergy ICD status
  python3 flowseer.py icd escalate    # generate escalation email
  python3 flowseer.py build           # autonomous build loop
  python3 flowseer.py refresh         # refresh all dashboard data + push
"""
from __future__ import annotations
import argparse, csv, json, subprocess, sys
from datetime import datetime, date
from pathlib import Path

TOOLS  = Path(__file__).parent
ROOT   = TOOLS.parent
PYTHON = sys.executable

BANNER = """
╔══════════════════════════════════════════════════════════════╗
║  FlowSeer — TG20/W251 BOP Intelligence Platform             ║
║  Client: Borderplex · Santa Teresa NM · Trans World Power   ║
╚══════════════════════════════════════════════════════════════╝"""


def run(script: str, *args: str) -> int:
    return subprocess.run([PYTHON, str(TOOLS / script)] + list(args)).returncode


def load_json(path: str) -> dict:
    p = TOOLS / path
    return json.loads(p.read_text()) if p.exists() else {}


def load_csv(path: str) -> list:
    p = TOOLS / path
    if not p.exists(): return []
    with open(p) as f:
        return [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]


def days_to_send():
    return (date(2026, 5, 25) - date.today()).days


def cmd_status(args):
    print(BANNER)
    rfqs    = load_json("rfq-generator/rfq_status.json").get("rfqs", [])
    pricing = load_csv("pricing-discovery/outputs/bop_cost_model.csv") or \
              load_csv("pricing-discovery/outputs/pricing_updated.csv")
    days    = days_to_send()
    total   = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in pricing)
    resp    = [r for r in rfqs if r["status"] == "RESPONDED"]
    draft   = [r for r in rfqs if r["status"] == "DRAFTED"]
    verif   = [r for r in pricing if r.get("confidence") == "RFQ_VERIFIED" or r.get("confidence_label") == "RFQ_VERIFIED"]
    icd     = (TOOLS / "reports/ethosenergy_icd_received.flag").exists()

    print(f"""
  PROGRAM STATUS — {datetime.now().strftime('%B %d, %Y')}
  {'─'*56}
  BOP Baseline:         ${total:,.0f}
  Categories Priced:    19 / 19
  Categories Verified:  {len(verif)} / 19
  RFQ Pipeline:         {len(rfqs)} packages  |  {len(resp)} responded  |  {len(draft)} drafted
  Pipeline Value:       ${sum(r.get('est_value_usd',0) for r in rfqs):,.0f}
  Days to RFQ Send:     {days} days  (May 25, 2026)
  BH VIB_MON Quote:     $340,000  (+26.7% vs estimate)
  {'─'*56}
  EthosEnergy ICD:      {'✅ RECEIVED' if icd else '🔴 PENDING — blocks $1.725M in RFQs'}
  Trillium AVOID:       ✅ RESOLVED — Flowserve selected
  Generator RFQ:        ✅ Ready (GE Vernova + Siemens — critical path)
  Platform Health:      Run: python3 flowseer.py health
  Dashboard:            https://ssc-v2.vercel.app
  {'─'*56}""")
    print()


def cmd_alerts(args):
    run("notifications/alert_manager.py")


def cmd_health(args):
    run("monitoring/platform_health.py")


def cmd_pricing(args):
    print(BANNER)
    rows  = load_csv("pricing-discovery/outputs/bop_cost_model.csv") or \
            load_csv("pricing-discovery/outputs/pricing_updated.csv")
    total = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in rows)
    print(f"\n  BOP PRICING — 19 categories | Baseline: ${total:,.0f}")
    print(f"  {'─'*65}")
    print(f"  {'CATEGORY':<38} {'MID':>10}  {'TIER':<12}  CONFIDENCE")
    print(f"  {'─'*65}")
    for r in sorted(rows, key=lambda x: -float(x.get("mid_usd") or x.get("bom_mid", 0))):
        mid  = float(r.get("mid_usd") or r.get("bom_mid", 0))
        conf = r.get("confidence") or r.get("confidence_label","")
        icon = "✅" if conf == "RFQ_VERIFIED" else "○"
        avd  = " ⚠AVOID" if r.get("avoid_supplier") else ""
        print(f"  {icon} {r.get('category','')[:36]:<36} ${mid:>10,.0f}  {r.get('spend_tier',''):<12}{avd}")
    print(f"  {'─'*65}")
    print(f"  {'TOTAL':<38} ${total:>10,.0f}")
    print(f"\n  Scenarios: Optimistic $9.14M | Base $9.27M | Conservative $10.08M\n")


def cmd_rfq(args):
    sub = getattr(args, 'subcommand', None)
    if sub == "send":
        run("scheduling/rfq_send_scheduler.py", "--status")
        return
    rfqs = load_json("rfq-generator/rfq_status.json").get("rfqs", [])
    days = days_to_send()
    print(BANNER)
    print(f"\n  RFQ PIPELINE — {len(rfqs)} packages | {days} days to May 25 send")
    print(f"  {'─'*72}")
    print(f"  {'ID':<8} {'COMPANY':<22} {'CATEGORY':<30} {'VALUE':>12}  STATUS")
    print(f"  {'─'*72}")
    for r in rfqs:
        val   = r.get("quoted_price") or r.get("est_value_usd", 0)
        icon  = "✅" if r["status"] == "RESPONDED" else ("🚫" if r["status"] == "BLOCKED" else "○")
        flags = " ⚠" if "CRITICAL" in (r.get("notes","") or "") else ""
        print(f"  {icon} {r.get('id',''):<6}  {r.get('company',''):<22} "
              f"{r.get('category','')[:28]:<28} ${val:>12,.0f}  {r['status']}{flags}")
    total = sum(r.get("est_value_usd", 0) for r in rfqs)
    print(f"  {'─'*72}")
    print(f"  {'TOTAL':<64} ${total:>12,.0f}\n")


def cmd_log(args):
    """Interactive wrapper for log_response.py"""
    print(BANNER)
    print("\n  LOG SUPPLIER RESPONSE")
    print("  ─"*28)
    rfq_id   = input("  RFQ ID (e.g. RFQ-002):    ").strip()
    supplier = input("  Supplier name:             ").strip()
    contact  = input("  Contact name:              ").strip()
    quoted   = input("  Quoted price (USD):        $").strip().replace(",","")
    date_in  = input(f"  Response date [{date.today().isoformat()}]: ").strip()
    notes    = input("  Notes (optional):          ").strip()
    if not date_in:
        date_in = date.today().isoformat()
    cmd = [PYTHON, str(TOOLS/"rfq-generator/log_response.py"),
           "--rfq", rfq_id, "--supplier", supplier, "--contact", contact,
           "--quoted", quoted, "--date", date_in]
    if notes:
        cmd += ["--notes", notes]
    subprocess.run(cmd)


def cmd_contacts(args):
    run("contact-verifier/run_enrichment.py", "--dry-run", "--limit", "10")


def cmd_suppliers(args):
    print(BANNER)
    si = (TOOLS / "supplier-intelligence/supplier_profiles.md")
    if si.exists():
        lines   = si.read_text().split("\n")
        headers = [l for l in lines if l.startswith("## ")]
        print(f"\n  SUPPLIER INTELLIGENCE — {len(headers)} strategic profiles")
        print(f"  {'─'*50}")
        for h in headers:
            print(f"    {h.replace('## ','')}")
        print(f"\n  Full profiles:  tools/supplier-intelligence/supplier_profiles.md")
        print(f"  Matrix:         tools/supplier-intelligence/supplier_comparison_matrix.md\n")


def cmd_analytics(args):
    print(BANNER)
    run("analytics/award_scenario_modeler.py")
    print()
    run("analytics/response_predictor.py")


def cmd_icd(args):
    sub = getattr(args, 'subcommand', None)
    if sub == "escalate":
        run("reports/ethosenergy_icd_tracker.py", "--escalate", "1")
    elif sub == "received":
        notes = input("  Notes on ICD receipt: ").strip()
        run("reports/ethosenergy_icd_tracker.py", "--mark-received", "--notes", notes)
        print("\n  ✅ ICD marked received — re-run 'python3 flowseer.py refresh' to update dashboard")
    else:
        run("reports/ethosenergy_icd_tracker.py", "--status")


def cmd_build(args):
    import os
    os.chdir(TOOLS / "orchestrator")
    subprocess.run([PYTHON, "go.py"])


def cmd_refresh(args):
    print("  Refreshing dashboard data...")
    run("dashboard/generate_dashboard_data.py")
    print("  Running health check...")
    result = subprocess.run([PYTHON, str(TOOLS/"monitoring/platform_health.py")],
                            capture_output=True, text=True)
    if "25/25" in result.stdout:
        print("  ✅ Health: 25/25")
    else:
        print(result.stdout)
    print("\n  To push to dashboard:")
    print("  git add -A && git commit -m 'Refresh: platform data updated' && git push origin frontend-only\n")


COMMANDS = {
    "status":    (cmd_status,    "Full program status"),
    "alerts":    (cmd_alerts,    "Current alerts (critical, high, low)"),
    "health":    (cmd_health,    "Platform health — 25 checks"),
    "pricing":   (cmd_pricing,   "BOP pricing summary — 19 categories"),
    "rfq":       (cmd_rfq,       "RFQ pipeline — 13 packages"),
    "log":       (cmd_log,       "Log a supplier response (interactive)"),
    "contacts":  (cmd_contacts,  "Contact database summary"),
    "suppliers": (cmd_suppliers, "Supplier network overview"),
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
            print(f"    {cmd:<14} {desc}")
        print(f"\n  Example: python3 flowseer.py status")
        print(f"  Dashboard: https://ssc-v2.vercel.app\n")
        return
    cmd  = sys.argv[1]
    rest = sys.argv[2:]

    class Args:
        subcommand = rest[0] if rest else None

    COMMANDS[cmd][0](Args())


if __name__ == "__main__":
    main()
