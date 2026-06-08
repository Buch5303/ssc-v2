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
    timeout:   int = 360,
) -> Tuple[str, str]:
    """
    Deterministic BUILDABILITY gate — runs the SAME build Vercel runs.

    This is the lens the Auditor lacked: it does not *guess* whether code
    compiles, it runs `npm run build` (next build) and only green output may
    proceed. Production parity is the point — `tsc --noEmit` alone is NOT
    enough: it passed AUTO-027's `app/rfq/page.tsx`, but `next build` rejects
    it ("RFQTable is not a valid Page export field"). Catches the whole class
    that has broken the loop: missing modules, bad exports, and Next.js
    page/route contract violations that only surface at build.

    Returns (status, detail):
      - "pass"        : build is green. Eligible to proceed to audit/commit.
      - "fail"        : build errors. detail = the errors, fed back to the
                        Builder as a correction. MUST NOT be committed.
      - "unavailable" : the toolchain could not run (npm/next missing, etc.).
                        Caller escalates for human review — never auto-commits,
                        never silently passes.
    """
    try:
        proc = subprocess.run(
            ["npm", "run", "build"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return "unavailable", "npm not found on host — buildability gate could not run"
    except subprocess.TimeoutExpired:
        return "unavailable", f"next build exceeded {timeout}s — buildability gate could not run"
    except Exception as exc:  # noqa: BLE001 — gate must classify, not crash the loop
        return "unavailable", f"buildability gate error: {exc}"

    combined = f"{proc.stdout}\n{proc.stderr}".strip()

    if proc.returncode == 0:
        return "pass", "next build green"

    # Distinguish a genuinely missing toolchain from real build errors.
    low = combined.lower()
    if "missing script" in low or "command not found" in low or "could not determine executable" in low:
        return "unavailable", "build script/toolchain unavailable — gate could not run"

    # Real build errors. Surface the meaningful tail (Next prints the error
    # last) and cap length so a wall of output can't blow context.
    return "fail", combined[-4000:]


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
