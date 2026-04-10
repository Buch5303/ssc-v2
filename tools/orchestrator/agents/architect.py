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
                    raise
                time.sleep(BACKOFF_BASE ** attempt)

        raise RuntimeError("Architect: max retries exceeded")

    def _parse(self, raw: str) -> Dict[str, Any]:
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            log.error("Architect returned invalid JSON: %s", raw[:200])
            raise RuntimeError(f"Architect JSON parse failed: {e}")
