#!/usr/bin/env python3
"""
tools/scheduling/rfq_send_scheduler.py
RFQ send scheduler for May 25, 2026.
Manages pre-send checklist, send order, and confirmation tracking.

Usage:
  python3 rfq_send_scheduler.py --status          # show readiness
  python3 rfq_send_scheduler.py --checklist       # full pre-send checklist
  python3 rfq_send_scheduler.py --generate-send-plan  # ordered send plan
"""
from __future__ import annotations
import argparse, json
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"
DRAFT_DIR= ROOT / "rfq-generator/drafts"

RFQ_SEND_DATE = date(2026, 5, 25)

SEND_ORDER = [
    ("Emerson",          "Bob Yeager",       "Fuel Gas System",         700600, "rfq_bob_yeager_emerson.txt"),
    ("Donaldson",        "Tod Carpenter",    "Inlet Air Filtering",      525150, "rfq_tod_carpenter_donaldson.txt"),
    ("Donaldson",        "Michael Wynblatt", "Controls/DCS",             504600, "rfq_michael_wynblatt_donaldson.txt"),
    ("Baker Hughes",     "Rod Christie",     "Exhaust System",           430650, "rfq_rod_christie_bakerhughes.txt"),
    ("ABB/Siemens",      "TBD",              "Step-up Transformer",      760000, None),
    ("GE/Siemens",       "TBD",              "Generator + Switchgear",  2093850, None),
    ("Amerex",           "Harrison K",       "Fire Fighting",            229400, "rfq_harrison_amerex.txt"),
    ("Turbotect",        "Neil Ashford",     "Compressor Washing",       132300, "rfq_neil_ashford_turbotect.txt"),
]

CHECKLIST = [
    ("EthosEnergy ICD received",         "critical", "Required for Transformer + Exhaust RFQs"),
    ("Baker Hughes VIB_MON decision made","high",     "Accept $340K quote or counter"),
    ("Trillium AVOID — Flowserve selected","high",    "Piping & Valves supplier confirmed"),
    ("All 6 draft RFQs reviewed",         "high",     "Final review by Greg Buchanan"),
    ("Contact email addresses verified",  "high",     "Verify delivery for all 7 contacts"),
    ("ABB/Siemens Transformer RFQ final", "medium",   "Pending EthosEnergy ICD"),
    ("GE/Siemens Generator RFQ final",    "medium",   "Technical spec required"),
    ("Legal review of RFQ terms",         "medium",   "Standard terms and conditions"),
    ("Budget approval for awards",        "medium",   "Pre-approve up to $9.5M"),
    ("CRM contacts updated",              "low",      "Salesforce or equivalent"),
    ("Out-of-office coverage plan",       "low",      "Response routing during May 25 week"),
]


def days_to_send():
    return (RFQ_SEND_DATE - date.today()).days


def show_status():
    rfqs = []
    if RFQ_FILE.exists():
        rfqs = json.loads(RFQ_FILE.read_text()).get("rfqs", [])

    days = days_to_send()
    drafted  = [r for r in rfqs if r["status"] == "DRAFTED"]
    responded= [r for r in rfqs if r["status"] == "RESPONDED"]
    total_val= sum(r["est_value_usd"] for r in rfqs)

    print(f"""
╔═══════════════════════════════════════════════════╗
║       RFQ SEND SCHEDULER — Project Jupiter        ║
╠═══════════════════════════════════════════════════╣
║  Send Date:    May 25, 2026                       ║
║  Days Out:     {days:<35}║
║  RFQs Drafted: {len(drafted):<35}║
║  Responded:    {len(responded):<35}║
║  Pipeline:     ${total_val:,.0f}{" "*max(0,25-len(f"${total_val:,.0f}"))}║
╚═══════════════════════════════════════════════════╝""")

    print("\nSend Order:")
    for i,(co,contact,cat,val,draft) in enumerate(SEND_ORDER, 1):
        has_draft = "✅" if draft and (DRAFT_DIR/draft).exists() else ("⚠️ " if not draft else "❌")
        print(f"  {i}. {has_draft} {co:<20} {contact:<20} {cat:<28} ${val:,.0f}")


def show_checklist():
    days = days_to_send()
    print(f"\nPRE-SEND CHECKLIST — {days} days to May 25, 2026\n")
    for item, priority, note in CHECKLIST:
        icon = "🔴" if priority=="critical" else ("🟡" if priority=="high" else "⚪")
        print(f"  {icon} [ ] {item}")
        print(f"         {note}")
    print()


def generate_send_plan():
    days = days_to_send()
    lines = [
        f"# RFQ Send Plan — May 25, 2026",
        f"**Days Until Send:** {days}",
        f"**Prepared by:** FlowSeer Scheduling Engine",
        f"",
        f"## Send Order (by strategic priority)",
        f"",
        f"| Order | Time | Supplier | Contact | Category | Value | Draft |",
        f"|-------|------|---------|---------|----------|-------|-------|",
    ]
    times = ["9:00 AM","9:15 AM","9:30 AM","9:45 AM","10:00 AM","10:15 AM","10:30 AM","10:45 AM"]
    for i,(co,contact,cat,val,draft) in enumerate(SEND_ORDER):
        t = times[i] if i < len(times) else "TBD"
        status = "✅ Ready" if draft and (DRAFT_DIR/draft).exists() else ("⚠️ Needs ICD" if not draft else "❌ Missing")
        lines.append(f"| {i+1} | {t} | {co} | {contact} | {cat} | ${val:,.0f} | {status} |")

    total = sum(v for _,_,_,v,_ in SEND_ORDER)
    lines += [
        f"",
        f"**Total Value Going to Market: ${total:,.0f}**",
        f"",
        f"## Pre-Send Checklist",
        f"",
    ]
    for item, priority, note in CHECKLIST:
        icon = "🔴" if priority=="critical" else ("🟡" if priority=="high" else "⚪")
        lines.append(f"- {icon} [ ] **{item}** — {note}")

    out = Path(__file__).parent / "rfq_send_plan.md"
    out.write_text("\n".join(lines))
    print(f"Send plan written: {out}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--status",             action="store_true")
    p.add_argument("--checklist",          action="store_true")
    p.add_argument("--generate-send-plan", action="store_true")
    args = p.parse_args()

    if args.checklist:
        show_checklist()
    elif args.generate_send_plan:
        generate_send_plan()
    else:
        show_status()


if __name__ == "__main__":
    main()
