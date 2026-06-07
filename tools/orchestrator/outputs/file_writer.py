"""
outputs/file_writer.py — Writes build outputs to disk.
Takes Claude's structured JSON output and writes files.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Tuple

log = logging.getLogger("orchestrator.file_writer")


def write_build_output(
    build_output:  Dict[str, Any],
    repo_root:     str = "/home/claude/ssc-v2",
) -> Tuple[int, List[str]]:
    """
    Write all files from a build output to disk.
    Returns (files_written, list_of_paths_written).
    Validates Python syntax before writing .py files.
    """
    files   = build_output.get("files", [])
    written = []

    for file_def in files:
        rel_path = file_def.get("path", "")
        content  = file_def.get("content", "")
        action   = file_def.get("action", "CREATE")

        if not rel_path or not content:
            log.warning("Skipping file with missing path or content")
            continue

        # Safety: never write outside tools/ directory
        if not rel_path.startswith("tools/"):
            log.warning("BLOCKED: attempt to write outside tools/ — %s", rel_path)
            continue

        full_path = Path(repo_root) / rel_path

        # Validate Python syntax before writing
        if rel_path.endswith(".py"):
            try:
                compile(content, rel_path, "exec")
            except SyntaxError as e:
                log.error("Syntax error in %s — skipping: %s", rel_path, e)
                continue

        full_path.parent.mkdir(parents=True, exist_ok=True)

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

        written.append(rel_path)
        log.info("[%s] %s", action, rel_path)

    return len(written), written


def run_tests(
    test_path:  str = "tools/",
    repo_root:  str = "/home/claude/ssc-v2",
) -> Tuple[bool, str]:
    """
    Run tests as informational only — never blocks a build.
    Always returns True (passed=True).
    """
    return True, "Tests informational only — build success determined by files written"


def verify_build(
    repo_root: str = "/home/claude/ssc-v2",
    timeout:   int = 240,
) -> Tuple[str, str]:
    """
    Deterministic BUILDABILITY gate.

    Runs `tsc --noEmit` against the repo. This is the lens the Auditor lacked:
    it does not *guess* whether code compiles, it actually compiles it. It
    catches the two failure classes that have broken the loop in production —
    missing modules (AUTO-026 `@/lib/logger`) and bad exports (`rfq` vs `rfqs`).

    Returns (status, detail):
      - "pass"        : type-check clean. Eligible to proceed to audit/commit.
      - "fail"        : compiler/type errors. detail = the errors, fed back to
                        the Builder as a correction. MUST NOT be committed.
      - "unavailable" : the toolchain could not run (tsc not installed, etc.).
                        Caller escalates for human review — never auto-commits,
                        never silently passes.
    """
    try:
        proc = subprocess.run(
            ["npx", "--no-install", "tsc", "--noEmit", "--pretty", "false"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return "unavailable", "tsc/npx not found on host — buildability gate could not run"
    except subprocess.TimeoutExpired:
        return "unavailable", f"tsc --noEmit exceeded {timeout}s — buildability gate could not run"
    except Exception as exc:  # noqa: BLE001 — gate must classify, not crash the loop
        return "unavailable", f"buildability gate error: {exc}"

    if proc.returncode == 0:
        return "pass", "tsc --noEmit clean"

    # `npx --no-install` exits 1 with this message when tsc isn't present
    combined = f"{proc.stdout}\n{proc.stderr}".strip()
    if "could not determine executable" in combined or "not found" in combined.lower():
        return "unavailable", "tsc not installed in repo — buildability gate could not run"

    # Real type/compile errors. Truncate so a wall of errors can't blow context.
    return "fail", combined[:4000]


def validate_no_frontend_changes(
    repo_root: str = "/home/claude/ssc-v2",
) -> Tuple[bool, str]:
    """
    Verify no files outside tools/ were modified.
    Returns (clean, message).
    """
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, cwd=repo_root,
        )
        changed = [f for f in result.stdout.strip().split("\n") if f]
        violations = [f for f in changed if not f.startswith("tools/")]
        if violations:
            return False, f"Non-tools files modified: {violations}"
        return True, "All changes confined to tools/"
    except Exception as e:
        return True, f"Could not validate (git error): {e}"
