#!/usr/bin/env python3
"""
tools/dashboard/generate_dashboard_data.py
Generates static JSON data files for the FlowSeer dashboard.
Run this to refresh dashboard without requiring live API.

Outputs to tools/dashboard/data/:
  program_summary.json
  pricing_data.json
  rfq_pipeline.json
  supplier_network.json
  contact_stats.json
  kpi_band.json

Usage:
  python3 generate_dashboard_data.py
  python3 generate_dashboard_data.py --watch  # regenerate every 5 minutes
"""
from __future__ import annotations
import csv, json, time
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
OUT_DIR  = Path(__file__).parent / "data"
OUT_DIR.mkdir(exist_ok=True)


def read_json(p: Path) -> dict:
    try: return json.loads(p.read_text())
    except: return {}


def read_csv(p: Path) -> list:
    try:
        with open(p) as f: return list(csv.DictReader(f))
    except: return []


def write_json(name: str, data: dict) -> None:
    path = OUT_DIR / name
    path.write_text(json.dumps(data, indent=2, default=str))
    print(f"  ✓ {name}")


def generate():
    print(f"Generating dashboard data — {datetime.now().strftime('%H:%M:%S')}")

    rfqs    = read_json(ROOT / "rfq-generator/rfq_status.json").get("rfqs", [])
    pricing = read_csv(ROOT / "pricing-discovery/outputs/pricing_updated.csv")
    bop_csv = read_csv(ROOT / "pricing-discovery/outputs/bop_cost_model.csv")

    # Filter real categories (not TOTAL row)
    pricing = [r for r in pricing if r.get("category") and r.get("category") != "TOTAL"]
    bop_csv = [r for r in bop_csv if r.get("category") and r.get("category") != "TOTAL"]

    total_mid  = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in (pricing or bop_csv))
    total_low  = sum(float(r.get("scenario_optimistic") or r.get("low_usd",0)) for r in bop_csv)
    total_high = sum(float(r.get("scenario_pessimistic") or r.get("high_usd",0)) for r in bop_csv)

    responded = [r for r in rfqs if r.get("status") == "RESPONDED"]
    drafted   = [r for r in rfqs if r.get("status") == "DRAFTED"]
    strategic = [r for r in (pricing or bop_csv) if r.get("spend_tier") == "STRATEGIC"]
    verified  = [r for r in (pricing or bop_csv) if r.get("confidence_label") == "RFQ_VERIFIED"]

    rfq_day  = date(2026, 5, 25)
    today    = date.today()
    days_out = (rfq_day - today).days

    # 1. Program summary
    write_json("program_summary.json", {
        "program":           "Project Jupiter — 50MW W251B8",
        "location":          "Santa Teresa, NM",
        "client":            "Oracle / OpenAI",
        "gt_supplier":       "EthosEnergy Italia",
        "program_manager":   "Trans World Power",
        "total_bop_mid":     round(total_mid),
        "total_bop_low":     round(total_low),
        "total_bop_high":    round(total_high),
        "bop_categories":    len(pricing or bop_csv),
        "strategic_categories": len(strategic),
        "total_contacts":    231,
        "verified_contacts": 64,
        "total_rfqs":        len(rfqs),
        "rfqs_responded":    len(responded),
        "rfqs_drafted":      len(drafted),
        "rfq_send_date":     "2026-05-25",
        "days_to_rfq_send":  days_out,
        "baker_hughes_quote":340000,
        "last_updated":      datetime.utcnow().isoformat(),
    })

    # 2. Pricing data
    write_json("pricing_data.json", {
        "categories": pricing or bop_csv,
        "total_mid":  round(total_mid),
        "verified":   len(verified),
        "estimated":  len((pricing or bop_csv)) - len(verified),
        "last_updated": datetime.utcnow().isoformat(),
    })

    # 3. RFQ pipeline
    write_json("rfq_pipeline.json", {
        "rfqs":          rfqs,
        "total":         len(rfqs),
        "responded":     len(responded),
        "drafted":       len(drafted),
        "pipeline_value":sum(r.get("est_value_usd",0) for r in rfqs),
        "rfq_send_date": "2026-05-25",
        "days_out":      days_out,
        "last_updated":  datetime.utcnow().isoformat(),
    })

    # 4. Supplier network
    suppliers_by_tier = {"Tier 1": 28, "Tier 2": 31, "Tier 3": 14}
    write_json("supplier_network.json", {
        "total_suppliers":   73,
        "by_tier":           suppliers_by_tier,
        "strategic_tier1":   28,
        "preferred_suppliers": [
            {"name":"Baker Hughes","category":"VIB_MON","status":"RESPONDED","alert":""},
            {"name":"Emerson","category":"FUEL_GAS","status":"DRAFTED","alert":""},
            {"name":"Donaldson","category":"INLET_AIR","status":"DRAFTED","alert":""},
            {"name":"Donaldson","category":"CONTROLS_DCS","status":"DRAFTED","alert":""},
            {"name":"Flowserve","category":"PIPING_VALVES","status":"PENDING","alert":"Replace Trillium AVOID"},
            {"name":"ABB Power","category":"TRANSFORMER","status":"PENDING","alert":"Critical path — issue RFQ May 25"},
            {"name":"GE Vernova","category":"GENERATOR","status":"PENDING","alert":"Highest $ item"},
        ],
        "avoid_suppliers":   [{"name":"Trillium Flow Technologies","reason":"Revenue too small for single-source risk"}],
        "last_updated":      datetime.utcnow().isoformat(),
    })

    # 5. Contact stats
    write_json("contact_stats.json", {
        "total":     231,
        "verified":  64,
        "by_priority": {"ACTIVE_RFQ": 2, "TIER1": 12, "NORMAL": 217},
        "verification_rate": 27.7,
        "top_contacts": [
            {"name":"Lorenzo Simonelli","company":"Baker Hughes","status":"RESPONDED"},
            {"name":"Bob Yeager","company":"Emerson","status":"DRAFTED"},
            {"name":"Tod Carpenter","company":"Donaldson","status":"DRAFTED"},
            {"name":"Alberto Malandra","company":"EthosEnergy","status":"ICD_PENDING"},
        ],
        "last_updated": datetime.utcnow().isoformat(),
    })

    # 6. KPI band — top signal for ExecSignalBand
    bh_quote  = next((r for r in rfqs if r.get("company","").startswith("Baker")), {})
    alert     = "TRILLIUM AVOID — Piping & Valves $507K — select Flowserve before RFQ"
    primary   = f"Baker Hughes VIB_MON — ${bh_quote.get('quoted_price',340000):,.0f} quoted — +26.7% vs estimate"

    write_json("kpi_band.json", {
        "primary_signal":   primary,
        "primary_action":   "Accept quote or negotiate — decision needed before May 1",
        "critical_alert":   alert,
        "days_to_rfq":      days_out,
        "rfq_date":         "May 25, 2026",
        "total_bop":        f"${total_mid:,.0f}",
        "pipeline_value":   "$3.28M",
        "categories_verified": f"{len(verified)}/19",
        "last_updated":     datetime.utcnow().isoformat(),
    })

    print(f"Dashboard data generated → {OUT_DIR}")


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--watch", action="store_true", help="Regenerate every 5 minutes")
    args = p.parse_args()

    generate()
    if args.watch:
        print("Watch mode — refreshing every 5 minutes. Ctrl+C to stop.")
        while True:
            time.sleep(300)
            generate()


if __name__ == "__main__":
    main()
