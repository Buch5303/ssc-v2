"""
agents/researcher.py — Perplexity sonar-pro Research adapter v2.

Improvements:
  1. Result caching — 24hr TTL, eliminates repeat calls
  2. Tiered model depth — fast sonar for simple facts, sonar-pro for complex
  3. Parallel query execution — all queries fire simultaneously
"""
from __future__ import annotations

import json
import logging
import os
import time
import concurrent.futures
from typing import Any, Dict, List, Optional

import requests

from config.roles import RESEARCHER_SYSTEM
from config.loop_config import MODELS, API_URLS, TIMEOUTS, MAX_TOKENS, MAX_RETRIES, BACKOFF_BASE, BACKOFF_CAP
from agents.research_cache import get_cached, set_cached, cache_stats

log = logging.getLogger("orchestrator.researcher")

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")

# Simple factual queries use the lighter model
FAST_MODEL  = "sonar"          # cheaper, faster for simple facts
DEEP_MODEL  = "sonar-pro"      # full web search for complex queries

# Keywords that indicate a simple factual lookup (use fast model)
SIMPLE_QUERY_SIGNALS = [
    "what is", "current price", "current rate", "index value",
    "who is", "when was", "how many", "what year",
    "ENR CCI", "exchange rate", "lead time",
]


def _is_simple_query(query: str) -> bool:
    q = query.lower()
    return any(signal in q for signal in SIMPLE_QUERY_SIGNALS)


class ResearcherAgent:
    """Perplexity — web-grounded evidence with caching and parallel execution."""

    def __init__(self) -> None:
        self.url     = API_URLS["researcher"]
        self.timeout = TIMEOUTS["researcher"]

    def available(self) -> bool:
        return bool(PERPLEXITY_API_KEY)

    def research(self, queries: List[str], context: str = "") -> List[Dict[str, Any]]:
        """
        Run queries — uses cache first, fires remaining in parallel.
        Returns list of findings dicts.
        """
        if not self.available():
            log.info("Perplexity not available — skipping research")
            return []

        stats = cache_stats()
        log.info("Research cache: %d valid entries", stats["valid"])

        cached_results   = []
        uncached_queries = []

        for query in queries:
            hit = get_cached(query)
            if hit:
                cached_results.append(hit)
            else:
                uncached_queries.append(query)

        log.info("Research: %d cached, %d to fetch", len(cached_results), len(uncached_queries))

        # Fire uncached queries in parallel
        fresh_results = []
        if uncached_queries:
            fresh_results = self._parallel_research(uncached_queries, context)

        return cached_results + fresh_results

    def _parallel_research(self, queries: List[str], context: str) -> List[Dict[str, Any]]:
        """Fire all queries simultaneously using thread pool."""
        results = []
        max_workers = min(len(queries), 4)

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self._research_one, q, context): q
                for q in queries
            }
            for future in concurrent.futures.as_completed(futures):
                query = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                    set_cached(query, result)
                except Exception as e:
                    log.warning("Research query failed: %s — %s", query[:60], e)
                    results.append({
                        "query":    query,
                        "findings": [],
                        "summary":  f"Research unavailable: {e}",
                        "data_gaps": ["Query failed"],
                    })

        return results

    def _research_one(self, query: str, context: str = "") -> Dict[str, Any]:
        """Research a single query with tiered model selection."""
        model    = FAST_MODEL if _is_simple_query(query) else DEEP_MODEL
        messages = [
            {"role": "system", "content": RESEARCHER_SYSTEM},
            {"role": "user",   "content": f"Research query: {query}\n\nContext: {context}" if context else f"Research query: {query}"},
        ]

        log.debug("Research [%s]: %s", model, query[:60])
        raw = self._call(messages, model)
        return self._parse(raw, query)

    def _call(self, messages: list, model: str) -> str:
        headers = {
            "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       model,
            "messages":    messages,
            "max_tokens":  MAX_TOKENS["researcher"],
            "temperature": 0.1,
        }

        for attempt in range(MAX_RETRIES):
            try:
                r = requests.post(self.url, headers=headers, json=payload, timeout=self.timeout)
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    wait = min(BACKOFF_BASE ** (attempt + 1), BACKOFF_CAP)
                    log.warning("Researcher rate limited — waiting %.1fs", wait)
                    time.sleep(wait)
                else:
                    raise
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    log.warning("Perplexity unreachable — falling back to Claude")
                    return self._call_claude_fallback(messages)
                time.sleep(BACKOFF_BASE ** attempt)

        return self._call_claude_fallback(messages)

    def _call_claude_fallback(self, messages: list) -> str:
        import os
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not anthropic_key:
            raise RuntimeError("Researcher: Perplexity unreachable and no fallback")

        system_msg = next((m["content"] for m in messages if m["role"] == "system"), RESEARCHER_SYSTEM)
        user_msg   = next((m["content"] for m in messages if m["role"] == "user"), "")

        headers = {
            "x-api-key":         anthropic_key,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        }
        payload = {
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": MAX_TOKENS["researcher"],
            "system":     system_msg,
            "messages":   [{"role": "user", "content": user_msg}],
        }
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers, json=payload, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()["content"][0]["text"]

    def _parse(self, raw: str, query: str) -> Dict[str, Any]:
        clean = raw.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            return {
                "query":    query,
                "findings": [],
                "summary":  clean[:500],
                "data_gaps": ["Response was not structured JSON"],
            }

    def format_for_builder(self, research_results: List[Dict[str, Any]]) -> str:
        if not research_results:
            return "No research findings available."
        lines = ["## Research Evidence\n"]
        for r in research_results:
            lines.append(f"### Query: {r.get('query', 'Unknown')}")
            lines.append(f"**Summary:** {r.get('summary', 'No summary')}")
            for finding in r.get("findings", [])[:5]:
                lines.append(
                    f"- {finding.get('finding', '')} "
                    f"(Source: {finding.get('source', 'unknown')}, "
                    f"Confidence: {finding.get('confidence', 'unknown')})"
                )
            if r.get("data_gaps"):
                lines.append(f"**Gaps:** {', '.join(r['data_gaps'])}")
            lines.append("")
        return "\n".join(lines)
