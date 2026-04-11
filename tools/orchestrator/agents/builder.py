"""
agents/builder.py — Claude Opus Builder adapter.
Implements build specifications produced by the Architect.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests

from config.roles import BUILDER_SYSTEM, CORRECTION_PROMPT
from config.loop_config import MODELS, TIMEOUTS, MAX_TOKENS, MAX_RETRIES, BACKOFF_BASE, BACKOFF_CAP

log = logging.getLogger("orchestrator.builder")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
BUILDER_URL       = "https://api.anthropic.com/v1/messages"


class BuilderAgent:
    """Claude Opus — implements build specifications."""

    def __init__(self) -> None:
        self.model   = MODELS["builder"]
        self.timeout = TIMEOUTS["builder"]

    def available(self) -> bool:
        return bool(ANTHROPIC_API_KEY)

    def build(
        self,
        build_spec: Dict[str, Any],
        research_context: str = "",
        correction_context: Optional[Dict[str, Any]] = None,
        acceptance_criteria: list = None,
    ) -> Dict[str, Any]:
        """
        Given a build spec and optional research context, implement the directive.
        Runs self-edit pass before returning to catch issues early.
        """
        if not self.available():
            raise RuntimeError("ANTHROPIC_API_KEY not set — Builder unavailable")

        if correction_context:
            prompt = CORRECTION_PROMPT.format(
                verdict=correction_context["verdict"],
                issues=json.dumps(correction_context["issues"], indent=2),
                correction_directive=correction_context["correction_directive"],
                previous_output=json.dumps(correction_context["previous_output"], indent=2)[:3000],
            )
        else:
            spec_str = json.dumps(build_spec, indent=2)
            prompt = f"""Build Specification:
{spec_str}

Research Evidence:
{research_context if research_context else 'No research evidence — build from specification only.'}

Implement this specification exactly. Return complete file contents for all files."""

        raw    = self._call(prompt)
        result = self._parse(raw)

        # Self-edit pass — catch issues before audit
        if result.get("files") and acceptance_criteria:
            from agents.self_editor import self_edit
            result = self_edit(
                result,
                acceptance_criteria,
                build_spec.get("title", ""),
            )

        return result

    def _call(self, prompt: str) -> str:
        headers = {
            "x-api-key":         ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        }
        payload = {
            "model":      self.model,
            "max_tokens": MAX_TOKENS["builder"],
            "system":     BUILDER_SYSTEM,
            "messages":   [{"role": "user", "content": prompt}],
        }

        for attempt in range(MAX_RETRIES):
            try:
                r = requests.post(BUILDER_URL, headers=headers, json=payload, timeout=self.timeout)
                r.raise_for_status()
                content = r.json()["content"]
                # Extract text from content blocks
                return " ".join(
                    block["text"] for block in content
                    if block.get("type") == "text"
                )
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    wait = min(BACKOFF_BASE ** (attempt + 1), BACKOFF_CAP)
                    log.warning("Builder rate limited — waiting %.1fs", wait)
                    time.sleep(wait)
                elif e.response.status_code == 529:
                    wait = min(BACKOFF_BASE ** (attempt + 2), BACKOFF_CAP)
                    log.warning("Builder overloaded — waiting %.1fs", wait)
                    time.sleep(wait)
                else:
                    raise
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    raise
                time.sleep(BACKOFF_BASE ** attempt)

        raise RuntimeError("Builder: max retries exceeded")

    def _parse(self, raw: str) -> Dict[str, Any]:
        clean = raw.strip()
        # Strip markdown fences
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
            # Try extracting JSON object from prose
            start = clean.find("{")
            end   = clean.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(clean[start:end])
                except json.JSONDecodeError:
                    pass

        # Last resort — builder returned prose/code directly
        # Wrap it as a file so the orchestrator can still write something
        log.warning("Builder returned non-JSON — wrapping raw content as fallback file")
        # Try to detect what file this might be
        first_line = clean.split("\n")[0] if clean else ""
        if "python" in first_line.lower() or clean.startswith("import ") or clean.startswith("def ") or clean.startswith("#!/"):
            path = "tools/output/builder_output.py"
        elif clean.startswith("#") or "markdown" in first_line.lower():
            path = "tools/output/builder_output.md"
        else:
            path = "tools/output/builder_output.txt"

        return {
            "status": "COMPLETE",
            "files": [{"path": path, "action": "CREATE", "content": clean}],
            "test_results": "Recovered from non-JSON response",
            "blockers": [],
            "notes": "Builder returned non-JSON — content extracted and wrapped",
        }
