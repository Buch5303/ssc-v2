"""
agents/research_cache.py — Perplexity result cache.
Caches research results by query hash for 24 hours.
Eliminates repeat API calls for same topic across directives.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger("orchestrator.research_cache")

CACHE_FILE = Path(__file__).parent.parent / "state" / "research_cache.json"
TTL_SECONDS = 86400   # 24 hours


class ResearchCache:

    def __init__(self) -> None:
        self._data: Dict[str, Any] = self._load()

    def _load(self) -> Dict[str, Any]:
        try:
            if CACHE_FILE.exists():
                return json.loads(CACHE_FILE.read_text())
        except Exception:
            pass
        return {}

    def _save(self) -> None:
        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(self._data, indent=2, default=str))
        except Exception as e:
            log.debug("Cache save failed: %s", e)

    def _key(self, query: str) -> str:
        return hashlib.md5(query.lower().strip().encode()).hexdigest()

    def get(self, query: str) -> Optional[Dict[str, Any]]:
        k = self._key(query)
        entry = self._data.get(k)
        if not entry:
            return None
        if time.time() - entry.get("ts", 0) > TTL_SECONDS:
            del self._data[k]
            self._save()
            return None
        log.info("Cache HIT: %s", query[:60])
        return entry["result"]

    def set(self, query: str, result: Dict[str, Any]) -> None:
        k = self._key(query)
        self._data[k] = {"ts": time.time(), "result": result, "query": query[:100]}
        self._save()

    def stats(self) -> Dict[str, int]:
        now = time.time()
        valid = sum(1 for v in self._data.values() if now - v.get("ts", 0) < TTL_SECONDS)
        return {"total": len(self._data), "valid": valid}


# Singleton
_cache = ResearchCache()


def get_cached(query: str) -> Optional[Dict[str, Any]]:
    return _cache.get(query)


def set_cached(query: str, result: Dict[str, Any]) -> None:
    _cache.set(query, result)


def cache_stats() -> Dict[str, int]:
    return _cache.stats()
