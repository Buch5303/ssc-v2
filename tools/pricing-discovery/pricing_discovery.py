#!/usr/bin/env python3
"""
FlowSeer / SSC V2 — W251 BOP Pricing Discovery Engine
Directive 53.1 — Four-Vector Reverse Engineering Pricing Intelligence

Vectors:
  1: Component BOM build-up (always runs — internal, no API)
  2: Analogous machine cross-reference (internal calc — no API)
  3: Public utility records (FERC/EIA/USASpending)
  4: Supplier catalogs + trade press (Google CSE)
  Synthesis: Perplexity (key-gated, LAST — never first-pass)

Outputs:
  pricing_updated.csv
  pricing_summary.md
  pricing_summary.json
  pricing_contradictions.csv
  pricing_normalization_trace.csv
  pricing_procurement_strategy.csv
  pricing_learning_deltas.csv  (only when --rfq-truths provided)

Usage:
    python pricing_discovery.py
    python pricing_discovery.py --dry-run
    python pricing_discovery.py --categories VIB_MON INLET_AIR
    python pricing_discovery.py --rfq-truths rfq_responses.json
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from models import (
    PricingEvidence, PricingResult,
    VECTOR_BOM, VECTOR_ANALOGOUS, VECTOR_UTILITY, VECTOR_TRADE, VECTOR_SYNTHESIS,
    CONF_COMPONENT_BUILDUPS, CONF_BUDGETARY, CONFIDENCE_SCORES,
)
from bom_library import BOM_LIBRARY, get_category_bom, get_all_categories, get_bom_total
from comparable_machines import COMPARABLE_MACHINES, get_all_machine_ids, get_bop_benchmark_from_kw
from scoring import aggregate_price_estimate, compute_delta as compute_score_delta
from rate_limits import GuardRegistry
from contradiction_detector import run_all_detectors
from normalization_trace import build_traces_for_category
from procurement_strategy import build_all_strategies
from learning_engine import compute_all_deltas
from outputs import (
    write_pricing_csv, write_pricing_summary_md, write_run_summary_json,
    write_contradictions_csv, write_normalization_trace_csv,
    write_procurement_strategy_csv, write_learning_deltas_csv, now_iso,
)
from providers.common import make_session, now_iso as pnow
from providers import sam_gov, ferc, supplier_catalogs, trade_press as tp
from providers import perplexity as perp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("pricing")
LOG_FILE = "pricing_discovery_log.jsonl"


def log_event(event: Dict[str, Any]) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")


def read_contacts(path: str) -> List[Dict[str, str]]:
    import csv
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def discover_category(
    category_code: str,
    session: Any,
    guards: GuardRegistry,
    dry_run: bool,
    prior_mid: float = 0.0,
) -> PricingResult:
    cat_def   = BOM_LIBRARY.get(category_code, {})
    cat_name  = cat_def.get("name", category_code)
    suppliers = cat_def.get("suppliers", [])
    search_terms = cat_def.get("search_terms", [])

    all_evidence: List[PricingEvidence] = []
    timestamp = now_iso()

    # ── Vector 1: BOM build-up (always runs — no external API) ───────────────
    bom_items = get_category_bom(category_code)
    bom_low, bom_mid, bom_high = get_bom_total(category_code)

    if bom_mid > 0:
        all_evidence.append(PricingEvidence(
            vector=VECTOR_BOM,
            provider="BOM_LIBRARY",
            source_name=f"W251 BOM decomposition — {cat_name}",
            raw_value_usd=bom_mid,
            normalized_value_usd=bom_mid,
            year_of_data=2024,
            confidence_label=CONF_COMPONENT_BUILDUPS,
            confidence_score=CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS],
            snippet=f"{len(bom_items)} components | Low: ${bom_low:,.0f} | Mid: ${bom_mid:,.0f} | High: ${bom_high:,.0f}",
            timestamp=timestamp,
            notes="Bottom-up BOM with integration factor",
        ))

    # ── Vector 2: Analogous machine cross-reference ───────────────────────────
    # NOTE: Analogous machine benchmarks are program-level BOP totals,
    # not per-category prices. They are used for program-level validation
    # (stored in the result's analogous_refs) but NOT injected into
    # per-category evidence scoring to avoid inflating individual estimates.
    analogous_refs = []
    for machine_id in get_all_machine_ids():
        low_m, mid_m, high_m, note = get_bop_benchmark_from_kw(machine_id, target_mw=50.0)
        if mid_m > 0:
            machine = COMPARABLE_MACHINES[machine_id]
            analogous_refs.append(f"{machine['name']}: ${mid_m:,.0f} BOP mid")

    # ── Vectors 3 + 4: External sources (skipped in dry-run) ─────────────────
    if not dry_run:
        # Vector 3a: USASpending federal contracts
        keywords = sam_gov.build_bop_keywords(cat_name, suppliers)
        items = guards.guard("usaspending").call(
            sam_gov.search_usaspending, session, keywords, cat_name) or []
        all_evidence.extend(items)

        # Vector 3b: FERC Form 1 benchmarks
        items = guards.guard("ferc_form1").call(
            ferc.ferc_form1_search, session, ["GE_6B", "GE_7EA", "W251_SELF"], cat_name) or []
        all_evidence.extend(items)

        # Vector 3c: EIA Form 860
        items = guards.guard("eia_form860").call(
            ferc.eia_form860_benchmark, session, cat_name, 50.0) or []
        all_evidence.extend(items)

        # Vector 4a: Supplier catalogs (Google CSE)
        if search_terms:
            items = guards.guard("google_catalog").call(
                supplier_catalogs.google_catalog_search,
                session, search_terms[:4], cat_name, suppliers) or []
            all_evidence.extend(items)

        # Vector 4b: Trade press (Google CSE — trade domains only)
        items = guards.guard("trade_press").call(
            tp.trade_press_search, session, cat_name, search_terms[:3], suppliers) or []
        all_evidence.extend(items)

    # ── Score free sources before synthesis ───────────────────────────────────
    low, mid, high, conf_label, conf_score = aggregate_price_estimate(all_evidence, bom_mid)

    # ── Perplexity synthesis — LAST, only if confidence still low ─────────────
    # Explicitly NOT first-pass. Only fires if free sources unresolved.
    if not dry_run and perp.perplexity_available():
        current_best = max((e.confidence_score for e in all_evidence), default=0)
        if current_best < 65:
            bom_desc = "; ".join(f"{item.component} (${item.mid_usd:,.0f})" for item in bom_items[:5])
            items = guards.guard("perplexity").call(
                perp.perplexity_price_synthesis, session, cat_name, bom_desc, suppliers) or []
            all_evidence.extend(items)
            # Re-score with synthesis evidence
            low, mid, high, conf_label, conf_score = aggregate_price_estimate(all_evidence, bom_mid)

    # ── Final range ───────────────────────────────────────────────────────────
    low, mid, high, conf_label, conf_score = aggregate_price_estimate(all_evidence, bom_mid)
    delta = compute_score_delta(mid, prior_mid)

    primary_vector = ""
    if all_evidence:
        best = max(all_evidence, key=lambda e: e.confidence_score)
        primary_vector = best.vector

    return PricingResult(
        category=cat_name,
        category_code=category_code,
        low_usd=low, mid_usd=mid, high_usd=high,
        confidence_label=conf_label, confidence_score=conf_score,
        primary_vector=primary_vector,
        evidence_count=len(all_evidence),
        evidence_items=all_evidence,
        bom_items=bom_items, bom_total_mid=bom_mid,
        analogous_refs=analogous_refs,
        data_year=2024, cost_index="ENR CCI 2024",
        prior_mid_usd=prior_mid, delta_pct=delta,
        last_updated=timestamp,
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FlowSeer W251 BOP Pricing Discovery Engine")
    p.add_argument("--categories",  nargs="+", help="Category codes to run (default: all 19)")
    p.add_argument("--output-dir",  default=".", help="Output directory")
    p.add_argument("--limit",       type=int,   help="Max categories to process")
    p.add_argument("--dry-run",     action="store_true", help="BOM+analogous only — no external API")
    p.add_argument("--rfq-truths",  help="JSON file with RFQ truth prices {cat_code: {price, supplier, date}}")
    return p.parse_args()


def main() -> None:
    args      = parse_args()
    out       = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    timestamp = now_iso()

    categories = [c.upper() for c in args.categories if c.upper() in BOM_LIBRARY] if args.categories else get_all_categories()
    if args.limit:
        categories = categories[:args.limit]

    rfq_truths: Dict[str, dict] = {}
    if args.rfq_truths and Path(args.rfq_truths).exists():
        with open(args.rfq_truths) as f:
            rfq_truths = json.load(f)

    guards  = GuardRegistry(dry_run=args.dry_run)
    session = make_session()

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}FlowSeer Pricing Discovery — {len(categories)} categories")

    results:         List[PricingResult]  = []
    all_contradictions: List[dict]        = []
    all_traces:      List[dict]           = []
    warnings:        List[str]            = []

    for idx, code in enumerate(categories, 1):
        cat_name = BOM_LIBRARY.get(code, {}).get("name", code)
        print(f"[{idx:2}/{len(categories)}] {cat_name}...", end=" ", flush=True)

        try:
            result = discover_category(code, session, guards, args.dry_run)
            results.append(result)

            # Run contradiction detection
            contradictions = run_all_detectors(code, cat_name, result.evidence_items, timestamp)
            all_contradictions.extend([c.to_dict() for c in contradictions])

            # Build normalization traces
            traces = build_traces_for_category(code, cat_name, result.evidence_items)
            all_traces.extend([t.to_dict() for t in traces])

            log_event({
                "ts": timestamp, "code": code, "category": cat_name,
                "mid_usd": result.mid_usd, "confidence": result.confidence_label,
                "evidence_count": result.evidence_count,
                "contradictions": len(contradictions),
            })

            icon = {"RFQ_VERIFIED":"✓✓","SUPPLIER_CATALOG":"✓","FERC_RATE_CASE":"~✓",
                    "EIA_BENCHMARK":"~","COMPONENT_BUILDUPS":"○","BUDGETARY_ESTIMATE":"?"}.get(result.confidence_label, "?")
            contra_flag = f" ⚠{len(contradictions)}" if contradictions else ""
            print(f"${result.mid_usd:,.0f} [{icon} {result.confidence_label}] — {result.evidence_count} sources{contra_flag}")

        except Exception as e:
            msg = f"Error on {cat_name}: {e}"
            warnings.append(msg)
            log.error(msg)
            print(f"ERROR: {e}")

    # Build procurement strategies
    strategies = build_all_strategies(results, timestamp)

    # Compute learning deltas if RFQ truths provided
    deltas: List[dict] = []
    if rfq_truths:
        delta_objs = compute_all_deltas(results, rfq_truths, timestamp)
        deltas = [d.to_dict() for d in delta_objs]

    total_mid = sum(r.mid_usd for r in results)
    print(f"\n{'─'*60}")
    print(f"TOTAL BOP MID ESTIMATE: ${total_mid:,.0f}")
    if all_contradictions:
        high_c = sum(1 for c in all_contradictions if c.get("severity") == "HIGH")
        print(f"CONTRADICTIONS: {len(all_contradictions)} total ({high_c} HIGH severity) — see pricing_contradictions.csv")
    print(f"{'─'*60}")

    # Write all artifacts
    paths = {
        "pricing_csv":        str(out / "pricing_updated.csv"),
        "summary_md":         str(out / "pricing_summary.md"),
        "summary_json":       str(out / "pricing_summary.json"),
        "contradictions_csv": str(out / "pricing_contradictions.csv"),
        "trace_csv":          str(out / "pricing_normalization_trace.csv"),
        "strategy_csv":       str(out / "pricing_procurement_strategy.csv"),
        "deltas_csv":         str(out / "pricing_learning_deltas.csv"),
    }
    print()

    result_dicts = [r.to_flat_dict() for r in results]
    strategy_dicts = [s.to_dict() for s in strategies]

    write_pricing_csv(paths["pricing_csv"], result_dicts)
    write_pricing_summary_md(paths["summary_md"], result_dicts,
                              dry_run=args.dry_run,
                              contradictions=all_contradictions,
                              strategies=strategy_dicts)
    write_run_summary_json(paths["summary_json"], result_dicts, guards.all_stats(),
                           dry_run=args.dry_run, warnings=warnings,
                           contradictions=all_contradictions, output_paths=paths)
    write_contradictions_csv(paths["contradictions_csv"], all_contradictions, dry_run=args.dry_run)
    write_normalization_trace_csv(paths["trace_csv"], all_traces, dry_run=args.dry_run)
    write_procurement_strategy_csv(paths["strategy_csv"], strategy_dicts, dry_run=args.dry_run)
    if deltas:
        write_learning_deltas_csv(paths["deltas_csv"], deltas, dry_run=args.dry_run)

    print(f"Log: {LOG_FILE}")


if __name__ == "__main__":
    main()
