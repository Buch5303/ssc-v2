#!/usr/bin/env python3
"""
tools/scoring/contact_priority_scorer.py
Scores and ranks all W251 contacts by procurement impact.

Scoring factors:
  - Seniority (CEO=30, President=25, EVP=20, VP=15, Director=10, Manager=5)
  - Company tier (Strategic Tier 1=25, Tier 2=15, Tier 3=5)
  - BOP category value ($2M+=20, $1M+=15, $500K+=10, $200K+=5, other=2)
  - RFQ status (RESPONDED=30, DRAFTED=20, TIER1=10, NORMAL=0)
  - Relationship (existing=15, new=0)

Usage:
  python3 contact_priority_scorer.py
  python3 contact_priority_scorer.py --top 20
  python3 contact_priority_scorer.py --output scored_contacts.csv
"""
from __future__ import annotations
import argparse, csv
from pathlib import Path

ROOT = Path(__file__).parent.parent

SENIORITY_SCORES = {
    "ceo": 30, "chief executive": 30, "chairman": 30,
    "president": 25, "coo": 22, "cfo": 22,
    "evp": 20, "executive vice president": 20, "svp": 18,
    "vp": 15, "vice president": 15,
    "director": 10, "managing director": 12,
    "manager": 5, "engineer": 3,
}

COMPANY_TIER = {
    "baker hughes": 25, "ge vernova": 25, "ge power": 25,
    "siemens energy": 25, "siemens": 25,
    "emerson": 25, "donaldson": 25, "abb": 25,
    "eaton": 20, "ceco": 20, "flowserve": 20,
    "parker": 15, "amerex": 15, "turbotect": 15,
    "ethosenergy": 25,
}

CATEGORY_VALUES = {
    "GENERATOR": 2093850, "EMISSIONS": 891750, "TRANSFORMER": 760000,
    "FUEL_GAS": 700600, "ELEC_DIST": 535050, "INLET_AIR": 525150,
    "PIPING_VALVES": 507600, "CONTROLS_DCS": 504600, "EXHAUST": 430650,
    "CIVIL_STRUCT": 336250, "ACOUSTIC": 305100, "LUBE_OIL": 288900,
    "VIB_MON": 268250, "STARTING": 238950, "FIRE_FIGHT": 229400,
    "COOLING": 225450, "FUEL_OIL": 195750, "WATER_WASH": 132300,
    "TELECOMS": 104400,
}


def score_contact(contact: dict) -> int:
    score = 0
    title   = (contact.get("title", "") or "").lower()
    company = (contact.get("company", "") or "").lower()
    priority= contact.get("priority", "NORMAL")

    # Seniority
    for key, pts in SENIORITY_SCORES.items():
        if key in title:
            score += pts
            break

    # Company tier
    for key, pts in COMPANY_TIER.items():
        if key in company:
            score += pts
            break
    else:
        score += 5

    # RFQ status
    if priority == "ACTIVE_RFQ":
        score += 30
    elif priority == "TIER1":
        score += 10

    # Category value
    cat = contact.get("category", "")
    val = CATEGORY_VALUES.get(cat, 0)
    if val >= 2_000_000: score += 20
    elif val >= 1_000_000: score += 15
    elif val >= 500_000:  score += 10
    elif val >= 200_000:  score += 5
    else:                 score += 2

    return score


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--top",    type=int, default=0)
    p.add_argument("--output", default="")
    args = p.parse_args()

    input_csv = ROOT / "contact-verifier" / "contacts_sample.csv"
    if not input_csv.exists():
        print(f"No contacts found at {input_csv}")
        return

    with open(input_csv) as f:
        contacts = list(csv.DictReader(f))

    scored = []
    for c in contacts:
        s = score_contact(c)
        scored.append({**c, "priority_score": s})

    scored.sort(key=lambda x: -int(x.get("priority_score", 0)))

    if args.top:
        scored = scored[:args.top]

    print(f"{'RANK':<5} {'SCORE':<6} {'NAME':<28} {'COMPANY':<25} {'TITLE':<30} PRIORITY")
    print("-" * 110)
    for i, c in enumerate(scored, 1):
        print(f"{i:<5} {c.get('priority_score',''):<6} {c.get('full_name',''):<28} "
              f"{c.get('company',''):<25} {(c.get('title','') or '')[:30]:<30} {c.get('priority','')}")

    if args.output:
        out = ROOT / "scoring" / args.output
        out.parent.mkdir(exist_ok=True)
        with open(out, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(scored[0].keys()))
            writer.writeheader()
            writer.writerows(scored)
        print(f"\nOutput: {out}")


if __name__ == "__main__":
    main()
