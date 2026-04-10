#!/usr/bin/env python3
"""
FlowSeer / SSC V2 — W251 BOP Pricing Discovery Engine
Directive 53 — Four-Vector Reverse Engineering Pricing Intelligence

Four discovery vectors per category:
  Vector 1: Component BOM build-up (bottom-up, always runs)
  Vector 2: Analogous machine cross-reference (MW-normalized)
  Vector 3: Public utility records (FERC Form 1, EIA Form 860, USASpending)
  Vector 4: Supplier catalogs + trade press (Google CSE)
  Synthesis: Perplexity (key-gated, last resort)

Usage:
    pip install requests python-dotenv
    python pricing_discovery.py
    python pricing_discovery.py --categories VIB_MON INLET_AIR FUEL_GAS
    python pricing_discovery.py --dry-run
    python pricing_discovery.py --limit 5
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
    CONF_COMPONENT_BUILDUPS, CONF_BUDGETARY,
    CONFIDENCE_SCORES,
)
from bom_library import (
    BOM_LIBRARY, get_category_bom, get_all_categories, get_bom_total
)
from comparable_machines import (
    COMPARABLE_MACHINES, get_all_machine_ids, get_bop_benchmark_from_kw
)
from scoring import aggregate_price_estimate, compute_delta
from rate_limits import GuardRegistry
from outputs import write_pricing_csv, write_pricing_summary_md, write_run_summary_json
from providers.common import make_session, now_iso
from providers import sam_gov, ferc, supplier_catalogs, perplexity as perp

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


def discover_category(
    category_code: str,
    session: Any,
    guards: GuardRegistry,
    dry_run: bool,
    prior_mid: float = 0.0,
) -> PricingResult:
    """
    Run all four discovery vectors for one BOP category.
    Returns a fully-populated PricingResult.
    """
    cat_def  = BOM_LIBRARY.get(category_code, {})
    cat_name = cat_def.get("name", category_code)
    suppliers = cat_def.get("suppliers", [])
    search_terms = cat_def.get("search_terms", [])

    all_evidence: List[PricingEvidence] = []

    # ── Vector 1: Component BOM build-up (always runs — no external API) ──────
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
            timestamp=now_iso(),
            notes="Bottom-up BOM aggregation with integration factor",
        ))

    # ── Vector 2: Analogous machine cross-reference (internal calc — no API) ──
    for machine_id in get_all_machine_ids():
        low_m, mid_m, high_m, note = get_bop_benchmark_from_kw(machine_id, target_mw=50.0)
        if mid_m > 0:
            machine = COMPARABLE_MACHINES[machine_id]
            is_self = machine_id == "W251_SELF"
            all_evidence.append(PricingEvidence(
                vector=VECTOR_ANALOGOUS,
                provider="COMPARABLE_MACHINES",
                source_name="W251B8 direct $/kW benchmark" if is_self else f"Analogous: {machine['name']}",
                raw_value_usd=mid_m, normalized_value_usd=mid_m,
                year_of_data=2024, machine_ref=machine["name"],
                mw_ref=machine["mw"], mw_target=50.0,
                normalization_factor=1.0 if is_self else (50.0 / machine["mw"]) ** 0.7,
                confidence_label=CONF_COMPONENT_BUILDUPS,
                confidence_score=CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS] + (3 if is_self else -3),
                snippet=note, timestamp=now_iso(),
            ))

    # ── Vector 3: Public utility records ──────────────────────────────────────
    if not dry_run:
        # USASpending federal contracts
        keywords = sam_gov.build_bop_keywords(cat_name, suppliers)
        items = guards.guard("usaspending").call(
            sam_gov.search_usaspending, session, keywords, cat_name
        ) or []
        all_evidence.extend(items)

        # FERC Form 1 comparable machine benchmarks
        items = guards.guard("ferc_form1").call(
            ferc.ferc_form1_search, session, ["GE_6B", "GE_7EA", "W251_SELF"], cat_name
        ) or []
        all_evidence.extend(items)

        # EIA Form 860 benchmark (always available — no API call)
        items = guards.guard("eia_form860").call(
            ferc.eia_form860_benchmark, session, cat_name, 50.0
        ) or []
        all_evidence.extend(items)

    # ── Vector 4: Supplier catalog + trade press ──────────────────────────────
    if not dry_run and search_terms:
        items = guards.guard("google_catalog").call(
            supplier_catalogs.google_catalog_search,
            session, search_terms[:4], cat_name, suppliers
        ) or []
        all_evidence.extend(items)

    # ── Perplexity synthesis (last resort) ────────────────────────────────────
    # Only run if confidence is still low after free sources
    if not dry_run and perp.perplexity_available():
        current_best = max((e.confidence_score for e in all_evidence), default=0)
        if current_best < 65:  # below COMPONENT_BUILDUPS threshold
            bom_desc = "; ".join(
                f"{item.component} (${item.mid_usd:,.0f})"
                for item in bom_items[:5]
            )
            items = guards.guard("perplexity").call(
                perp.perplexity_price_synthesis,
                session, cat_name, bom_desc, suppliers
            ) or []
            all_evidence.extend(items)

    # ── Score and aggregate ───────────────────────────────────────────────────
    low, mid, high, conf_label, conf_score = aggregate_price_estimate(all_evidence, bom_mid)

    # Dry-run returns BOM-only estimate
    if dry_run and bom_mid > 0:
        low, mid, high = bom_mid * 0.85, bom_mid, bom_mid * 1.20
        conf_label, conf_score = CONF_COMPONENT_BUILDUPS, CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS]

    delta = compute_delta(mid, prior_mid)

    primary_vector = ""
    if all_evidence:
        best = max(all_evidence, key=lambda e: e.confidence_score)
        primary_vector = best.vector

    return PricingResult(
        category=cat_name,
        category_code=category_code,
        low_usd=low,
        mid_usd=mid,
        high_usd=high,
        confidence_label=conf_label,
        confidence_score=conf_score,
        primary_vector=primary_vector,
        evidence_count=len(all_evidence),
        evidence_items=all_evidence,
        bom_items=bom_items,
        bom_total_mid=bom_mid,
        analogous_refs=[
            m["name"] for mid_id, m in COMPARABLE_MACHINES.items()
            if mid_id != "W251_SELF"
        ],
        data_year=2024,
        cost_index="ENR CCI 2024",
        prior_mid_usd=prior_mid,
        delta_pct=delta,
        last_updated=now_iso(),
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FlowSeer W251 BOP Pricing Discovery Engine")
    p.add_argument("--categories", nargs="+", help="Specific category codes to run (default: all 19)")
    p.add_argument("--output-dir",  default=".", help="Output directory")
    p.add_argument("--limit",       type=int,    help="Max categories to process")
    p.add_argument("--dry-run",     action="store_true", help="BOM-only, no external API calls")
    return p.parse_args()


def main() -> None:
    args    = parse_args()
    out     = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Determine categories to run
    if args.categories:
        categories = [c.upper() for c in args.categories if c.upper() in BOM_LIBRARY]
    else:
        categories = get_all_categories()

    if args.limit:
        categories = categories[:args.limit]

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}FlowSeer Pricing Discovery — {len(categories)} categories")

    guards  = GuardRegistry(dry_run=args.dry_run)
    session = make_session()
    results  = []
    warnings = []

    for idx, code in enumerate(categories, 1):
        cat_name = BOM_LIBRARY.get(code, {}).get("name", code)
        print(f"[{idx:2}/{len(categories)}] {cat_name}...", end=" ", flush=True)

        try:
            result = discover_category(code, session, guards, args.dry_run)
            results.append(result.to_flat_dict())
            log_event({
                "ts": now_iso(), "code": code, "category": cat_name,
                "mid_usd": result.mid_usd, "confidence": result.confidence_label,
                "evidence_count": result.evidence_count,
            })
            conf_icon = {
                "RFQ_VERIFIED": "✓✓", "SUPPLIER_CATALOG": "✓",
                "FERC_RATE_CASE": "~✓", "EIA_BENCHMARK": "~",
                "COMPONENT_BUILDUPS": "○", "BUDGETARY_ESTIMATE": "?",
            }.get(result.confidence_label, "?")
            print(f"${result.mid_usd:,.0f} [{conf_icon} {result.confidence_label}] — {result.evidence_count} sources")
        except Exception as e:
            msg = f"Error on {cat_name}: {e}"
            warnings.append(msg)
            log.error(msg)
            print(f"ERROR: {e}")

    # Compute totals
    total_mid = sum(float(r.get("mid_usd", 0)) for r in results)
    print(f"\n{'─'*60}")
    print(f"TOTAL BOP MID ESTIMATE: ${total_mid:,.0f}")
    print(f"{'─'*60}")

    # Write outputs
    paths = {
        "pricing_csv":    str(out / "pricing_updated.csv"),
        "summary_md":     str(out / "pricing_summary.md"),
        "run_summary":    str(out / "pricing_run_summary.json"),
    }
    print()
    write_pricing_csv(paths["pricing_csv"], results)
    write_pricing_summary_md(paths["summary_md"], results, dry_run=args.dry_run)
    write_run_summary_json(paths["run_summary"], results, guards.all_stats(),
                           dry_run=args.dry_run, warnings=warnings)
    print(f"Log: {LOG_FILE}")


if __name__ == "__main__":
    main()
