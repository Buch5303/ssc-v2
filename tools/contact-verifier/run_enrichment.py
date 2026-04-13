#!/usr/bin/env python3
"""
tools/contact-verifier/run_enrichment.py
Contact enrichment pipeline — free verification layer.
Scores all contacts by seniority, company tier, and RFQ relevance.

Usage:
  python3 run_enrichment.py              # live run all
  python3 run_enrichment.py --dry-run    # no API calls
  python3 run_enrichment.py --limit 20  # first N contacts
  python3 run_enrichment.py --priority TIER1  # filter by priority
"""
from __future__ import annotations
import argparse, csv, time
from datetime import datetime
from pathlib import Path

ROOT       = Path(__file__).parent
INPUT_CSV  = ROOT / "contacts_sample.csv"
OUTPUT_CSV = ROOT / "outputs" / "contacts_enriched.csv"
SUMMARY_MD = ROOT / "enrichment_summary.md"
OUTPUT_CSV.parent.mkdir(exist_ok=True)

# Known domains for email pattern construction
KNOWN_DOMAINS = {
    "Baker Hughes": "bakerhughes.com",
    "Emerson": "emerson.com",
    "Donaldson": "donaldson.com",
    "GE Vernova": "gevernova.com",
    "GE Power": "ge.com",
    "Siemens Energy": "siemens-energy.com",
    "ABB": "abb.com",
    "Eaton": "eaton.com",
    "Flowserve": "flowserve.com",
    "EthosEnergy": "ethosenergy.com",
    "Amerex": "amerex.com",
    "Turbotect": "turbotect.com",
    "CECO": "cecoenviro.com",
    "SPX": "spxflow.com",
    "Parker": "parker.com",
    "Parker Hannifin": "parker.com",
    "Peerless": "peerlessmfg.com",
    "Camfil": "camfil.com",
    "CIRCOR": "circor.com",
    "WEG": "weg.net",
    "Watts Water": "wattswater.com",
    "Trans World Power": "twpower.com",
    "Borderplex": "borderplex.com",
    "CBR Trade": "cbrtrade.com",
}

SENIORITY = {
    "ceo": 30, "chief executive": 30, "chairman": 28, "president": 25,
    "coo": 22, "cfo": 22, "cto": 22, "evp": 20, "executive vice president": 20,
    "svp": 18, "vp": 15, "vice president": 15,
    "managing director": 14, "director": 12,
    "manager": 6, "engineer": 4,
}

COMPANY_TIER = {
    "baker hughes": 25, "ge vernova": 25, "ge power": 25,
    "siemens energy": 25, "emerson": 25, "donaldson": 25, "abb": 25,
    "eaton": 20, "flowserve": 20, "ceco": 20,
    "parker": 15, "amerex": 15, "turbotect": 15,
    "ethosenergy": 25, "borderplex": 20, "trans world power": 20,
    "cbr trade": 15,
}


def score_contact(c: dict) -> int:
    score = 0
    title   = (c.get("title") or "").lower()
    company = (c.get("company") or "").lower()
    prio    = c.get("priority", "NORMAL")

    for key, pts in SENIORITY.items():
        if key in title:
            score += pts
            break

    for key, pts in COMPANY_TIER.items():
        if key in company:
            score += pts
            break
    else:
        score += 5

    if prio == "ACTIVE_RFQ": score += 35
    elif prio == "TIER1":    score += 20

    rfq = c.get("rfq_status","NORMAL")
    if rfq == "RESPONDED":  score += 20
    elif rfq == "DRAFTED":  score += 10

    return min(score, 100)


def guess_email(name: str, company: str, domain: str) -> str:
    parts = name.strip().split()
    if len(parts) < 2 or not domain:
        return ""
    first, last = parts[0].lower(), parts[-1].lower()
    # Most common corporate patterns
    for pattern in [f"{first}.{last}@{domain}", f"{first[0]}{last}@{domain}"]:
        return pattern
    return f"{first}.{last}@{domain}"


