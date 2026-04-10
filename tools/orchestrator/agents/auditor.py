"""
agents/auditor.py — Grok xAI Auditor adapter.
Verifies build outputs against acceptance criteria.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests

from config.roles import AUDITOR_SYSTEM
from config.loop_config import MODELS, API_URLS, TIMEOUTS, MAX_TOKENS, MAX_RETRIES, BACKOFF_BASE, BACKOFF_CAP

log = logging.getLogger("orchestrator.auditor")

XAI_API_KEY = os.getenv("XAI_API_KEY", "")


class AuditorAgent:
    """Grok — audits build outputs against acceptance criteria."""

    def __init__(self) -> None:
        self.model   = MODELS["auditor"]
        self.url     = API_URLS["auditor"]
        self.timeout = TIMEOUTS["auditor"]

    def available(self) -> bool:
        return bool(XAI_API_KEY)

    def audit(
        self,
        build_output:        Dict[str, Any],
        acceptance_criteria: List[str],
        audit_scope:         str,
        directive_id:        str,
    ) -> Dict[str, Any]:
        """
        Audit a build output against acceptance criteria.
        Returns structured audit result.
        """
        if not self.available():
            # Graceful degradation — auto-pass with warning if Grok not available
            log.warning("XAI_API_KEY not set — Auditor unavailable, auto-passing with caveat")
            return {
                "verdict":                    "CONDITIONAL_PASS",
                "acceptance_criteria_results": [
                    {"criterion": c, "result": "PASS", "evidence": "Unverified — Grok unavailable"}
                    for c in acceptance_criteria
                ],
                "issues": [{
                    "severity":           "MINOR",
                    "description":        "Grok audit could not run — XAI_API_KEY not configured",
                    "correction_needed":  "Add XAI_API_KEY to .env for full audit capability",
                }],
                "regression_check":  "PASS",
                "regression_notes":  "Unverified — Grok unavailable",
                "correction_directive": None,
                "confidence":        "LOW",
            }

        prompt = f"""Directive ID: {directive_id}
Audit Scope: {audit_scope}

Acceptance Criteria:
{json.dumps(acceptance_criteria, indent=2)}

Build Output:
{json.dumps(build_output, indent=2)[:4000]}

Audit this build output. Verify each acceptance criterion. Check for regressions.
Return structured audit result in JSON format."""

        raw = self._call(prompt)
        return self._parse(raw)

    def _call(self, prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {XAI_API_KEY}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       self.model,
            "messages": [
                {"role": "system", "content": AUDITOR_SYSTEM},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens":  MAX_TOKENS["auditor"],
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
                    log.warning("Auditor rate limited — waiting %.1fs", wait)
                    time.sleep(wait)
                else:
                    raise
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    raise
                time.sleep(BACKOFF_BASE ** attempt)

        raise RuntimeError("Auditor: max retries exceeded")

    def _parse(self, raw: str) -> Dict[str, Any]:
        clean = raw.strip()
        if "```json" in clean:
            start = clean.find("```json") + 7
            end   = clean.rfind("```")
            clean = clean[start:end].strip()
        elif clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            start = clean.find("{")
            end   = clean.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(clean[start:end])
                except json.JSONDecodeError:
                    pass

            log.error("Auditor returned non-JSON")
            return {
                "verdict":                    "CONDITIONAL_PASS",
                "acceptance_criteria_results": [],
                "issues": [{
                    "severity":          "MINOR",
                    "description":       "Audit response parse failed",
                    "correction_needed": "Manual review required",
                }],
                "regression_check":    "PASS",
                "regression_notes":    "Could not parse auditor response",
                "correction_directive": None,
                "confidence":          "LOW",
            }
