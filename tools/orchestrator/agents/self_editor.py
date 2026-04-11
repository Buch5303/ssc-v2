"""
agents/self_editor.py — Claude self-edit pass.
Builder reviews its own output before sending to auditor.
Catches JSON errors, syntax errors, missing files, empty content.
Cuts correction loops from 3 passes to near-zero.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List

import requests

log = logging.getLogger("orchestrator.self_editor")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
SELF_EDIT_URL     = "https://api.anthropic.com/v1/messages"

SELF_EDIT_SYSTEM = """You are a senior software engineer reviewing your own code output.
You will receive a build output JSON and a list of acceptance criteria.
Your job is to:
1. Check every file has real content (not empty, not placeholder)
2. Verify Python files have valid syntax
3. Confirm all acceptance criteria are addressable by the files produced
4. Fix any issues you find by rewriting the affected file content

Return the corrected build output JSON. If everything is correct, return it unchanged.
Output ONLY valid JSON — no prose, no markdown fences."""


def self_edit(
    build_output:        Dict[str, Any],
    acceptance_criteria: List[str],
    directive_title:     str,
) -> Dict[str, Any]:
    """
    Claude reviews its own build output and fixes issues before audit.
    Returns corrected build_output dict.
    """
    if not ANTHROPIC_API_KEY:
        return build_output

    files = build_output.get("files", [])
    if not files:
        return build_output

    # Quick local checks first — catch obvious issues without API call
    issues = _local_checks(files)
    if not issues:
        log.debug("Self-edit: local checks passed — no API call needed")
        return build_output

    log.info("Self-edit: found %d issues — sending to Claude for correction", len(issues))

    prompt = f"""Task: {directive_title}

Acceptance Criteria:
{json.dumps(acceptance_criteria, indent=2)}

Issues detected:
{json.dumps(issues, indent=2)}

Current build output:
{json.dumps(build_output, indent=2)[:6000]}

Fix all issues and return the corrected build output JSON."""

    try:
        headers = {
            "x-api-key":         ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        }
        payload = {
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": 8000,
            "system":     SELF_EDIT_SYSTEM,
            "messages":   [{"role": "user", "content": prompt}],
        }
        r = requests.post(SELF_EDIT_URL, headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        raw = r.json()["content"][0]["text"].strip()

        # Strip fences
        if "```json" in raw:
            raw = raw[raw.find("```json")+7:raw.rfind("```")].strip()
        elif raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])

        corrected = json.loads(raw)
        log.info("Self-edit: corrections applied successfully")
        return corrected

    except Exception as e:
        log.warning("Self-edit API call failed: %s — using original output", e)
        return build_output


def _local_checks(files: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Fast local checks without API call."""
    issues = []
    for f in files:
        path    = f.get("path", "")
        content = f.get("content", "")

        if not content or len(content.strip()) < 20:
            issues.append({"file": path, "issue": "Empty or near-empty content"})
            continue

        if path.endswith(".py"):
            try:
                compile(content, path, "exec")
            except SyntaxError as e:
                issues.append({"file": path, "issue": f"SyntaxError: {e}"})

        if "TODO" in content and content.count("TODO") > 3:
            issues.append({"file": path, "issue": "Excessive TODO placeholders — content not implemented"})

        if content.strip() in ("pass", "...", "# placeholder"):
            issues.append({"file": path, "issue": "Placeholder content — not implemented"})

    return issues
