"""
state/session_state.py — Session state management.
Persists current loop state to disk so runs can be resumed.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DirectiveState:
    """State for a single directive in progress."""
    directive_id:        str
    title:               str
    status:              str    # QUEUED|PLANNING|RESEARCHING|BUILDING|AUDITING|COMPLETE|FAILED|ESCALATED
    attempt:             int    = 0
    architect_plan:      Optional[Dict[str, Any]] = None
    research_results:    List[Dict[str, Any]]     = field(default_factory=list)
    build_output:        Optional[Dict[str, Any]] = None
    audit_result:        Optional[Dict[str, Any]] = None
    commit_sha:          str                      = ""
    started_at:          str                      = ""
    completed_at:        str                      = ""
    error:               str                      = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SessionState:
    """Full session state across all directives."""
    session_id:         str
    started_at:         str                      = ""
    last_updated:       str                      = ""
    directives:         List[DirectiveState]     = field(default_factory=list)
    current_directive:  Optional[str]            = None
    completed_count:    int                      = 0
    failed_count:       int                      = 0
    escalated_count:    int                      = 0

    def to_dict(self) -> dict:
        return {
            "session_id":        self.session_id,
            "started_at":        self.started_at,
            "last_updated":      self.last_updated,
            "current_directive": self.current_directive,
            "completed_count":   self.completed_count,
            "failed_count":      self.failed_count,
            "escalated_count":   self.escalated_count,
            "directives":        [d.to_dict() for d in self.directives],
        }


class StateManager:
    """Manages session state with disk persistence."""

    def __init__(self, state_file: str = "session_state.json") -> None:
        self.state_file = Path(state_file)
        self.state      = self._load()

    def _load(self) -> SessionState:
        if self.state_file.exists():
            with open(self.state_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            directives = [DirectiveState(**d) for d in data.get("directives", [])]
            return SessionState(
                session_id=data.get("session_id", self._new_id()),
                started_at=data.get("started_at", now_iso()),
                last_updated=data.get("last_updated", now_iso()),
                directives=directives,
                current_directive=data.get("current_directive"),
                completed_count=data.get("completed_count", 0),
                failed_count=data.get("failed_count", 0),
                escalated_count=data.get("escalated_count", 0),
            )
        return SessionState(
            session_id=self._new_id(),
            started_at=now_iso(),
            last_updated=now_iso(),
        )

    def save(self) -> None:
        self.state.last_updated = now_iso()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(self.state.to_dict(), f, indent=2, ensure_ascii=False)

    def _new_id(self) -> str:
        import uuid
        return str(uuid.uuid4())[:8]

    def get_or_create_directive(self, directive_id: str, title: str = "") -> DirectiveState:
        for d in self.state.directives:
            if d.directive_id == directive_id:
                return d
        d = DirectiveState(
            directive_id=directive_id,
            title=title,
            status="QUEUED",
            started_at=now_iso(),
        )
        self.state.directives.append(d)
        self.save()
        return d

    def update_directive(self, directive: DirectiveState) -> None:
        for i, d in enumerate(self.state.directives):
            if d.directive_id == directive.directive_id:
                self.state.directives[i] = directive
                break
        self.save()

    def mark_complete(self, directive_id: str, commit_sha: str) -> None:
        for d in self.state.directives:
            if d.directive_id == directive_id:
                d.status       = "COMPLETE"
                d.commit_sha   = commit_sha
                d.completed_at = now_iso()
                self.state.completed_count += 1
                break
        self.state.current_directive = None
        self.save()

    def mark_failed(self, directive_id: str, error: str) -> None:
        for d in self.state.directives:
            if d.directive_id == directive_id:
                d.status       = "FAILED"
                d.error        = error
                d.completed_at = now_iso()
                self.state.failed_count += 1
                break
        self.state.current_directive = None
        self.save()

    def mark_escalated(self, directive_id: str, reason: str) -> None:
        for d in self.state.directives:
            if d.directive_id == directive_id:
                d.status       = "ESCALATED"
                d.error        = reason
                d.completed_at = now_iso()
                self.state.escalated_count += 1
                break
        self.state.current_directive = None
        self.save()
