"""
state/audit_log.py — Full decision trail logging.
Every agent call, result, and loop decision is recorded to JSONL.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditLog:
    """Append-only JSONL audit log for the full orchestration trail."""

    def __init__(self, log_file: str = "audit_log.jsonl") -> None:
        self.log_file = Path(log_file)
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def _write(self, event: Dict[str, Any]) -> None:
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")

    def log_directive_start(self, directive_id: str, title: str) -> None:
        self._write({
            "ts": now_iso(), "event": "DIRECTIVE_START",
            "directive_id": directive_id, "title": title,
        })

    def log_architect_plan(self, directive_id: str, plan: Dict[str, Any]) -> None:
        self._write({
            "ts": now_iso(), "event": "ARCHITECT_PLAN",
            "directive_id": directive_id,
            "research_queries": plan.get("research_queries", []),
            "files_to_create": plan.get("build_spec", {}).get("files_to_create", []),
            "acceptance_criteria": plan.get("acceptance_criteria", []),
            "complexity": plan.get("estimated_complexity", ""),
        })

    def log_research_complete(self, directive_id: str, query_count: int, finding_count: int) -> None:
        self._write({
            "ts": now_iso(), "event": "RESEARCH_COMPLETE",
            "directive_id": directive_id,
            "queries_run": query_count,
            "findings": finding_count,
        })

    def log_build_complete(self, directive_id: str, status: str, files_written: int, attempt: int) -> None:
        self._write({
            "ts": now_iso(), "event": "BUILD_COMPLETE",
            "directive_id": directive_id,
            "status": status,
            "files_written": files_written,
            "attempt": attempt,
        })

    def log_audit_result(self, directive_id: str, verdict: str, issues: list, attempt: int) -> None:
        self._write({
            "ts": now_iso(), "event": "AUDIT_RESULT",
            "directive_id": directive_id,
            "verdict": verdict,
            "issue_count": len(issues),
            "blocking_issues": sum(1 for i in issues if i.get("severity") == "BLOCKING"),
            "attempt": attempt,
        })

    def log_correction_loop(self, directive_id: str, attempt: int, reason: str) -> None:
        self._write({
            "ts": now_iso(), "event": "CORRECTION_LOOP",
            "directive_id": directive_id,
            "attempt": attempt,
            "reason": reason,
        })

    def log_directive_complete(self, directive_id: str, commit_sha: str, total_attempts: int) -> None:
        self._write({
            "ts": now_iso(), "event": "DIRECTIVE_COMPLETE",
            "directive_id": directive_id,
            "commit_sha": commit_sha,
            "total_attempts": total_attempts,
        })

    def log_escalation(self, directive_id: str, reason: str) -> None:
        self._write({
            "ts": now_iso(), "event": "ESCALATION",
            "directive_id": directive_id,
            "reason": reason,
        })

    def log_error(self, directive_id: str, agent: str, error: str) -> None:
        self._write({
            "ts": now_iso(), "event": "ERROR",
            "directive_id": directive_id,
            "agent": agent,
            "error": error,
        })
