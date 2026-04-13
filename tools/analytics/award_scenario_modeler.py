#!/usr/bin/env python3
"""
tools/analytics/award_scenario_modeler.py
Models different award scenarios to optimize total BOP cost.
"""
from __future__ import annotations
import argparse, csv, json
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent

SCENARIOS = {
    "base":         {"name": "Base Case — BOM Estimates",          "adj": {},                                          "desc": "All categories at BOM mid estimate."},
    "conservative": {"name": "Conservative — Historical Overrun",  "adj": {"GENERATOR":1.18,"TRANSFORMER":1.15,"EMISSIONS":1.12,"VIB_MON":1.267,"ELEC_DIST":1.08,"PIPING_VALVES":1.10,"CONTROLS_DCS":1.08}, "desc": "Historical overrun factors + BH confirmed."},
    "optimistic":   {"name": "Optimistic — Competitive Pressure",  "adj": {"GENERATOR":0.96,"TRANSFORMER":0.98,"EMISSIONS":0.94,"FUEL_GAS":0.97,"INLET_AIR":0.93,"VIB_MON":1.267},                          "desc": "Competitive bidding + confirmed BH."},
    "aggressive":   {"name": "Aggressive — Best Negotiated",       "adj": {"GENERATOR":0.92,"TRANSFORMER":0.90,"EMISSIONS":0.88,"FUEL_GAS":0.95,"INLET_AIR":0.90,"PIPING_VALVES":0.93,"VIB_MON":1.20},      "desc": "Successful negotiation across major categories."},
}


def load_pricing():
    for fname in ["bop_cost_model.csv", "pricing_updated.csv"]:
        p = ROOT / f"pricing-discovery/outputs/{fname}"
        if p.exists():
            with open(p) as f:
                return [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]
    return []


def model_scenario(rows, sk):
    adj = SCENARIOS[sk]["adj"]
    total, results = 0, []
    for r in rows:
        code = r.get("category_code", "")
        mid  = float(r.get("mid_usd") or r.get("bom_mid", 0))
        f    = adj.get(code, 1.0)
        val  = mid * f
        total += val
        results.append({"category": r.get("category",""), "code": code,
                        "bom_mid": mid, "adjusted": round(val), "delta_pct": round((f-1)*100, 1)})
    return results, round(total)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", default="all")
    args = p.parse_args()

    rows = load_pricing()
    if not rows:
        print("No pricing data found")
        return

    baseline = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in rows)
    to_run   = list(SCENARIOS.keys()) if args.scenario == "all" else [args.scenario]

    print("\n" + "="*70)
    print("FlowSeer Award Scenario Modeler — Project Jupiter W251B8")
    print("="*70)
    print(f"BOM Baseline: ${baseline:,.0f}\n")

    all_results = {}
    for sk in to_run:
        results, total = model_scenario(rows, sk)
        all_results[sk] = {"results": results, "total": total}
        delta = total - baseline
        pct   = delta / baseline * 100
        print(f"  {SCENARIOS[sk]['name']}")
        print(f"  Total: ${total:,.0f}  ({delta:+,.0f}, {pct:+.1f}% vs baseline)")
        print(f"  {SCENARIOS[sk]['desc']}\n")

    print(f"\n{'SCENARIO':<32} {'TOTAL':>12} {'vs BASE':>10}  RISK")
    print("-"*62)
    for sk, data in all_results.items():
        t   = data["total"]
        pct = (t - baseline) / baseline * 100
        r   = "🟢" if pct < 0 else ("🟡" if pct < 10 else "🔴")
        print(f"  {SCENARIOS[sk]['name']:<30} ${t:>10,.0f} {pct:>+8.1f}%  {r}")
    print("="*70)

    out = ROOT / "analytics/award_scenarios.json"
    out.write_text(json.dumps({"baseline": baseline,
        "scenarios": {k: {"total": v["total"], "name": SCENARIOS[k]["name"]} for k,v in all_results.items()},
        "generated": datetime.now().isoformat()}, indent=2))
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
