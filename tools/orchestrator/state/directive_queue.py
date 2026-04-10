"""
state/directive_queue.py — Directive queue management.
Directives are loaded from directive_queue.json and processed in order.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class Directive:
    """A single directive in the queue."""
    id:          str
    title:       str
    task:        str          # natural language description
    priority:    int   = 5    # 1=highest, 10=lowest
    depends_on:  List[str] = None  # directive IDs that must complete first
    context:     str   = ""   # additional context for the Architect

    def __post_init__(self):
        if self.depends_on is None:
            self.depends_on = []

    def to_dict(self) -> dict:
        return {
            "id":         self.id,
            "title":      self.title,
            "task":       self.task,
            "priority":   self.priority,
            "depends_on": self.depends_on,
            "context":    self.context,
        }


class DirectiveQueue:
    """
    Loads and manages directives from directive_queue.json.
    Supports priority ordering and dependency checking.
    """

    def __init__(self, queue_file: str = "directive_queue.json") -> None:
        self.queue_file = Path(queue_file)
        self.directives = self._load()

    def _load(self) -> List[Directive]:
        if not self.queue_file.exists():
            return []
        with open(self.queue_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        directives = []
        for item in data.get("directives", []):
            d = Directive(
                id=item["id"],
                title=item["title"],
                task=item["task"],
                priority=item.get("priority", 5),
                depends_on=item.get("depends_on", []),
                context=item.get("context", ""),
            )
            directives.append(d)
        # Sort by priority
        return sorted(directives, key=lambda d: d.priority)

    def reload(self) -> None:
        """Reload queue from disk — allows hot-adding directives."""
        self.directives = self._load()

    def next(self, completed_ids: List[str]) -> Optional[Directive]:
        """Return next directive whose dependencies are satisfied."""
        for d in self.directives:
            if d.id in completed_ids:
                continue
            if all(dep in completed_ids for dep in d.depends_on):
                return d
        return None

    def pending_count(self, completed_ids: List[str]) -> int:
        return sum(1 for d in self.directives if d.id not in completed_ids)

    def save(self) -> None:
        """Write current queue back to disk."""
        self.queue_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.queue_file, "w", encoding="utf-8") as f:
            json.dump(
                {"directives": [d.to_dict() for d in self.directives]},
                f, indent=2, ensure_ascii=False,
            )

    def add(self, directive: Directive) -> None:
        """Add a directive to the queue."""
        self.directives.append(directive)
        self.directives = sorted(self.directives, key=lambda d: d.priority)
        self.save()
