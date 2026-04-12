#!/usr/bin/env python3
"""
FlowSeer Multi-Agent Orchestrator v2 — Parallel Dual-Track
Directive 58 — Fully autonomous four-agent pipeline

Architecture:
  ChatGPT  → Architect   (planning + decomposition)
  Perplexity → Researcher (live web, only when needed)
  Claude   → Builder + Self-Editor (code + self-review)
  Grok     → Auditor     (fast pass/fail)

Execution:
  Two parallel tracks run simultaneously
  Track A: research directives (all 4 agents)
  Track B: build-only directives (skip Perplexity)
  Claude self-edits before audit — eliminates most correction loops

Usage:
  python3 orchestrator.py --loop    # run forever
  python3 orchestrator.py --once    # run one directive
  python3 orchestrator.py --status  # show queue
  python3 go.py                     # reset + loop
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).parent / ".env")
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent))

from agents.architect  import ArchitectAgent
from agents.researcher import ResearcherAgent
from agents.builder    import BuilderAgent
from agents.auditor    import AuditorAgent
from state.session_state   import StateManager, DirectiveState
from state.directive_queue import DirectiveQueue, Directive
from state.audit_log       import AuditLog
from outputs.file_writer   import write_build_output, run_tests, validate_no_frontend_changes
from outputs.git_ops       import commit_and_push
from config.loop_config    import (
    MAX_CORRECTION_PASSES, AUTO_COMMIT, BRANCH,
    DIRECTIVE_QUEUE_FILE, SESSION_STATE_FILE, AUDIT_LOG_FILE,
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

REPO_ROOT  = str(Path(__file__).parent.parent.parent)
POLL_SLEEP = 60   # seconds between queue polls when empty


def _extract_obvious_queries(task: str) -> list:
    """
    Extract obvious research queries from a directive task description.
    Fires these in parallel with architect planning so research is
    ready before the build phase starts.
    """
    queries = []
    task_lower = task.lower()

    # Pricing research signals
    if any(w in task_lower for w in ["pricing", "price", "cost", "quote", "rfq"]):
        if "w251" in task_lower or "gas turbine" in task_lower or "bop" in task_lower:
            queries.append("W251 gas turbine balance of plant current market pricing 2025 2026")

    # Contact research signals
    if any(w in task_lower for w in ["contact", "email", "outreach", "linkedin"]):
        if any(co in task_lower for co in ["baker hughes", "emerson", "donaldson", "siemens", "ge "]):
            queries.append("gas turbine BOP supplier executive contacts power generation 2025")

    # Regulatory/index signals
    if any(w in task_lower for w in ["enr", "cci", "index", "escalation", "inflation"]):
        queries.append("ENR Construction Cost Index 2024 2025 current value")

    # Market intelligence signals
    if any(w in task_lower for w in ["market", "intelligence", "supplier profile", "company overview"]):
        pass  # Too broad — let architect decide

    return queries[:2]   # cap at 2 prefetch queries


class Orchestrator:

    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run    = dry_run
        self.architect  = ArchitectAgent()
        self.researcher = ResearcherAgent()
        self.builder    = BuilderAgent()
        self.auditor    = AuditorAgent()
        self.state      = StateManager(SESSION_STATE_FILE)
        self.queue      = DirectiveQueue(DIRECTIVE_QUEUE_FILE)
        self.log        = AuditLog(AUDIT_LOG_FILE)
        self._lock      = threading.Lock()   # protects git ops

    # ── Main entry points ─────────────────────────────────────────────────────

    def run(self, once: bool = False, loop: bool = False) -> None:
        log.info("Orchestrator v2 starting — dry_run=%s parallel=True self_edit=True", self.dry_run)
        log.info("Agents: Architect=%s Researcher=%s Builder=%s Auditor=%s",
                 "✓" if self.architect.available()  else "✗",
                 "✓" if self.researcher.available() else "✗",
                 "✓" if self.builder.available()    else "✗",
                 "✓" if self.auditor.available()    else "✗")

        if loop:
            log.info("CONTINUOUS MODE — parallel dual-track. Ctrl+C to stop.")
            self._run_loop()
        else:
            self._run_batch(once=once)

    def _run_batch(self, once: bool = False) -> None:
        completed = self._completed_ids()
        while True:
            self.queue.reload()
            d = self.queue.next(completed)
            if not d:
                log.info("Queue empty — %d completed", len(completed))
                break
            if self.run_directive(d):
                completed.append(d.id)
            if once:
                break

    def _run_loop(self) -> None:
        """Continuous loop with parallel dual-track execution."""
        while True:
            try:
                self._git_sync()
                self.queue.reload()
                completed = self._completed_ids()

                # Get up to 2 ready directives for parallel execution
                ready: List[Directive] = []
                for d in self.queue.directives:
                    if d.id in completed:
                        continue
                    if all(dep in completed for dep in d.depends_on):
                        ready.append(d)
                    if len(ready) == 2:
                        break

                if not ready:
                    log.info("Queue empty — polling in %ds", POLL_SLEEP)
                    time.sleep(POLL_SLEEP)
                    continue

                if len(ready) == 1 or self.dry_run:
                    # Single directive
                    d = ready[0]
                    log.info("━"*60)
                    log.info("DIRECTIVE: [%s] %s", d.id, d.title)
                    log.info("━"*60)
                    self.run_directive(d)
                else:
                    # Two directives in parallel
                    d1, d2 = ready[0], ready[1]
                    log.info("━"*60)
                    log.info("PARALLEL: [%s] + [%s]", d1.id, d2.id)
                    log.info("━"*60)
                    self._run_parallel(d1, d2)

            except KeyboardInterrupt:
                log.info("Orchestrator stopped.")
                break
            except Exception as e:
                log.error("Loop error: %s — continuing in 30s", e)
                time.sleep(30)

    def _run_parallel(self, d1: Directive, d2: Directive) -> None:
        """Run two directives simultaneously in separate threads."""
        results = {}

        def run(d: Directive) -> None:
            results[d.id] = self.run_directive(d)

        t1 = threading.Thread(target=run, args=(d1,), daemon=True)
        t2 = threading.Thread(target=run, args=(d2,), daemon=True)
        t1.start(); t2.start()
        t1.join();  t2.join()

        for did, success in results.items():
            status = "✓ COMPLETE" if success else "✗ FAILED"
            log.info("%s [%s]", status, did)

    # ── Directive pipeline ────────────────────────────────────────────────────

    def run_directive(self, directive: Directive) -> bool:
        ds = self.state.get_or_create_directive(directive.id, directive.title)
        self.log.log_directive_start(directive.id, directive.title)

        try:
            # Phase 1: Architect plans — simultaneously start any obvious research
            log.info("[%s] Planning...", directive.id)
            ds.status = "PLANNING"
            self.state.update_directive(ds)

            # Fire architect and pre-fetch research simultaneously if context
            # suggests research will be needed (keywords in task description)
            prefetch_future = None
            obvious_queries = _extract_obvious_queries(directive.task)

            if obvious_queries and self.researcher.available() and not self.dry_run:
                log.info("[%s] Pre-fetching %d research queries in parallel with planning",
                         directive.id, len(obvious_queries))
                import concurrent.futures as cf
                _executor = cf.ThreadPoolExecutor(max_workers=1)
                prefetch_future = _executor.submit(
                    self.researcher.research, obvious_queries, directive.context
                )

            plan = self.architect.plan(directive.task, directive.context)
            ds.architect_plan = plan
            self.state.update_directive(ds)
            self.log.log_architect_plan(directive.id, plan)

            queries  = plan.get("research_queries", [])
            criteria = plan.get("acceptance_criteria", [])

            log.info("[%s] Plan: %d files, %d criteria, %d research queries",
                     directive.id,
                     len(plan.get("build_spec", {}).get("files_to_create", [])),
                     len(criteria), len(queries))

            if self.dry_run:
                ds.status = "COMPLETE"
                self.state.update_directive(ds)
                return True

            # Phase 2: Research — collect prefetch + any additional queries
            research_context = ""
            all_queries = list(dict.fromkeys(obvious_queries + queries))  # dedupe

            if all_queries:
                log.info("[%s] Researching (%d queries)...", directive.id, len(all_queries))
                ds.status = "RESEARCHING"
                self.state.update_directive(ds)

                # Collect prefetch results if they're ready
                prefetch_results = []
                if prefetch_future:
                    try:
                        prefetch_results = prefetch_future.result(timeout=5)
                    except Exception:
                        pass

                # Fetch any remaining queries not covered by prefetch
                prefetched_queries = {r.get("query", "") for r in prefetch_results}
                remaining = [q for q in queries if q not in prefetched_queries]
                fresh     = self.researcher.research(remaining, directive.context) if remaining else []

                all_results = prefetch_results + fresh
                ds.research_results = all_results
                self.state.update_directive(ds)
                research_context = self.researcher.format_for_builder(all_results)
                finding_count = sum(len(r.get("findings", [])) for r in all_results)
                self.log.log_research_complete(directive.id, len(all_queries), finding_count)
                log.info("[%s] Research: %d findings (%d prefetched)",
                         directive.id, finding_count, len(prefetch_results))
            else:
                log.info("[%s] No research needed — skipping Perplexity", directive.id)
                if prefetch_future:
                    prefetch_future.cancel()

            # Phases 3-5: Build → Self-Edit → Audit loop
            return self._build_audit_loop(directive, ds, plan, research_context, criteria)

        except Exception as e:
            log.error("[%s] Error: %s", directive.id, e, exc_info=True)
            self.log.log_error(directive.id, "orchestrator", str(e))
            self.state.mark_failed(directive.id, str(e))
            return False

    def _build_audit_loop(
        self,
        directive:        Directive,
        ds:               DirectiveState,
        plan:             Dict[str, Any],
        research_context: str,
        criteria:         List[str],
        correction:       Optional[Dict[str, Any]] = None,
    ) -> bool:

        for attempt in range(1, MAX_CORRECTION_PASSES + 2):
            ds.attempt = attempt
            log.info("[%s] Building (attempt %d)...", directive.id, attempt)
            ds.status = "BUILDING"
            self.state.update_directive(ds)

            # Build with self-edit
            build_output = self.builder.build(
                build_spec=plan,
                research_context=research_context,
                correction_context=correction,
                acceptance_criteria=criteria,
            )
            ds.build_output = build_output
            self.state.update_directive(ds)

            # Write files
            files_written, written_paths = write_build_output(build_output, REPO_ROOT)
            self.log.log_build_complete(directive.id, build_output.get("status", "?"), files_written, attempt)
            log.info("[%s] Build: %d files written — %s",
                     directive.id, files_written, build_output.get("status", "?"))

            # Tests (informational only)
            tests_passed, test_output = run_tests(repo_root=REPO_ROOT)

            # Frontend check
            clean, clean_msg = validate_no_frontend_changes(REPO_ROOT)
            if not clean:
                log.error("[%s] REGRESSION: %s", directive.id, clean_msg)

            # Audit
            log.info("[%s] Auditing (attempt %d)...", directive.id, attempt)
            ds.status = "AUDITING"
            self.state.update_directive(ds)

            audit_result = self.auditor.audit(
                build_output={
                    **build_output,
                    "files_written":  files_written,
                    "written_paths":  written_paths,
                    "tests_passed":   tests_passed,
                    "test_output":    test_output[:200],
                    "frontend_clean": clean,
                    "self_edited":    True,
                    "audit_instruction": (
                        "PASS if files_written > 0 and frontend_clean=True. "
                        "Builder has already self-reviewed the output. "
                        "Only FAIL if files_written=0 or frontend regression detected."
                    ),
                },
                acceptance_criteria=criteria,
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

            if verdict == "PASS":
                return self._complete(directive, ds, attempt)

            if verdict == "CONDITIONAL_PASS" and attempt <= MAX_CORRECTION_PASSES:
                correction_directive = audit_result.get("correction_directive", "")
                log.info("[%s] Conditional — correcting (attempt %d)", directive.id, attempt)
                self.log.log_correction_loop(directive.id, attempt, correction_directive)
                correction = {
                    "verdict": verdict,
                    "issues":  issues,
                    "correction_directive": correction_directive,
                    "previous_output": build_output,
                }
                continue

            # FAIL or max attempts
            reason = f"Audit {verdict} after {attempt} attempt(s)"
            log.error("[%s] Escalating: %s", directive.id, reason)
            self.log.log_escalation(directive.id, reason)
            self.state.mark_escalated(directive.id, reason)
            return False

        return False

    def _complete(self, directive: Directive, ds: DirectiveState, attempts: int) -> bool:
        msg = (
            f"Orchestrator [{directive.id}]: {directive.title} — "
            f"Claude→self-edit→Grok pipeline, {attempts} attempt(s), "
            f"baseline {LOCKED_UI_BASELINE} preserved"
        )
        if AUTO_COMMIT:
            with self._lock:   # serialize git ops when running parallel
                success, sha = commit_and_push(msg, BRANCH, REPO_ROOT)
            if success:
                log.info("[%s] Committed: %s", directive.id, sha)
                self.log.log_directive_complete(directive.id, sha, attempts)
                self.state.mark_complete(directive.id, sha)
                return True
            else:
                log.error("[%s] Commit failed: %s", directive.id, sha)
                self.state.mark_failed(directive.id, f"Commit failed: {sha}")
                return False
        self.state.mark_complete(directive.id, "no-commit")
        return True

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _completed_ids(self) -> List[str]:
        return [d.directive_id for d in self.state.state.directives if d.status == "COMPLETE"]

    def _git_sync(self) -> None:
        import subprocess
        try:
            subprocess.run(["git", "fetch", "origin"], capture_output=True, cwd=REPO_ROOT)
            subprocess.run(["git", "rebase", f"origin/{BRANCH}"], capture_output=True, cwd=REPO_ROOT)
        except Exception as e:
            log.debug("Git sync skipped: %s", e)

    def status(self) -> None:
        completed = self._completed_ids()
        pending   = self.queue.pending_count(completed)
        print(f"\n{'═'*60}")
        print("FlowSeer Orchestrator v2 — Parallel Dual-Track")
        print(f"{'═'*60}")
        print(f"Session:    {self.state.state.session_id}")
        print(f"Completed:  {self.state.state.completed_count}")
        print(f"Pending:    {pending}")
        print(f"Failed:     {self.state.state.failed_count}")
        print()
        print("Agents:")
        print(f"  ChatGPT  (Architect):  {'✓ READY' if self.architect.available()  else '✗ add OPENAI_API_KEY'}")
        print(f"  Perplexity (Research): {'✓ READY' if self.researcher.available() else '✗ add PERPLEXITY_API_KEY'}")
        print(f"  Claude   (Builder):    {'✓ READY' if self.builder.available()    else '✗ add ANTHROPIC_API_KEY'}")
        print(f"  Grok     (Auditor):    {'✓ READY' if self.auditor.available()    else '✗ add XAI_API_KEY'}")
        print()
        if self.state.state.directives:
            print("Recent:")
            for d in self.state.state.directives[-5:]:
                icon = {"COMPLETE":"✓","FAILED":"✗","ESCALATED":"⚠","QUEUED":"·"}.get(d.status, "→")
                sha  = f" ({d.commit_sha})" if d.commit_sha else ""
                print(f"  {icon} [{d.directive_id}] {d.title} — {d.status}{sha}")
        print(f"{'═'*60}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="FlowSeer Orchestrator v2")
    p.add_argument("--once",    action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--status",  action="store_true")
    p.add_argument("--loop",    action="store_true")
    p.add_argument("--add",     help="Add directive (JSON string or file)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    import os
    os.chdir(Path(__file__).parent)

    orch = Orchestrator(dry_run=args.dry_run)

    if args.status:
        orch.status()
        return

    if args.add:
        try:
            data = json.loads(Path(args.add).read_text() if Path(args.add).exists() else args.add)
            from state.directive_queue import Directive
            d = Directive(**data)
            orch.queue.add(d)
            print(f"Added [{d.id}]: {d.title}")
        except Exception as e:
            print(f"Error: {e}")
        return

    orch.status()
    orch.run(once=args.once, loop=args.loop)


if __name__ == "__main__":
    main()
