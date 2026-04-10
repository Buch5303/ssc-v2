"""
outputs.py — FlowSeer Pricing Discovery Engine
Writes pricing_updated.csv, pricing_summary.md, run_summary.json
"""
from __future__ import annotations
import csv, json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

def now_iso(): return datetime.now(timezone.utc).isoformat()

def write_pricing_csv(path: str, results: List[dict]) -> None:
    if not results: return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()), extrasaction="ignore")
        writer.writeheader(); writer.writerows(results)
    print(f"Pricing CSV: {path} ({len(results)} categories)")

def write_pricing_summary_md(path: str, results: List[dict], dry_run: bool = False) -> None:
    label = "[DRY-RUN] " if dry_run else ""
    total_low = sum(float(r.get("low_usd", 0)) for r in results)
    total_mid = sum(float(r.get("mid_usd", 0)) for r in results)
    total_high = sum(float(r.get("high_usd", 0)) for r in results)

    lines = [
        f"# {label}FlowSeer W251 BOP Pricing Discovery Report",
        f"**Generated:** {now_iso()}",
        "",
        "## Program Budget Range",
        f"| Scenario | Amount |",
        f"|----------|--------|",
        f"| Floor    | ${total_low:,.0f} |",
        f"| **Mid**  | **${total_mid:,.0f}** |",
        f"| Ceiling  | ${total_high:,.0f} |",
        "",
        "## Category Detail",
        "| Category | Low | Mid | High | Confidence | Evidence |",
        "|----------|-----|-----|------|------------|----------|",
    ]
    for r in sorted(results, key=lambda x: -float(x.get("mid_usd", 0))):
        lines.append(
            f"| {r.get('category','')[:30]} | ${float(r.get('low_usd',0)):,.0f} | "
            f"**${float(r.get('mid_usd',0)):,.0f}** | ${float(r.get('high_usd',0)):,.0f} | "
            f"{r.get('confidence_label','')[:20]} | {r.get('evidence_count',0)} sources |"
        )
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{label}Pricing summary MD: {path}")

def write_run_summary_json(path: str, results: List[dict], provider_stats: dict,
                            dry_run: bool, warnings: List[str] = None) -> dict:
    summary = {
        "run_timestamp": now_iso(), "dry_run": dry_run,
        "total_categories": len(results),
        "total_bop_low": sum(float(r.get("low_usd", 0)) for r in results),
        "total_bop_mid": sum(float(r.get("mid_usd", 0)) for r in results),
        "total_bop_high": sum(float(r.get("high_usd", 0)) for r in results),
        "confidence_distribution": {},
        "providers": {n: vars(s) for n, s in provider_stats.items()},
        "warnings": warnings or [],
    }
    for r in results:
        cl = r.get("confidence_label", "UNKNOWN")
        summary["confidence_distribution"][cl] = summary["confidence_distribution"].get(cl, 0) + 1

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"Run summary JSON: {path}")
    return summary
