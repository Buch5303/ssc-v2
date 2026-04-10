"""
rate_limits.py — FlowSeer Pricing Discovery Engine
Same guard pattern as contact verifier. Reused unchanged.
"""
from __future__ import annotations
import time, logging
from typing import Any, Callable, Dict, Optional
from models import CONF_BUDGETARY

log = logging.getLogger(__name__)

DEFAULT_LIMITS = {
    "google_catalog": {"max_calls": 80,  "max_failures": 5, "max_retries": 2},
    "usaspending":    {"max_calls": 100, "max_failures": 5, "max_retries": 3},
    "ferc_elibrary":  {"max_calls": 100, "max_failures": 5, "max_retries": 3},
    "ferc_form1":     {"max_calls": 200, "max_failures": 10,"max_retries": 2},
    "eia_form860":    {"max_calls": 200, "max_failures": 10,"max_retries": 2},
    "perplexity":     {"max_calls": 30,  "max_failures": 3, "max_retries": 1},
    "bom_library":    {"max_calls": 500, "max_failures": 50,"max_retries": 0},
    "comparable":     {"max_calls": 500, "max_failures": 50,"max_retries": 0},
}

class ProviderStats:
    def __init__(self, name):
        self.name = name; self.attempted = 0; self.successful = 0
        self.failed = 0; self.rate_limited = 0; self.skipped_quota = 0
        self.disabled = False; self.disable_reason = ""

class ProviderGuard:
    def __init__(self, name, dry_run=False, limits=None):
        self.name = name; self.dry_run = dry_run
        self.stats = ProviderStats(name)
        cfg = limits or DEFAULT_LIMITS.get(name, {"max_calls":100,"max_failures":5,"max_retries":2})
        self.max_calls = cfg["max_calls"]; self.max_failures = cfg["max_failures"]
        self.max_retries = cfg.get("max_retries", 2)

    @property
    def available(self):
        if self.dry_run or self.stats.disabled: return False
        if self.stats.attempted >= self.max_calls:
            self.stats.skipped_quota += 1; return False
        return True

    def call(self, fn, *args, **kwargs):
        if not self.available: return None
        self.stats.attempted += 1
        for attempt in range(self.max_retries + 1):
            try:
                result = fn(*args, **kwargs)
                self.stats.successful += 1; return result
            except Exception as exc:
                sc = getattr(getattr(exc, "response", None), "status_code", 0)
                if sc == 429:
                    self.stats.rate_limited += 1
                    time.sleep(min(1.5**(attempt+2), 30))
                elif sc and sc >= 500:
                    time.sleep(min(1.5**(attempt+1), 30))
                else: break
        self.stats.failed += 1
        if self.stats.failed >= self.max_failures:
            self.stats.disabled = True
            self.stats.disable_reason = f"Disabled after {self.stats.failed} failures"
            log.warning("[%s] Disabled", self.name)
        return None

class GuardRegistry:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run; self._guards: Dict[str, ProviderGuard] = {}
    def guard(self, name):
        if name not in self._guards:
            self._guards[name] = ProviderGuard(name=name, dry_run=self.dry_run)
        return self._guards[name]
    def all_stats(self):
        return {n: g.stats for n, g in self._guards.items()}
