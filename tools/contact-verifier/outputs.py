"""
outputs.py — FlowSeer Contact Verifier
All output artifact writers.
Produces: contacts_verified.csv, contacts_needs_review.csv,
          contacts_ready_for_rfq.csv, run_summary.json, run_summary.md
"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from models import (
    ProviderStats,
    STATUS_VERIFIED,
    STATUS_LIKELY,
    STATUS_PATTERN,
    STATUS_REVIEW,
    STATUS_SKIPPED,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Fieldname sets ────────────────────────────────────────────────────────────

VERIFIED_FIELDS = [
    "contact_id", "full_name", "title", "company", "company_domain",
    "email", "verification_status", "confidence_label", "confidence_score",
    "provider_path", "primary_evidence_url", "evidence_count",
    "suppression_reason", "rfq_ready_flag", "manual_rfq_approval",
    "approval_basis", "last_checked_at",
]

REVIEW_FIELDS = [
    "contact_id", "full_name", "title", "company", "company_domain",
    "proposed_email", "confidence_label", "confidence_score",
    "ambiguity_reason", "evidence_count", "primary_evidence_url",
    "reviewer_action_needed", "suppression_reason", "last_checked_at",
]

RFQ_FIELDS = [
    "contact_id", "full_name", "title", "company", "company_domain",
    "email", "confidence_label", "approval_basis",
    "approved_for_rfq", "primary_evidence_url", "last_checked_at",
]


def _safe(d: Dict[str, Any], key: str, default: str = "") -> str:
    return str(d.get(key, default) or default).strip()


def _write_csv(path: str, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _safe(row, k) for k in fieldnames})


def write_verified(path: str, rows: List[Dict[str, str]], dry_run: bool = False) -> None:
    verified = [r for r in rows if _safe(r, "verification_status") == STATUS_VERIFIED]
    label = "[DRY-RUN] " if dry_run else ""
    _write_csv(path, verified, VERIFIED_FIELDS)
    print(f"{label}Verified CSV: {path} ({len(verified)} records)")


def write_needs_review(path: str, rows: List[Dict[str, str]], dry_run: bool = False) -> None:
    review = [
        r for r in rows
        if _safe(r, "verification_status") in {STATUS_LIKELY, STATUS_PATTERN, STATUS_REVIEW}
        and not _safe(r, "suppression_reason")
    ]
    label = "[DRY-RUN] " if dry_run else ""

    mapped = []
    for r in review:
        mapped.append({
            "contact_id":            _safe(r, "contact_id"),
            "full_name":             _safe(r, "full_name"),
            "title":                 _safe(r, "title"),
            "company":               _safe(r, "company"),
            "company_domain":        _safe(r, "company_domain"),
            "proposed_email":        _safe(r, "likely_email"),
            "confidence_label":      _safe(r, "confidence_label"),
            "confidence_score":      _safe(r, "confidence_score"),
            "ambiguity_reason":      _safe(r, "ambiguity_reason"),
            "evidence_count":        _safe(r, "evidence_count"),
            "primary_evidence_url":  _safe(r, "primary_evidence_url"),
            "reviewer_action_needed":"Confirm email and approve for outreach" if _safe(r, "verification_status") == STATUS_LIKELY else "Manual research required",
            "suppression_reason":    _safe(r, "suppression_reason"),
            "last_checked_at":       _safe(r, "last_checked_at"),
        })

    _write_csv(path, mapped, REVIEW_FIELDS)
    print(f"{label}Needs-Review CSV: {path} ({len(mapped)} records)")


def write_rfq_ready(path: str, rows: List[Dict[str, str]], dry_run: bool = False) -> None:
    """Only contacts that passed the RFQ safety gate (rfq_ready_flag == YES)."""
    ready = [r for r in rows if _safe(r, "rfq_ready_flag") == "YES"]
    label = "[DRY-RUN] " if dry_run else ""

    mapped = []
    for r in ready:
        mapped.append({
            "contact_id":           _safe(r, "contact_id"),
            "full_name":            _safe(r, "full_name"),
            "title":                _safe(r, "title"),
            "company":              _safe(r, "company"),
            "company_domain":       _safe(r, "company_domain"),
            "email":                _safe(r, "email") or _safe(r, "likely_email"),
            "confidence_label":     _safe(r, "confidence_label"),
            "approval_basis":       _safe(r, "approval_basis"),
            "approved_for_rfq":     "YES",
            "primary_evidence_url": _safe(r, "primary_evidence_url"),
            "last_checked_at":      _safe(r, "last_checked_at"),
        })

    _write_csv(path, mapped, RFQ_FIELDS)
    print(f"{label}RFQ-Ready CSV: {path} ({len(mapped)} records)")


def write_run_summary_json(
    path: str,
    rows: List[Dict[str, str]],
    provider_stats: Dict[str, ProviderStats],
    dry_run: bool,
    input_count: int,
    warnings: Optional[List[str]] = None,
    output_paths: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    counts = {
        "total_input":     input_count,
        "total_processed": len([r for r in rows if not _safe(r, "suppression_reason")]),
        "total_skipped":   len([r for r in rows if _safe(r, "suppression_reason")]),
        "total_verified":  len([r for r in rows if _safe(r, "verification_status") == STATUS_VERIFIED]),
        "total_likely":    len([r for r in rows if _safe(r, "verification_status") == STATUS_LIKELY]),
        "total_pattern":   len([r for r in rows if _safe(r, "verification_status") == STATUS_PATTERN]),
        "total_needs_review": len([r for r in rows if _safe(r, "verification_status") == STATUS_REVIEW and not _safe(r, "suppression_reason")]),
        "total_rfq_ready": len([r for r in rows if _safe(r, "rfq_ready_flag") == "YES"]),
    }

    provider_summary = {}
    for name, stats in provider_stats.items():
        provider_summary[name] = {
            "attempted":     stats.attempted,
            "successful":    stats.successful,
            "failed":        stats.failed,
            "rate_limited":  stats.rate_limited,
            "skipped_quota": stats.skipped_quota,
            "disabled":      stats.disabled,
            "disable_reason":stats.disable_reason,
        }

    summary = {
        "run_timestamp":  now_iso(),
        "dry_run":        dry_run,
        "counts":         counts,
        "providers":      provider_summary,
        "output_files":   output_paths or {},
        "warnings":       warnings or [],
    }

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    label = "[DRY-RUN] " if dry_run else ""
    print(f"{label}Run summary JSON: {path}")
    return summary


def write_run_summary_md(path: str, summary: Dict[str, Any], dry_run: bool = False) -> None:
    c = summary["counts"]
    label = " [DRY-RUN]" if dry_run else ""
    lines = [
        f"# FlowSeer Contact Verification Run Summary{label}",
        f"**Generated:** {summary['run_timestamp']}",
        "",
        "## Contact Counts",
        f"| Metric | Count |",
        f"|--------|-------|",
        f"| Input contacts | {c['total_input']} |",
        f"| Processed | {c['total_processed']} |",
        f"| Skipped/Suppressed | {c['total_skipped']} |",
        f"| **VERIFIED_EMAIL** | **{c['total_verified']}** |",
        f"| LIKELY_CORRECT | {c['total_likely']} |",
        f"| DOMAIN_PATTERN_ONLY | {c['total_pattern']} |",
        f"| NEEDS_REVIEW | {c['total_needs_review']} |",
        f"| **RFQ-Ready (gate passed)** | **{c['total_rfq_ready']}** |",
        "",
        "## Provider Activity",
        "| Provider | Attempted | Success | Failed | Rate-Limited | Disabled |",
        "|----------|-----------|---------|--------|--------------|----------|",
    ]
    for name, stats in summary.get("providers", {}).items():
        lines.append(
            f"| {name} | {stats['attempted']} | {stats['successful']} | "
            f"{stats['failed']} | {stats['rate_limited']} | "
            f"{'YES — ' + stats['disable_reason'] if stats['disabled'] else 'no'} |"
        )

    if summary.get("warnings"):
        lines += ["", "## Warnings"]
        for w in summary["warnings"]:
            lines.append(f"- {w}")

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"{'[DRY-RUN] ' if dry_run else ''}Run summary MD: {path}")
