"""
agents/researcher.py — Perplexity sonar-pro Research adapter.
Web-grounded evidence gathering for pricing, contacts, regulatory data.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests

from config.roles import RESEARCHER_SYSTEM
from config.loop_config import MODELS, API_URLS, TIMEOUTS, MAX_TOKENS, MAX_RETRIES, BACKOFF_BASE, BACKOFF_CAP

log = logging.getLogger("orchestrator.researcher")

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")


class ResearcherAgent:
    """Perplexity sonar-pro — web-grounded evidence gathering."""

    def __init__(self) -> None:
        self.model   = MODELS["researcher"]
        self.url     = API_URLS["researcher"]
        self.timeout = TIMEOUTS["researcher"]

    def available(self) -> bool:
        return bool(PERPLEXITY_API_KEY)

    def research(self, queries: List[str], context: str = "") -> List[Dict[str, Any]]:
        """
        Run multiple research queries in sequence.
        Returns list of findings dicts.
        Skips gracefully if not available — research is optional.
        """
        if not self.available():
            log.info("Perplexity not available — skipping research phase")
            return []

        results = []
        for query in queries:
            try:
                result = self._research_one(query, context)
                results.append(result)
                time.sleep(1.0)   # respect rate limits
            except Exception as e:
                log.warning("Research query failed: %s — %s", query[:80], e)
                results.append({
                    "query":    query,
                    "findings": [],
                    "summary":  f"Research unavailable: {e}",
                    "data_gaps": ["Query failed — manual research required"],
                })

        return results

    def _research_one(self, query: str, context: str = "") -> Dict[str, Any]:
        """Research a single query. Returns parsed findings dict."""
        messages = [
            {"role": "system", "content": RESEARCHER_SYSTEM},
            {"role": "user",   "content": f"Research query: {query}\n\nContext: {context}" if context else f"Research query: {query}"},
        ]

        raw = self._call(messages)
        return self._parse(raw, query)

    def _call(self, messages: list) -> str:
        headers = {
            "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       self.model,
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
                    raise
                time.sleep(BACKOFF_BASE ** attempt)

        raise RuntimeError("Researcher: max retries exceeded")

    def _parse(self, raw: str, query: str) -> Dict[str, Any]:
        # Strip markdown fences if present
        clean = raw.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            # Return graceful degradation if Perplexity returns prose
            log.warning("Researcher returned non-JSON — wrapping as summary")
            return {
                "query":    query,
                "findings": [],
                "summary":  clean[:500],
                "data_gaps": ["Response was not structured JSON"],
            }

    def format_for_builder(self, research_results: List[Dict[str, Any]]) -> str:
        """Format research findings into a builder-readable context string."""
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
                lines.append(f"**Data gaps:** {', '.join(r['data_gaps'])}")
            lines.append("")

        return "\n".join(lines)
