"""
rate_limits.py — FlowSeer Contact Verifier
Quota guards, retry/backoff logic, and provider disable-on-failure.
All external call sites must go through a RateLimitedProvider instance.
"""
from __future__ import annotations

import time
import logging
from typing import Any, Callable, Dict, Optional, TypeVar

from models import ProviderStats

log = logging.getLogger(__name__)

F = TypeVar("F")

# Default per-provider limits (overridable via config)
DEFAULT_LIMITS: Dict[str, Dict[str, int]] = {
    "google":           {"max_calls": 90,  "max_failures": 5,  "max_retries": 2},
    "sec_edgar":        {"max_calls": 200, "max_failures": 10, "max_retries": 3},
    "wikidata":         {"max_calls": 200, "max_failures": 10, "max_retries": 3},
    "github":           {"max_calls": 100, "max_failures": 5,  "max_retries": 2},
    "newsapi":          {"max_calls": 90,  "max_failures": 5,  "max_retries": 2},
    "orcid":            {"max_calls": 200, "max_failures": 10, "max_retries": 3},
    "opencorporates":   {"max_calls": 100, "max_failures": 5,  "max_retries": 2},
    "domain_mx":        {"max_calls": 500, "max_failures": 20, "max_retries": 1},
    "hunter":           {"max_calls": 45,  "max_failures": 3,  "max_retries": 2},
    "apollo":           {"max_calls": 20,  "max_failures": 3,  "max_retries": 1},
}

BACKOFF_BASE  = 1.5   # seconds
BACKOFF_CAP   = 30.0  # max wait between retries


class ProviderGuard:
    """
    Wraps a provider function with quota tracking, backoff, and auto-disable.
    Thread-safety: not required — single-threaded batch runner.
    """

    def __init__(self, name: str, dry_run: bool = False, limits: Optional[Dict[str, int]] = None):
        self.name     = name
        self.dry_run  = dry_run
        self.stats    = ProviderStats(name=name)
        cfg           = limits or DEFAULT_LIMITS.get(name, {"max_calls": 100, "max_failures": 5, "max_retries": 2})
        self.max_calls    = cfg["max_calls"]
        self.max_failures = cfg["max_failures"]
        self.max_retries  = cfg.get("max_retries", 2)

    @property
    def available(self) -> bool:
        if self.dry_run:
            return False
        if self.stats.disabled:
            return False
        if self.stats.attempted >= self.max_calls:
            self.stats.skipped_quota += 1
            return False
        return True

    def call(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Optional[Any]:
        """
        Execute fn with retry/backoff.
        Returns None on terminal failure or if guard is unavailable.
        Records stats unconditionally.
        """
        if not self.available:
            return None

        self.stats.attempted += 1
        last_exc: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                result = fn(*args, **kwargs)
                self.stats.successful += 1
                return result
            except Exception as exc:
                last_exc = exc
                status_code = getattr(getattr(exc, "response", None), "status_code", 0)

                if status_code == 429:
                    self.stats.rate_limited += 1
                    wait = min(BACKOFF_BASE ** (attempt + 2), BACKOFF_CAP)
                    log.warning("[%s] Rate limited (429) — waiting %.1fs before retry %d",
                                self.name, wait, attempt + 1)
                    time.sleep(wait)
                elif status_code and status_code >= 500:
                    wait = min(BACKOFF_BASE ** (attempt + 1), BACKOFF_CAP)
                    log.warning("[%s] Server error (%d) — waiting %.1fs", self.name, status_code, wait)
                    time.sleep(wait)
                else:
                    # Non-retryable client error or network issue
                    break

        # All retries exhausted
        self.stats.failed += 1
        log.debug("[%s] Failed after %d attempts: %s", self.name, self.max_retries + 1, last_exc)

        if self.stats.failed >= self.max_failures:
            self.stats.disabled     = True
            self.stats.disable_reason = f"Disabled after {self.stats.failed} failures"
            log.warning("[%s] Disabled after %d failures — will not be called again this run",
                        self.name, self.stats.failed)

        return None


class GuardRegistry:
    """Registry of all provider guards for a single run."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self._guards: Dict[str, ProviderGuard] = {}

    def guard(self, name: str) -> ProviderGuard:
        if name not in self._guards:
            self._guards[name] = ProviderGuard(name=name, dry_run=self.dry_run)
        return self._guards[name]

    def all_stats(self) -> Dict[str, ProviderStats]:
        return {name: g.stats for name, g in self._guards.items()}
