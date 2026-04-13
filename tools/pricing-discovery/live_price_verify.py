#!/usr/bin/env python3
"""
tools/pricing-discovery/live_price_verify.py
Live price verification engine — runs when API keys are available.

Upgrades categories from COMPONENT_BUILDUPS to higher confidence
by querying: USASpending, FERC, Google CSE, Perplexity.

Usage:
  python3 live_price_verify.py --category VIB_MON
  python3 live_price_verify.py --all --dry-run
  python3 live_price_verify.py --priority STRATEGIC
"""
from __future__ import annotations
import argparse, csv, json, os, time
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "orchestrator" / ".env")
except ImportError:
    pass

import requests

ROOT          = Path(__file__).parent
PRICE_CSV     = ROOT / "outputs" / "pricing_updated.csv"
VERIFY_LOG    = ROOT / "outputs" / "verification_log.jsonl"
GOOGLE_KEY    = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE    = os.getenv("GOOGLE_CSE_ID", "")
PERPLEXITY_KEY= os.getenv("PERPLEXITY_API_KEY", "")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")

STRATEGIC_CATS = ["GENERATOR","EMISSIONS","TRANSFORMER","FUEL_GAS","ELEC_DIST",
                  "INLET_AIR","PIPING_VALVES","CONTROLS_DCS"]


def log_event(event: dict) -> None:
    with open(VERIFY_LOG, "a") as f:
        f.write(json.dumps({**event, "ts": datetime.utcnow().isoformat()}) + "\n")


def usaspending_search(keywords: list, category: str) -> list:
    """Search USASpending.gov for federal contracts."""
    try:
        r = requests.post(
            "https://api.usaspending.gov/api/v2/search/spending_by_award/",
            json={
                "filters": {
                    "keywords": keywords,
                    "award_type_codes": ["A","B","C","D"],
                    "time_period": [{"start_date":"2020-01-01","end_date":"2024-12-31"}],
                },
                "fields": ["Award ID","Recipient Name","Award Amount","Description"],
                "limit": 5, "page": 1, "sort": "Award Amount", "order": "desc",
            },
            timeout=15,
        )
        if r.status_code == 200:
            results = r.json().get("results", [])
            findings = []
            for item in results:
                try:
                    amt = float(item.get("Award Amount") or 0)
                    if amt > 10_000:
                        findings.append({
                            "source": "USASpending",
                            "value_usd": amt,
                            "description": item.get("Description",""),
                            "recipient": item.get("Recipient Name",""),
                        })
                except: pass
            log_event({"action": "usaspending_search", "category": category, "hits": len(findings)})
            return findings
    except Exception as e:
        log_event({"action": "usaspending_error", "category": category, "error": str(e)})
    return []


def perplexity_verify(category_name: str, bom_estimate: float) -> dict:
    """Use Perplexity to verify pricing against web sources."""
    if not PERPLEXITY_KEY:
        return {}
    try:
        r = requests.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {PERPLEXITY_KEY}", "Content-Type": "application/json"},
            json={
                "model": "sonar",
                "messages": [{
                    "role": "user",
                    "content": f"What is the current market price for a {category_name} for a 50MW natural gas power plant? "
                               f"Internal estimate is ${bom_estimate:,.0f}. Provide specific USD price ranges from industry sources. "
                               f"Return JSON: {{price_low, price_mid, price_high, source, year}}"
                }],
                "max_tokens": 200,
            },
            timeout=20,
        )
        if r.status_code == 200:
            content = r.json()["choices"][0]["message"]["content"]
            start = content.find("{")
            end   = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
    except Exception as e:
        log_event({"action": "perplexity_error", "error": str(e)})
    return {}


def verify_category(code: str, dry_run: bool = False) -> dict:
    rows = []
    if PRICE_CSV.exists():
        with open(PRICE_CSV) as f:
            rows = list(csv.DictReader(f))

    row = next((r for r in rows if r.get("category_code") == code), None)
    if not row:
        return {"status": "not_found", "code": code}

    cat_name = row.get("category", code)
    bom_mid  = float(row.get("mid_usd") or row.get("bom_mid", 0))

    print(f"  Verifying {cat_name} (BOM: ${bom_mid:,.0f})...")

    if dry_run:
        return {"code": code, "category": cat_name, "bom_mid": bom_mid,
                "status": "dry_run", "confidence": row.get("confidence_label")}

    results = {"code": code, "category": cat_name, "bom_mid": bom_mid, "sources": []}

    # USASpending search
    keywords = [w for w in cat_name.split() if len(w) > 3][:3]
    keywords += ["gas turbine", "power plant"]
    usas = usaspending_search(keywords, code)
    if usas:
        vals = [u["value_usd"] for u in usas]
        results["usaspending"] = {
            "count": len(usas),
            "median": sorted(vals)[len(vals)//2],
            "min": min(vals),
            "max": max(vals),
        }
        results["sources"].append("USASpending")
        time.sleep(1)

    # Perplexity verify
    if PERPLEXITY_KEY:
        perp = perplexity_verify(cat_name, bom_mid)
        if perp.get("price_mid"):
            results["perplexity"] = perp
            results["sources"].append("Perplexity")
        time.sleep(2)

    # Compute blended estimate
    all_mids = [bom_mid]
    if results.get("usaspending", {}).get("median"):
        all_mids.append(results["usaspending"]["median"])
    if results.get("perplexity", {}).get("price_mid"):
        all_mids.append(float(results["perplexity"]["price_mid"]))

    blended = sum(all_mids) / len(all_mids)
    variance = (blended - bom_mid) / bom_mid * 100 if bom_mid else 0

    results["blended_mid"]  = round(blended)
    results["variance_pct"] = round(variance, 1)
    results["source_count"] = len(results["sources"])
    results["confidence"]   = "MARKET_ANCHOR" if len(results["sources"]) >= 2 else "COMPONENT_BUILDUPS"

    log_event({**results})
    return results


def main():
    p = argparse.ArgumentParser(description="Live price verification")
    p.add_argument("--category",  help="Single category code")
    p.add_argument("--priority",  help="STRATEGIC | TARGETED | STANDARD")
    p.add_argument("--all",       action="store_true")
    p.add_argument("--dry-run",   action="store_true")
    args = p.parse_args()

    cats_to_run = []
    if args.category:
        cats_to_run = [args.category.upper()]
    elif args.priority == "STRATEGIC":
        cats_to_run = STRATEGIC_CATS
    elif args.all:
        if PRICE_CSV.exists():
            with open(PRICE_CSV) as f:
                cats_to_run = [r["category_code"] for r in csv.DictReader(f)
                               if r.get("category_code") and r.get("category") != "TOTAL"]

    if not cats_to_run:
        print("Specify --category CODE, --priority STRATEGIC, or --all")
        return

    mode = "[DRY-RUN] " if args.dry_run else ""
    print(f"{mode}Verifying {len(cats_to_run)} categories...")

    for code in cats_to_run:
        result = verify_category(code, args.dry_run)
        src_count = result.get("source_count", 0)
        variance  = result.get("variance_pct", 0)
        blended   = result.get("blended_mid", 0)
        status    = f"${blended:,.0f} ({variance:+.1f}%) [{src_count} sources]" if blended else result.get("status","")
        print(f"  {code:<16} {status}")
        if not args.dry_run:
            time.sleep(2)

    print(f"\nLog: {VERIFY_LOG}")


if __name__ == "__main__":
    main()