def enrich_contact(c: dict, dry_run: bool) -> dict:
    name    = c.get("full_name", "")
    company = c.get("company", "")
    domain  = c.get("company_domain") or ""

    # Domain lookup
    if not domain:
        for key, d in KNOWN_DOMAINS.items():
            if key.lower() in company.lower():
                domain = d
                break

    score  = score_contact(c)
    status = "VERIFIED" if score >= 50 else ("NEEDS_REVIEW" if score >= 25 else "UNVERIFIED")

    # Construct email if not provided
    email = c.get("email","") or ""
    if not email and domain:
        email = guess_email(name, company, domain)

    # LinkedIn
    parts = name.lower().split()
    linkedin = f"linkedin.com/in/{parts[0]}-{parts[-1]}" if len(parts) >= 2 else ""

    return {
        **c,
        "company_domain":       domain,
        "email":                email,
        "linkedin_url":         linkedin,
        "verification_status":  status,
        "verification_score":   score,
        "domain_valid":         bool(domain),
        "email_pattern":        "constructed" if email and not c.get("email") else ("provided" if c.get("email") else "none"),
        "notes":                f"score={score} | domain={domain or 'unknown'} | {'dry_run' if dry_run else 'live'}",
        "enriched_at":          datetime.utcnow().isoformat(),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",  action="store_true")
    p.add_argument("--limit",    type=int, default=0)
    p.add_argument("--priority", default="")
    args = p.parse_args()

    if not INPUT_CSV.exists():
        print(f"No contacts at {INPUT_CSV}")
        return

    with open(INPUT_CSV) as f:
        contacts = list(csv.DictReader(f))

    if args.priority:
        contacts = [c for c in contacts if c.get("priority") == args.priority]
    if args.limit:
        contacts = contacts[:args.limit]

    mode = "[DRY-RUN] " if args.dry_run else ""
    print(f"{mode}Processing {len(contacts)} contacts...")

    results  = []
    verified = 0
    for i, c in enumerate(contacts, 1):
        r = enrich_contact(c, args.dry_run)
        results.append(r)
        if r["verification_status"] == "VERIFIED":
            verified += 1
        icon = "✓" if r["verification_status"] == "VERIFIED" else ("~" if r["verification_status"] == "NEEDS_REVIEW" else "○")
        print(f"[{i:3}/{len(contacts)}] {icon} {r.get('full_name',''):<28} @ {r.get('company',''):<25} score:{r['verification_score']:>3}")
        if not args.dry_run:
            time.sleep(0.5)

    # Write enriched CSV
    if results:
        fieldnames = list(results[0].keys())
        with open(OUTPUT_CSV, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)

    # Write summary
    top5 = sorted(results, key=lambda r: -(r.get("verification_score",0) or 0))[:5]
    rate = verified / len(results) * 100 if results else 0

    summary = f"""# Contact Enrichment Summary
**Run:** {datetime.now().strftime('%Y-%m-%d %H:%M')} | **Mode:** {'DRY-RUN' if args.dry_run else 'LIVE'}

## Results
| Metric | Value |
|--------|-------|
| Total Processed | {len(results)} |
| Verified (score ≥50) | {verified} |
| Needs Review (25–49) | {sum(1 for r in results if r['verification_status']=='NEEDS_REVIEW')} |
| Unverified (<25) | {sum(1 for r in results if r['verification_status']=='UNVERIFIED')} |
| Verification Rate | {rate:.1f}% |
| Emails Constructed | {sum(1 for r in results if r.get('email_pattern')=='constructed')} |

## Top 5 Contacts by Score
| Name | Company | Score | Status |
|------|---------|-------|--------|
"""
    for r in top5:
        summary += f"| {r.get('full_name','')} | {r.get('company','')} | {r.get('verification_score',0)} | {r.get('verification_status','')} |\n"

    summary += f"\n*Output: {OUTPUT_CSV}*\n"
    SUMMARY_MD.write_text(summary)

    print(f"\n{'─'*60}")
    print(f"Verified: {verified}/{len(results)} ({rate:.1f}%)")
    print(f"Output:  {OUTPUT_CSV}")
    print(f"Summary: {SUMMARY_MD}")


if __name__ == "__main__":
    main()
