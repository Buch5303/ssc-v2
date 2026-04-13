#!/usr/bin/env python3
"""
tools/reports/ethosenergy_icd_tracker.py
Tracks EthosEnergy ICD delivery status and manages escalation.

The ICD (Interface Control Document) from EthosEnergy is the single
biggest dependency in the Project Jupiter BOP procurement program.
It blocks: Transformer ($760K), Exhaust ($430K), Electrical ($535K) RFQs.
Total blocked value: $1.725M

This tracker:
  1. Tracks ICD request status and escalation history
  2. Computes schedule impact of each day of delay
  3. Generates escalation emails at each touch
  4. Writes flag file when ICD is received (unblocks G03 gate check)
"""
from __future__ import annotations
import argparse, json
from datetime import datetime, date, timedelta
from pathlib import Path

ROOT     = Path(__file__).parent.parent
ICD_FILE = ROOT / "reports/icd_tracker.json"
ICD_FLAG = ROOT / "reports/ethosenergy_icd_received.flag"

BLOCKED_RFQS = [
    ("TRANSFORMER", "ABB/Siemens", 760000, 60),   # 60 week lead
    ("EXHAUST",     "Baker Hughes/CECO", 430650, 24),
    ("ELEC_DIST",   "Eaton", 535050, 26),
]
TOTAL_BLOCKED = sum(v for _,_,v,_ in BLOCKED_RFQS)

CONTACTS = [
    {"name": "Alberto Malandra", "title": "Managing Director", "company": "EthosEnergy Italia",
     "email": "alberto.malandra@ethosenergy.com"},
    {"name": "Todd Dunlop", "title": "Director, New Manufactured Product", "company": "EthosEnergy",
     "email": "todd.dunlop@ethosenergy.com"},
]


def load_tracker():
    if ICD_FILE.exists():
        return json.loads(ICD_FILE.read_text())
    return {"status": "REQUESTED", "request_date": "2026-04-11",
            "required_by": "2026-05-01", "touches": [], "received": False}


def save_tracker(data):
    ICD_FILE.parent.mkdir(exist_ok=True)
    ICD_FILE.write_text(json.dumps(data, indent=2))


def mark_received(notes=""):
    data = load_tracker()
    data["status"]        = "RECEIVED"
    data["received"]      = True
    data["received_date"] = date.today().isoformat()
    data["notes"]         = notes
    save_tracker(data)
    ICD_FLAG.write_text(f"ICD received {date.today()}: {notes}")
    print(f"✅ ICD marked as RECEIVED — G03 gate unblocked")
    print(f"   This unblocks $1,725,650 in RFQs: Transformer, Exhaust, Electrical")


def status_report():
    data    = load_tracker()
    req_by  = date.fromisoformat(data["required_by"])
    today   = date.today()
    overdue = (today - req_by).days if today > req_by else 0
    days_to_rfq = (date(2026, 5, 25) - today).days

    print(f"""
╔══════════════════════════════════════════════════════╗
║      EthosEnergy ICD TRACKER — Project Jupiter      ║
╠══════════════════════════════════════════════════════╣
║  Status:    {data['status']:<42}║
║  Requested: {data['request_date']:<42}║
║  Required by: {data['required_by']:<40}║
║  Overdue:   {f'{overdue} days' if overdue > 0 else 'Not yet':<42}║
╠══════════════════════════════════════════════════════╣
║  BLOCKED RFQs              Value       Lead Time    ║
║  Transformer               $760,000    52-70 weeks  ║
║  Electrical Distribution   $535,050    26 weeks     ║
║  Exhaust System            $430,650    24 weeks     ║
║  Total blocked:          $1,725,700                 ║
╠══════════════════════════════════════════════════════╣
║  Days to RFQ Send: {days_to_rfq} days (May 25, 2026)         ║
╚══════════════════════════════════════════════════════╝""")

    if overdue > 0:
        print(f"\n⚠️  ICD is {overdue} days overdue. Escalate immediately.")
    print(f"\nContacts:")
    for c in CONTACTS:
        print(f"  {c['name']} ({c['title']}) — {c['email']}")


