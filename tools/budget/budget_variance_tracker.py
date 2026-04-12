#!/usr/bin/env python3
"""
tools/budget/budget_variance_tracker.py
Tracks actual vs. estimated costs as RFQ responses arrive.
Produces variance analysis and budget health report.

Usage:
  python3 budget_variance_tracker.py
  python3 budget_variance_tracker.py --update VIB_MON 340000
"""
from __future__ import annotations
import argparse, csv, json
from pathlib import Path
from datetime import datetime

ROOT      = Path(__file__).parent.parent
PRICE_CSV = ROOT / "pricing-discovery/outputs/pricing_updated.csv"
BOP_CSV   = ROOT / "pricing-discovery/outputs/bop_cost_model.csv"
OUT_DIR   = Path(__file__).parent / "outputs"
OUT_DIR.mkdir(exist_ok=True)


def load_pricing():
    for f in [PRICE_CSV, BOP_CSV]:
        if f.exists():
            with open(f) as fp:
                rows = list(csv.DictReader(fp))
                return [r for r in rows if r.get("category") != "TOTAL"]
    return []


def compute_variance(rows):
    results = []
    total_est = total_actual = total_variance = 0

    for r in rows:
        est    = float(r.get("mid_usd") or r.get("bom_mid") or 0)
        actual = float(r.get("rfq_quoted") or 0)
        var    = actual - est if actual else 0
        var_pct= var / est * 100 if est and actual else 0

        total_est      += est
        total_actual   += actual if actual else est
        total_variance += var

        results.append({
            "category":      r.get("category",""),
            "category_code": r.get("category_code",""),
            "spend_tier":    r.get("spend_tier",""),
            "estimated":     round(est),
            "actual":        round(actual) if actual else None,
            "variance_usd":  round(var) if actual else None,
            "variance_pct":  round(var_pct,1) if actual else None,
            "status":        "VERIFIED" if actual else "ESTIMATED",
            "health":        "🟢" if abs(var_pct) < 10 else ("🟡" if abs(var_pct) < 25 else "🔴") if actual else "⚪",
        })

    summary = {
        "total_estimated":  round(total_est),
        "total_actual":     round(total_actual),
        "total_variance":   round(total_variance),
        "variance_pct":     round(total_variance / total_est * 100, 1) if total_est else 0,
        "verified_count":   sum(1 for r in results if r["status"] == "VERIFIED"),
        "estimated_count":  sum(1 for r in results if r["status"] == "ESTIMATED"),
    }
    return results, summary


def generate_report(rows, summary):
    lines = [
        f"# W251 BOP Budget Variance Report",
        f"**Generated:** {datetime.now().strftime('%B %d, %Y %H:%M')}",
        f"",
        f"## Budget Health Summary",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Total Estimated | ${summary['total_estimated']:,.0f} |",
        f"| Total Actual (verified) | ${summary['total_actual']:,.0f} |",
        f"| Total Variance | ${summary['total_variance']:+,.0f} |",
        f"| Variance % | {summary['variance_pct']:+.1f}% |",
        f"| Categories Verified | {summary['verified_count']} / {summary['verified_count'] + summary['estimated_count']} |",
        f"",
        f"## Category Breakdown",
        f"",
        f"| # | Category | Estimated | Actual | Variance | Health |",
        f"|---|----------|-----------|--------|----------|--------|",
    ]
    for i, r in enumerate(sorted(rows, key=lambda x: -(x["estimated"])), 1):
        actual  = f"${r['actual']:,.0f}" if r["actual"] else "—"
        var     = f"${r['variance_usd']:+,.0f} ({r['variance_pct']:+.1f}%)" if r["variance_usd"] is not None else "—"
        lines.append(f"| {i} | {r['category'][:32]} | ${r['estimated']:,.0f} | {actual} | {var} | {r['health']} |")

    lines += ["", "---", "*FlowSeer Budget Tracker | Project Jupiter W251B8*"]
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--update", nargs=2, metavar=("CATEGORY_CODE","QUOTED_PRICE"),
                   help="Update a category with actual price")
    args = p.parse_args()

    if args.update:
        code, price = args.update[0], float(args.update[1])
        rows = load_pricing()
        updated = False
        for r in rows:
            if r.get("category_code") == code:
                r["rfq_quoted"] = str(price)
                r["confidence_label"] = "RFQ_VERIFIED"
                updated = True
                break
        if updated:
            print(f"Updated {code} with actual price ${price:,.0f}")
        else:
            print(f"Category {code} not found")
        return

    rows = load_pricing()
    if not rows:
        print("No pricing data found")
        return

    results, summary = compute_variance(rows)
    report = generate_report(results, summary)

    out = OUT_DIR / "budget_variance_report.md"
    out.write_text(report)

    out_json = OUT_DIR / "budget_variance.json"
    out_json.write_text(__import__("json").dumps({"summary": summary, "categories": results}, indent=2, default=str))

    print(report)
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
