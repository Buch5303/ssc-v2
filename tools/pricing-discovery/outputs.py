"""
outputs.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — All output artifact writers.

Artifacts:
  pricing_updated.csv
  pricing_summary.md
  pricing_summary.json
  pricing_contradictions.csv
  pricing_normalization_trace.csv
  pricing_procurement_strategy.csv
  pricing_learning_deltas.csv  (only when RFQ truth exists)
"""
from __future__ import annotations
import csv, json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

def now_iso(): return datetime.now(timezone.utc).isoformat()

def _write_csv(path: str, rows: List[dict], fieldnames: Optional[List[str]] = None) -> None:
    if not rows: return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fields = fieldnames or list(rows[0].keys())
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

def write_pricing_csv(path: str, results: List[dict]) -> None:
    _write_csv(path, results)
    print(f"Pricing CSV: {path} ({len(results)} categories)")

def write_contradictions_csv(path: str, contradictions: List[dict], dry_run: bool = False) -> None:
    label = "[DRY-RUN] " if dry_run else ""
    if not contradictions:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("category_code,contradiction_type,severity,description\n")
        print(f"{label}Contradictions CSV: {path} (0 contradictions — all sources consistent)")
        return
    _write_csv(path, contradictions)
    high = sum(1 for c in contradictions if c.get("severity") == "HIGH")
    print(f"{label}Contradictions CSV: {path} ({len(contradictions)} contradictions, {high} HIGH severity)")

def write_normalization_trace_csv(path: str, traces: List[dict], dry_run: bool = False) -> None:
    label = "[DRY-RUN] " if dry_run else ""
    _write_csv(path, traces)
    print(f"{label}Normalization trace CSV: {path} ({len(traces)} evidence items traced)")

def write_procurement_strategy_csv(path: str, strategies: List[dict], dry_run: bool = False) -> None:
    label = "[DRY-RUN] " if dry_run else ""
    _write_csv(path, strategies)
    strategic = sum(1 for s in strategies if s.get("spend_tier") == "STRATEGIC")
    print(f"{label}Procurement strategy CSV: {path} ({len(strategies)} categories, {strategic} STRATEGIC tier)")

def write_learning_deltas_csv(path: str, deltas: List[dict], dry_run: bool = False) -> None:
    if not deltas: return
    label = "[DRY-RUN] " if dry_run else ""
    _write_csv(path, deltas)
    print(f"{label}Learning deltas CSV: {path} ({len(deltas)} RFQ truth comparisons)")

def write_pricing_summary_md(path: str, results: List[dict], dry_run: bool = False,
                              contradictions: Optional[List[dict]] = None,
                              strategies: Optional[List[dict]] = None) -> None:
    label = "[DRY-RUN] " if dry_run else ""
    total_low  = sum(float(r.get("low_usd",  0)) for r in results)
    total_mid  = sum(float(r.get("mid_usd",  0)) for r in results)
    total_high = sum(float(r.get("high_usd", 0)) for r in results)

    lines = [
        f"# {label}FlowSeer W251 BOP Pricing Discovery Report",
        f"**Generated:** {now_iso()}",
        "",
        "## Program Budget Range",
        "| Scenario | Amount |",
        "|----------|--------|",
        f"| Floor    | ${total_low:,.0f} |",
        f"| **Mid**  | **${total_mid:,.0f}** |",
        f"| Ceiling  | ${total_high:,.0f} |",
        "",
    ]

    # Contradictions summary
    if contradictions:
        high_c  = [c for c in contradictions if c.get("severity") == "HIGH"]
        lines += [
            f"## ⚠ Contradictions Detected ({len(contradictions)} total, {len(high_c)} HIGH)",
            "| Category | Type | Severity | Description |",
            "|----------|------|----------|-------------|",
        ]
        for c in contradictions[:5]:
            lines.append(
                f"| {c.get('category_name','')[:25]} | {c.get('contradiction_type','')} | "
                f"{c.get('severity','')} | {c.get('description','')[:60]}... |"
            )
        lines.append("")

    # Procurement priorities
    if strategies:
        strategic = [s for s in strategies if s.get("spend_tier") == "STRATEGIC"]
        if strategic:
            lines += [
                "## Strategic Procurement Priorities",
                "| Category | Estimate | Readiness | Next Action |",
                "|----------|----------|-----------|-------------|",
            ]
            for s in strategic:
                lines.append(
                    f"| {s.get('category_name','')[:30]} | ${float(s.get('mid_estimate_usd',0)):,.0f} | "
                    f"{s.get('rfq_readiness','')} | {s.get('next_action','')[:50]}... |"
                )
            lines.append("")

    # Category detail
    lines += [
        "## Category Detail",
        "| Category | Low | Mid | High | Confidence | Evidence |",
        "|----------|-----|-----|------|------------|----------|",
    ]
    for r in sorted(results, key=lambda x: -float(x.get("mid_usd", 0))):
        lines.append(
            f"| {r.get('category','')[:30]} | ${float(r.get('low_usd',0)):,.0f} | "
            f"**${float(r.get('mid_usd',0)):,.0f}** | ${float(r.get('high_usd',0)):,.0f} | "
            f"{r.get('confidence_label','')[:22]} | {r.get('evidence_count',0)} sources |"
        )

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{label}Pricing summary MD: {path}")

def write_run_summary_json(path: str, results: List[dict], provider_stats: dict,
                            dry_run: bool, warnings: List[str] = None,
                            contradictions: Optional[List[dict]] = None,
                            output_paths: Optional[Dict[str, str]] = None) -> dict:
    summary = {
        "run_timestamp":    now_iso(),
        "dry_run":          dry_run,
        "total_categories": len(results),
        "total_bop_low":    sum(float(r.get("low_usd",  0)) for r in results),
        "total_bop_mid":    sum(float(r.get("mid_usd",  0)) for r in results),
        "total_bop_high":   sum(float(r.get("high_usd", 0)) for r in results),
        "confidence_distribution": {},
        "contradictions_total": len(contradictions or []),
        "contradictions_high": sum(1 for c in (contradictions or []) if c.get("severity") == "HIGH"),
        "synthesis_is_first_pass": False,   # always False — synthesis is last resort
        "providers": {n: vars(s) for n, s in provider_stats.items()},
        "output_paths": output_paths or {},
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
