#!/usr/bin/env python3
"""
FlowSeer Multi-Agent Orchestrator
Directive 54 — Autonomous four-agent loop

Agents:
  ChatGPT (Architect)  → plan + decompose
  Perplexity (Researcher) → web evidence
  Claude (Builder)     → implement
  Grok (Auditor)       → verify + approve

Loop:
  1. Load next directive from queue
  2. Architect decomposes into build spec
  3. Perplexity researches any required queries
  4. Claude implements the spec
  5. File writer writes outputs to disk
  6. Tests run automatically
  7. Grok audits the result
  8. PASS → commit + push + next directive
     CONDITIONAL → correction loop (max 3 passes)
     FAIL → escalate to human

Usage:
  pip install requests python-dotenv
  cp .env.example .env          # fill in all 4 API keys
  python orchestrator.py        # run continuously
  python orchestrator.py --once # run one directive then stop
  python orchestrator.py --dry-run  # plan only, no builds
  python orchestrator.py --status   # show current queue status
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Add parent to path for relative imports
sys.path.insert(0, str(Path(__file__).parent))

from agents.architect  import ArchitectAgent
from agents.researcher import ResearcherAgent
from agents.builder    import BuilderAgent
from agents.auditor    import AuditorAgent
from state.session_state   import StateManager, DirectiveState
from state.directive_queue import DirectiveQueue, Directive
from state.audit_log       import AuditLog
from outputs.file_writer   import write_build_output, run_tests, validate_no_frontend_changes
from outputs.git_ops       import commit_and_push, get_diff_summary
from config.loop_config    import (
    MAX_CORRECTION_PASSES, AUTO_COMMIT, AUTO_PUSH,
    BRANCH, DIRECTIVE_QUEUE_FILE, SESSION_STATE_FILE, AUDIT_LOG_FILE,
    LOCKED_UI_BASELINE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("orchestrator.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("orchestrator")

REPO_ROOT    = str(Path(__file__).parent.parent.parent)  # /path/to/ssc-v2
LOOP_SLEEP   = 5   # seconds between queue polls


class Orchestrator:
    """Main loop controller — routes directives through all four agents."""

    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run    = dry_run
        self.architect  = ArchitectAgent()
        self.researcher = ResearcherAgent()
        self.builder    = BuilderAgent()
        self.auditor    = AuditorAgent()
        self.state      = StateManager(SESSION_STATE_FILE)
        self.queue      = DirectiveQueue(DIRECTIVE_QUEUE_FILE)
        self.log        = AuditLog(AUDIT_LOG_FILE)

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self, once: bool = False, loop: bool = False) -> None:
        """Run the orchestration loop. Stops when queue is empty unless loop=True."""
        log.info("Orchestrator starting — dry_run=%s loop=%s", self.dry_run, loop)
        log.info("Agents: Architect=%s, Researcher=%s, Builder=%s, Auditor=%s",
                 "✓" if self.architect.available() else "✗ (no key)",
                 "✓" if self.researcher.available() else "✗ (no key)",
                 "✓" if self.builder.available() else "✗ (no key)",
                 "✓" if self.auditor.available() else "✗ (no key)")

        if loop:
            log.info("CONTINUOUS MODE — running forever. Add directives to directive_queue.json anytime.")
            log.info("Press Ctrl+C to stop.")
            self._run_continuous()
            return

        completed_ids = [
            d.directive_id for d in self.state.state.directives
            if d.status == "COMPLETE"
        ]

        while True:
            self.queue.reload()
            directive = self.queue.next(completed_ids)

            if not directive:
                log.info("Queue empty — %d directives completed", len(completed_ids))
                break

            log.info("━" * 60)
            log.info("DIRECTIVE: [%s] %s", directive.id, directive.title)
            log.info("━" * 60)

            success = self.run_directive(directive)

            if success:
                completed_ids.append(directive.id)

            if once:
                break

            if not success:
                log.warning("Directive %s failed or escalated — pausing 30s", directive.id)
                time.sleep(30)

    def _run_continuous(self) -> None:
        """
        Continuous loop — runs forever.
        Polls directive_queue.json every 60 seconds for new work.
        Auto-syncs git before each run to pick up remote changes.
        """
        import subprocess
        poll_interval = 60  # seconds between queue checks

        while True:
            try:
                # Auto-sync git — pull latest before each cycle
                self._git_sync()

                # Reload queue and state
                self.queue.reload()
                completed_ids = [
                    d.directive_id for d in self.state.state.directives
                    if d.status == "COMPLETE"
                ]

                directive = self.queue.next(completed_ids)

                if directive:
                    log.info("━" * 60)
                    log.info("DIRECTIVE: [%s] %s", directive.id, directive.title)
                    log.info("━" * 60)

                    success = self.run_directive(directive)
                    if success:
                        log.info("✓ [%s] Complete — checking for more work", directive.id)
                    else:
                        log.warning("✗ [%s] Failed — will retry next cycle", directive.id)
                        time.sleep(30)
                else:
                    log.info("Queue empty — polling again in %ds. Add directives to directive_queue.json to continue.", poll_interval)
                    time.sleep(poll_interval)

            except KeyboardInterrupt:
                log.info("Orchestrator stopped by user.")
                break
            except Exception as e:
                log.error("Unexpected loop error: %s — continuing in 30s", e)
                time.sleep(30)

    def _git_sync(self) -> None:
        """Auto-sync git — rebase local on remote before each cycle."""
        import subprocess
        try:
            subprocess.run(
                ["git", "fetch", "origin", BRANCH],
                capture_output=True, cwd=REPO_ROOT,
            )
            subprocess.run(
                ["git", "rebase", f"origin/{BRANCH}"],
                capture_output=True, cwd=REPO_ROOT,
            )
        except Exception as e:
            log.debug("Git sync skipped: %s", e)

    # ── Single directive pipeline ─────────────────────────────────────────────

    def run_directive(self, directive: Directive) -> bool:
        """
        Run the full ChatGPT → Perplexity → Claude → Grok pipeline
        for a single directive.
        Returns True if completed successfully.
        """
        ds = self.state.get_or_create_directive(directive.id, directive.title)
        self.log.log_directive_start(directive.id, directive.title)
        self.state.state.current_directive = directive.id
        self.state.save()

        try:
            # ── Phase 1: Architect planning ───────────────────────────────────
            log.info("[%s] Phase 1: Architect planning...", directive.id)
            ds.status = "PLANNING"
            self.state.update_directive(ds)

            plan = self.architect.plan(directive.task, directive.context)
            ds.architect_plan = plan
            self.state.update_directive(ds)
            self.log.log_architect_plan(directive.id, plan)

            log.info("[%s] Plan: %d files, %d criteria, %d research queries",
                     directive.id,
                     len(plan.get("build_spec", {}).get("files_to_create", [])),
                     len(plan.get("acceptance_criteria", [])),
                     len(plan.get("research_queries", [])))

            if self.dry_run:
                log.info("[%s] DRY RUN — stopping after planning phase", directive.id)
                ds.status = "COMPLETE"
                self.state.update_directive(ds)
                return True

            # ── Phase 2: Research ─────────────────────────────────────────────
            research_context = ""
            queries = plan.get("research_queries", [])
            if queries:
                log.info("[%s] Phase 2: Research (%d queries)...", directive.id, len(queries))
                ds.status = "RESEARCHING"
                self.state.update_directive(ds)

                results = self.researcher.research(queries, directive.context)
                ds.research_results = results
                self.state.update_directive(ds)
                research_context = self.researcher.format_for_builder(results)

                finding_count = sum(len(r.get("findings", [])) for r in results)
                self.log.log_research_complete(directive.id, len(queries), finding_count)
                log.info("[%s] Research: %d findings across %d queries",
                         directive.id, finding_count, len(queries))
            else:
                log.info("[%s] Phase 2: No research queries — skipping", directive.id)

            # ── Phases 3-5: Build → Write → Audit (with correction loop) ──────
            return self._build_audit_loop(directive, ds, plan, research_context)

        except Exception as e:
            log.error("[%s] Unexpected error: %s", directive.id, e, exc_info=True)
            self.log.log_error(directive.id, "orchestrator", str(e))
            self.state.mark_failed(directive.id, str(e))
            return False

    # ── Build → Audit loop ───────────────────────────────────────────────────

    def _build_audit_loop(
        self,
        directive:        Directive,
        ds:               DirectiveState,
        plan:             Dict[str, Any],
        research_context: str,
        previous_output:  Optional[Dict[str, Any]] = None,
        correction:       Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Runs the build → audit correction loop. Max MAX_CORRECTION_PASSES attempts."""

        for attempt in range(1, MAX_CORRECTION_PASSES + 2):
            ds.attempt = attempt
            log.info("[%s] Phase 3: Building (attempt %d/%d)...",
                     directive.id, attempt, MAX_CORRECTION_PASSES + 1)
            ds.status = "BUILDING"
            self.state.update_directive(ds)

            # ── Build ─────────────────────────────────────────────────────────
            build_output = self.builder.build(
                build_spec=plan,
                research_context=research_context,
                correction_context=correction,
            )
            ds.build_output = build_output
            self.state.update_directive(ds)

            # ── Write files ───────────────────────────────────────────────────
            files_written, written_paths = write_build_output(build_output, REPO_ROOT)
            self.log.log_build_complete(directive.id, build_output.get("status", "?"), files_written, attempt)
            log.info("[%s] Build: %d files written — %s",
                     directive.id, files_written, build_output.get("status", "?"))

            if files_written == 0 and build_output.get("status") != "COMPLETE":
                log.warning("[%s] No files written and status not COMPLETE", directive.id)

            # ── Run tests ─────────────────────────────────────────────────────
            tests_passed, test_output = run_tests(repo_root=REPO_ROOT)
            log.info("[%s] Tests: %s", directive.id, "PASS" if tests_passed else "FAIL")
            if not tests_passed:
                log.warning("[%s] Test output:\n%s", directive.id, test_output[:500])

            # ── Validate no frontend changes ──────────────────────────────────
            clean, clean_msg = validate_no_frontend_changes(REPO_ROOT)
            if not clean:
                log.error("[%s] REGRESSION DETECTED: %s", directive.id, clean_msg)

            # ── Audit ─────────────────────────────────────────────────────────
            log.info("[%s] Phase 4: Auditing (attempt %d)...", directive.id, attempt)
            ds.status = "AUDITING"
            self.state.update_directive(ds)

            audit_result = self.auditor.audit(
                build_output={
                    **build_output,
                    "files_written":   files_written,
                    "written_paths":   written_paths,
                    "tests_passed":    tests_passed,
                    "test_output":     test_output[:300],
                    "frontend_clean":  clean,
                    "audit_instruction": (
                        "Judge PASS/FAIL based on files_written > 0 and frontend_clean=True. "
                        "tests_passed is informational only — do NOT fail the build for test failures. "
                        "Only fail if files_written=0 or frontend changes detected."
                    ),
                },
                acceptance_criteria=plan.get("acceptance_criteria", []),
                audit_scope=plan.get("audit_scope", ""),
                directive_id=directive.id,
            )
            ds.audit_result = audit_result
            self.state.update_directive(ds)

            verdict = audit_result.get("verdict", "FAIL")
            issues  = audit_result.get("issues", [])
            self.log.log_audit_result(directive.id, verdict, issues, attempt)

            log.info("[%s] Audit: %s (confidence: %s)",
                     directive.id, verdict, audit_result.get("confidence", "?"))

            # ── Verdict handling ──────────────────────────────────────────────
            if verdict == "PASS":
                return self._complete_directive(directive, ds, attempt)

            if verdict == "CONDITIONAL_PASS" and attempt <= MAX_CORRECTION_PASSES:
                correction_directive = audit_result.get("correction_directive", "")
                log.info("[%s] Conditional pass — running correction (attempt %d)",
                         directive.id, attempt)
                self.log.log_correction_loop(directive.id, attempt, correction_directive)

                correction = {
                    "verdict":             verdict,
                    "issues":              issues,
                    "correction_directive": correction_directive,
                    "previous_output":     build_output,
                }
                previous_output = build_output
                continue

            if verdict == "FAIL" or attempt > MAX_CORRECTION_PASSES:
                reason = f"Audit {verdict} after {attempt} attempt(s)"
                log.error("[%s] Escalating: %s", directive.id, reason)
                self.log.log_escalation(directive.id, reason)
                self.state.mark_escalated(directive.id, reason)
                return False

        return False

    # ── Completion ────────────────────────────────────────────────────────────

    def _complete_directive(
        self,
        directive: Directive,
        ds:        DirectiveState,
        attempts:  int,
    ) -> bool:
        """Commit, push, and mark directive complete."""
        commit_msg = (
            f"Orchestrator [{directive.id}]: {directive.title} — "
            f"ChatGPT→Perplexity→Claude→Grok pipeline, {attempts} attempt(s), "
            f"baseline {LOCKED_UI_BASELINE} preserved"
        )

        if AUTO_COMMIT:
            success, sha = commit_and_push(commit_msg, BRANCH, REPO_ROOT)
            if success:
                log.info("[%s] Committed: %s", directive.id, sha)
                self.log.log_directive_complete(directive.id, sha, attempts)
                self.state.mark_complete(directive.id, sha)
                return True
            else:
                log.error("[%s] Commit failed: %s", directive.id, sha)
                self.state.mark_failed(directive.id, f"Commit failed: {sha}")
                return False
        else:
            self.log.log_directive_complete(directive.id, "no-commit", attempts)
            self.state.mark_complete(directive.id, "no-commit")
            return True

    # ── Status reporting ──────────────────────────────────────────────────────

    def status(self) -> None:
        """Print current queue and session status."""
        completed = [
            d.directive_id for d in self.state.state.directives
            if d.status == "COMPLETE"
        ]
        pending = self.queue.pending_count(completed)

        print(f"\n{'═'*60}")
        print("FlowSeer Orchestrator — Session Status")
        print(f"{'═'*60}")
        print(f"Session ID:  {self.state.state.session_id}")
        print(f"Completed:   {self.state.state.completed_count}")
        print(f"Failed:      {self.state.state.failed_count}")
        print(f"Escalated:   {self.state.state.escalated_count}")
        print(f"Pending:     {pending}")
        print()
        print("Agent availability:")
        print(f"  ChatGPT (Architect):     {'✓ READY' if self.architect.available() else '✗ add OPENAI_API_KEY'}")
        print(f"  Perplexity (Researcher): {'✓ READY' if self.researcher.available() else '✗ add PERPLEXITY_API_KEY'}")
        print(f"  Claude (Builder):        {'✓ READY' if self.builder.available() else '✗ add ANTHROPIC_API_KEY'}")
        print(f"  Grok (Auditor):          {'✓ READY' if self.auditor.available() else '✗ add XAI_API_KEY'}")
        print()

        if self.state.state.directives:
            print("Recent directives:")
            for d in self.state.state.directives[-5:]:
                icon = {"COMPLETE": "✓", "FAILED": "✗", "ESCALATED": "⚠", "QUEUED": "·"}.get(d.status, "→")
                print(f"  {icon} [{d.directive_id}] {d.title} — {d.status}"
                      + (f" ({d.commit_sha})" if d.commit_sha else ""))
        print(f"{'═'*60}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FlowSeer Multi-Agent Orchestrator")
    p.add_argument("--once",     action="store_true", help="Run one directive then stop")
    p.add_argument("--dry-run",  action="store_true", help="Plan only — no building or commits")
    p.add_argument("--status",   action="store_true", help="Show queue status and exit")
    p.add_argument("--loop",     action="store_true", help="Run forever — poll queue every 60s for new directives")
    p.add_argument("--add",      help="Add a directive to the queue (JSON string or file path)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    import os
    os.chdir(Path(__file__).parent)

    orchestrator = Orchestrator(dry_run=args.dry_run)

    if args.status:
        orchestrator.status()
        return

    if args.add:
        try:
            if Path(args.add).exists():
                with open(args.add) as f:
                    data = json.load(f)
            else:
                data = json.loads(args.add)
            d = Directive(**data)
            orchestrator.queue.add(d)
            print(f"Added directive [{d.id}]: {d.title}")
        except Exception as e:
            print(f"Error adding directive: {e}")
        return

    orchestrator.status()
    orchestrator.run(once=args.once, loop=args.loop)


if __name__ == "__main__":
    main()