def generate_escalation(touch: int = 1):
    data = load_tracker()
    today = date.today().strftime("%B %d, %Y")
    rfq_date = "May 25, 2026"

    bodies = {
        1: f"""Dear Alberto,

I hope this message finds you well. Following our March 13 MOU execution, we are now in
active BOP procurement for Project Jupiter and urgently need the W251B8 Interface
Control Document (ICD) from EthosEnergy.

Specifically we need:
- Generator output voltage and MVA rating
- Exhaust flange dimensions and temperature profile
- Fuel gas pressure and composition specifications
- Lube oil system connections and flow rates
- Auxiliary power requirements (kW and voltage)

Without this data, we cannot finalize the Transformer, Exhaust, and Electrical
Distribution RFQs — which represent $1.73M of the BOP scope and carry 26-70 week
lead times.

Our RFQ send date is {rfq_date}. We need the ICD by May 1 to meet this deadline.

Can Todd Dunlop release a preliminary ICD this week?

Best regards,
Greg Buchanan | CEO, Trans World Power""",

        2: f"""Alberto,

Following up on my April 11 request for the W251B8 ICD. We are now within 6 weeks of
our May 25 RFQ send date and the Transformer, Exhaust, and Electrical Distribution
packages remain blocked.

The Transformer alone carries a 52-70 week lead time from PO. Every week of delay
on the ICD directly impacts our Q2 2027 first power target.

I need either:
a) A preliminary ICD with the 5 data points listed in my last message, OR
b) A confirmed date from Todd Dunlop for when full ICD will be available

If EthosEnergy cannot provide the ICD before May 1, we will need to assess the
schedule impact on the program and communicate to Oracle/OpenAI accordingly.

Greg Buchanan | CEO, Trans World Power | URGENT""",

        3: f"""Alberto — CRITICAL PATH ESCALATION

The W251B8 ICD is now on the critical path for Project Jupiter. Without it by May 1:

- Transformer RFQ CANNOT go out May 25 → PO slips to September → Delivery Q4 2027
- This moves First Power from Q2 2027 to Q4 2027 — a 6-month program slip
- Oracle/OpenAI campus commissioning timeline is at risk

I need an immediate response. Please escalate internally and commit to a delivery date.

If there is a technical issue preventing ICD release, I am available for a call today
or tomorrow with Todd Dunlop to resolve it.

Greg Buchanan
CEO, Trans World Power
+1 (___) ___-____"""
    }

    body = bodies.get(touch, bodies[3])
    subj = {
        1: "Project Jupiter — W251B8 Interface Control Document Request",
        2: "URGENT: Project Jupiter ICD — 6 Weeks to RFQ Send",
        3: "CRITICAL PATH: Project Jupiter ICD Overdue — Schedule Impact",
    }.get(touch, "ESCALATION: Project Jupiter ICD Required Immediately")

    print(f"\n=== Touch {touch} Escalation — {today} ===\n")
    print(f"To: alberto.malandra@ethosenergy.com")
    print(f"CC: todd.dunlop@ethosenergy.com")
    print(f"Subject: {subj}")
    print(f"\n{body}")

    data["touches"].append({"touch": touch, "date": date.today().isoformat(), "subject": subj})
    save_tracker(data)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--status",          action="store_true")
    p.add_argument("--escalate",        type=int, metavar="TOUCH", help="Generate touch 1/2/3 escalation")
    p.add_argument("--mark-received",   action="store_true")
    p.add_argument("--notes",           default="")
    args = p.parse_args()

    if args.mark_received:
        mark_received(args.notes)
    elif args.escalate:
        generate_escalation(args.escalate)
    else:
        status_report()


if __name__ == "__main__":
    main()
