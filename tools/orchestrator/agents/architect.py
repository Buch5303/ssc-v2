"""
agents/architect.py — ChatGPT GPT-4o Architect adapter.
Decomposes high-level tasks into precise build specifications.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, Optional

import requests

from config.roles import ARCHITECT_SYSTEM
from config.loop_config import MODELS, API_URLS, TIMEOUTS, MAX_TOKENS, MAX_RETRIES, BACKOFF_BASE, BACKOFF_CAP

log = logging.getLogger("orchestrator.architect")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


class ArchitectAgent:
    """ChatGPT GPT-4o — decomposes directives into build specs."""

    def __init__(self) -> None:
        self.model   = MODELS["architect"]
        self.url     = API_URLS["architect"]
        self.timeout = TIMEOUTS["architect"]

    def available(self) -> bool:
        return bool(OPENAI_API_KEY)

    def plan(self, task: str, context: str = "") -> Dict[str, Any]:
        """
        Given a task description, return a structured build plan.
        Returns parsed JSON dict or raises on failure.
        """
        if not self.available():
            raise RuntimeError("OPENAI_API_KEY not set — Architect unavailable")

        messages = [
            {"role": "system", "content": ARCHITECT_SYSTEM},
            {"role": "user",   "content": f"Task: {task}\n\nContext:\n{context}" if context else f"Task: {task}"},
        ]

        response = self._call(messages)
        return self._parse(response)

    def _call(self, messages: list) -> str:
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       self.model,
            "messages":    messages,
            "max_tokens":  MAX_TOKENS["architect"],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }

        for attempt in range(MAX_RETRIES):
            try:
                r = requests.post(self.url, headers=headers, json=payload, timeout=self.timeout)
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    wait = min(BACKOFF_BASE ** (attempt + 1), BACKOFF_CAP)
                    log.warning("Architect rate limited — waiting %.1fs", wait)
                    time.sleep(wait)
                else:
                    raise
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    log.warning("OpenAI unreachable — falling back to Claude as Architect")
                    return self._call_claude_fallback(messages)
                time.sleep(BACKOFF_BASE ** attempt)

        log.warning("OpenAI max retries — falling back to Claude as Architect")
        return self._call_claude_fallback(messages)

    def _call_claude_fallback(self, messages: list) -> str:
        """Use Claude as Architect fallback when OpenAI is unreachable."""
        import os
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not anthropic_key:
            raise RuntimeError("Architect: OpenAI unreachable and no ANTHROPIC_API_KEY fallback")

        # Convert OpenAI message format to Anthropic format
        system_msg = next((m["content"] for m in messages if m["role"] == "system"), ARCHITECT_SYSTEM)
        user_msg   = next((m["content"] for m in messages if m["role"] == "user"), "")

        headers = {
            "x-api-key":         anthropic_key,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        }
        payload = {
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": MAX_TOKENS["architect"],
            "system":     system_msg,
            "messages":   [{"role": "user", "content": user_msg}],
        }
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers, json=payload, timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()["content"][0]["text"]

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

        log.error("Architect returned invalid JSON: %s", raw[:200])
        raise RuntimeError(f"Architect JSON parse failed — could not extract valid JSON from response")
