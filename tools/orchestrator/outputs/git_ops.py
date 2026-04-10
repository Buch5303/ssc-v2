"""
outputs/git_ops.py — Automated git commit and push.
Runs after each successful directive completion.
"""
from __future__ import annotations

import logging
import subprocess
from typing import Tuple

log = logging.getLogger("orchestrator.git_ops")


def commit_and_push(
    message:    str,
    branch:     str  = "frontend-only",
    repo_root:  str  = "/home/claude/ssc-v2",
    author:     str  = "Greg Buchanan <buch5303@gmail.com>",
) -> Tuple[bool, str]:
    """
    Stage all changes, commit, and push to the specified branch.
    Returns (success, commit_sha_or_error).
    """
    try:
        # Stage all
        r = subprocess.run(
            ["git", "add", "-A"],
            capture_output=True, text=True, cwd=repo_root,
        )
        if r.returncode != 0:
            return False, f"git add failed: {r.stderr}"

        # Check if there's anything to commit
        r = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            capture_output=True, cwd=repo_root,
        )
        if r.returncode == 0:
            log.info("Nothing to commit — working tree clean")
            sha = _get_current_sha(repo_root)
            return True, sha

        # Commit
        r = subprocess.run(
            ["git", "commit", "-m", message, f"--author={author}"],
            capture_output=True, text=True, cwd=repo_root,
        )
        if r.returncode != 0:
            return False, f"git commit failed: {r.stderr}"

        # Get SHA
        sha = _get_current_sha(repo_root)

        # Push
        r = subprocess.run(
            ["git", "push", "origin", branch],
            capture_output=True, text=True, cwd=repo_root,
        )
        if r.returncode != 0:
            log.warning("Push failed: %s", r.stderr)
            return True, sha   # commit succeeded even if push failed

        log.info("Committed and pushed: %s", sha)
        return True, sha

    except Exception as e:
        return False, str(e)


def _get_current_sha(repo_root: str) -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=repo_root,
        )
        return r.stdout.strip()
    except Exception:
        return "unknown"


def get_diff_summary(repo_root: str = "/home/claude/ssc-v2") -> str:
    """Get a summary of uncommitted changes."""
    try:
        r = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            capture_output=True, text=True, cwd=repo_root,
        )
        return r.stdout.strip() or "No changes"
    except Exception as e:
        return f"Could not get diff: {e}"
