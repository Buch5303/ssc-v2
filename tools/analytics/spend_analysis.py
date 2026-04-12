#!/usr/bin/env python3
"""
tools/analytics/spend_analysis.py
W251 BOP spend analysis and procurement intelligence.
Analyzes spend concentration, supplier risk, and optimization opportunities.

Usage:
  python3 spend_analysis.py
  python3 spend_analysis.py --output spend_report.md
"""
from __future__ import annotations
import argparse, csv, json
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent


def load_pricing():
    p = ROOT / "pricing-discovery/outputs/bop_cost_model.csv"
    if not p.exists():
        p = ROOT / "pricing-discovery/outputs/pricing_updated.csv"
    if not p.exists():
        return []
    with open(p) as f:
        return [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]


def load_suppliers():
    p = ROOT / "supplier-intelligence/supplier_profiles.md"
    return p.read_text() if p.exists() else ""


def analyze(rows):
    total = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in rows)

    # Spend by tier
    by_tier = {}
    for r in rows:
        tier = r.get("spend_tier", "UNKNOWN")
        by_tier[tier] = by_tier.get(tier, 0) + float(r.get("mid_usd") or r.get("bom_mid", 0))

    # Top 5 categories
    sorted_rows = sorted(rows, key=lambda r: float(r.get("mid_usd") or r.get("bom_mid", 0)), reverse=True)

    # Supplier concentration
    suppliers = {}
    for r in rows:
        sup = r.get("preferred_supplier", "Unknown")
        if sup:
            mid = float(r.get("mid_usd") or r.get("bom_mid", 0))
            suppliers[sup] = suppliers.get(sup, 0) + mid

    top_sup = sorted(suppliers.items(), key=lambda x: -x[1])

    # Single source risk
    avoid_cats = [r for r in rows if r.get("avoid_supplier")]

    return {
        "total": total,
        "by_tier": by_tier,
        "top_5": sorted_rows[:5],
        "supplier_concentration": top_sup[:5],
        "single_source_risk": len([r for r in rows if r.get("preferred_supplier") and
                                   not r.get("avoid_supplier")]),
        "avoid_flags": avoid_cats,
    }


def generate_report(analysis, rows):
    total = analysis["total"]
    now   = datetime.now().strftime("%B %d, %Y")

    lines = [
        f"# W251 BOP Spend Analysis Report",
        f"**Generated:** {now}  |  **Program:** Project Jupiter 50MW W251B8",
        f"",
        f"## Total BOP Spend: ${total:,.0f}",
        f"",
        f"## Spend by Tier",
        f"",
        f"| Tier | Value | % of Total |",
        f"|------|-------|-----------|",
    ]
    for tier, val in sorted(analysis["by_tier"].items()):
        pct = val / total * 100
        lines.append(f"| {tier} | ${val:,.0f} | {pct:.1f}% |")

    lines += [
        f"",
        f"## Top 5 Categories (Pareto Analysis)",
        f"",
        f"| Rank | Category | Value | % of BOP | Tier |",
        f"|------|----------|-------|---------|------|",
    ]
    cumulative = 0
    for i, r in enumerate(analysis["top_5"], 1):
        val = float(r.get("mid_usd") or r.get("bom_mid", 0))
        cumulative += val
        pct = val / total * 100
        lines.append(f"| {i} | {r.get('category','')[:35]} | ${val:,.0f} | {pct:.1f}% | {r.get('spend_tier','')} |")

    cum_pct = cumulative / total * 100
    lines += [
        f"",
        f"**Top 5 categories = ${cumulative:,.0f} ({cum_pct:.1f}% of total BOP)**",
        f"",
        f"## Supplier Concentration Risk",
        f"",
        f"| Rank | Supplier | Total Exposure | % of BOP |",
        f"|------|---------|---------------|---------|",
    ]
    for i, (sup, val) in enumerate(analysis["supplier_concentration"], 1):
        pct = val / total * 100
        lines.append(f"| {i} | {sup} | ${val:,.0f} | {pct:.1f}% |")

    lines += [
        f"",
        f"## Risk Flags",
        f"",
    ]
    if analysis["avoid_flags"]:
        lines.append(f"### ⛔ Avoid Flags ({len(analysis['avoid_flags'])} categories)")
        for r in analysis["avoid_flags"]:
            val = float(r.get("mid_usd") or r.get("bom_mid", 0))
            lines.append(f"- **{r.get('category','')}** (${val:,.0f}) — Avoid: {r.get('avoid_supplier','')}")

    lines += [
        f"",
        f"## Optimization Opportunities",
        f"",
        f"1. **Donaldson bundle** — Inlet Air + Controls/DCS from same supplier (~$1.03M). "
        f"   Bundle RFQs for volume discount potential.",
        f"2. **Baker Hughes package** — VIB_MON responded + Exhaust drafted. "
        f"   Combined value $771K — negotiate package pricing.",
        f"3. **Generator competitive bid** — GE vs Siemens Energy on $2.09M item. "
        f"   Must compete, not single-source.",
        f"4. **Transformer early award** — 52-70 wk lead. Award early for schedule certainty.",
        f"5. **Trillium replacement** — Flowserve on Piping & Valves ($507K). "
        f"   Issue RFQ May 25 alongside others.",
        f"",
        f"---",
        f"*FlowSeer Spend Analytics | Project Jupiter W251B8*",
    ]
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="")
    args = p.parse_args()

    rows     = load_pricing()
    analysis = analyze(rows)
    report   = generate_report(analysis, rows)

    print(report)

    out = args.output or ROOT / "analytics/spend_analysis_report.md"
    Path(out).parent.mkdir(exist_ok=True)
    Path(out).write_text(report)
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
