import { NextResponse } from "next/server";

// Vercel function timeout: 300s (Pro plan max). Was 60 on Hobby.
// Pro upgrade lifted ceiling so full Sonnet 4 + 8K-token Builder fits cleanly.
export const maxDuration = 300;

/**
 * FlowSeer Auto-Builder — Autonomous Build Directive v1.0
 *
 * Runs on Vercel Cron daily. Each fire:
 *   Layer 3 — Self-Heal preflight: if last production deploy is ERROR, roll back
 *   Layer 1 — Drift Watchdog: force-deploy HEAD if production is behind git
 *   Layer 2 — Directive queue load + self-extend via Generator if pending < 2
 *   Pick next pending directive, mark in_progress, persist to git
 *   Run 5-agent pipeline (Architect → Analyst → Builder → Auditor)
 *   Layer 4 — Score Gate: enforce numeric EQS threshold before commit
 *   On gate pass: commit files + queue status atomically via /api/github-commit
 *   On failure: mark directive failed in queue and exit
 *
 * Queue lives in data/directive_queue.json, fully git-tracked for audit.
 */

const REPO_OWNER = "Buch5303";
const REPO_NAME = "ssc-v2";
const BRANCH = "main";
const QUEUE_PATH = "data/directive_queue.json";
const VERCEL_PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const VERCEL_TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";
const REPO_ID = "1193314065";

// Layer 4 — EQS v1.0 quality gate thresholds
const SCORE_FLOOR = 65;        // Hard reject below this regardless of verdict
const SCORE_PASS_MIN = 80;     // Verdict=PASS requires at least this; else downgraded

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

interface Directive {
  id: string;
  title: string;
  directive: string;
  priority: number;
  status: "pending" | "in_progress" | "complete" | "failed";
  origin: "seed" | "auto" | "ceo" | "sentinel";
  rationale?: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  commit_sha: string | null;
  auditor_score: number | null;
}

interface Queue {
  version: number;
  updated_at: string;
  description?: string;
  directives: Directive[];
}

interface LoadResult {
  queue: Queue | null;
  source?: "contents-api" | "raw-fallback";
  error?: string;
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

async function runAgent(agentPath: string, body: any, baseUrl: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}/api/orchestrator/${agentPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e: any) {
    return { error: e.message, agent: agentPath, status: "failed" };
  }
}

/**
 * Load queue from GitHub with structured error reporting and raw.* fallback.
 *
 * Fixes applied vs prior version:
 *   - PAT is trimmed (defends against trailing newline pasted into Vercel env UI)
 *   - `cache: 'no-store'` prevents Next.js fetch caching from serving stale state
 *   - Base64 whitespace is stripped before decode (GitHub inserts \n every 60 chars)
 *   - On Contents API failure, falls back to raw.githubusercontent.com
 *   - Returns structured {queue, error, source} instead of silently null
 */
async function loadQueue(ghPat: string): Promise<LoadResult> {
  const pat = (ghPat || "").trim();
  const errors: string[] = [];

  // Path 1 — Authenticated Contents API
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${QUEUE_PATH}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (res.ok) {
      const data: any = await res.json();
      if (data && typeof data.content === "string") {
        const cleaned = data.content.replace(/\s/g, "");
        const decoded = Buffer.from(cleaned, "base64").toString("utf8");
        const parsed = JSON.parse(decoded) as Queue;
        if (parsed && Array.isArray(parsed.directives)) {
          return { queue: parsed, source: "contents-api" };
        }
        errors.push("contents-api: parsed but directives missing");
      } else {
        errors.push(`contents-api: unexpected shape (${typeof data?.content})`);
      }
    } else {
      const body = await res.text().catch(() => "");
      errors.push(`contents-api: HTTP ${res.status} ${body.slice(0, 120)}`);
    }
  } catch (e: any) {
    errors.push(`contents-api: ${e?.message || "exception"}`);
  }

  // Path 2 — raw.githubusercontent.com anonymous fallback.
  // Deliberately does NOT send Authorization header: raw.githubusercontent.com
  // serves public repos anonymously, and sending an INVALID Authorization causes
  // the CDN to reject with 404. This path is our safety net when the PAT is
  // stale/missing — it must not depend on the same credential that's broken.
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${QUEUE_PATH}`,
      { cache: "no-store" }
    );
    if (res.ok) {
      const text = await res.text();
      const parsed = JSON.parse(text) as Queue;
      if (parsed && Array.isArray(parsed.directives)) {
        return { queue: parsed, source: "raw-fallback" };
      }
      errors.push("raw-fallback: parsed but directives missing");
    } else {
      errors.push(`raw-fallback: HTTP ${res.status}`);
    }
  } catch (e: any) {
    errors.push(`raw-fallback: ${e?.message || "exception"}`);
  }

  return { queue: null, error: errors.join(" | ") };
}

/**
 * Persist queue back to git, atomically with optional extra files.
 */
async function saveQueue(
  queue: Queue,
  message: string,
  baseUrl: string,
  extraFiles: Array<{ path: string; content: string }> = []
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  try {
    queue.updated_at = new Date().toISOString();
    const files = [
      { path: QUEUE_PATH, content: JSON.stringify(queue, null, 2) + "\n" },
      ...extraFiles,
    ];
    const res = await fetch(`${baseUrl}/api/github-commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, message }),
    });
    const data = await res.json();
    const ok = data.status === "success" || (typeof data.committed === "number" && data.committed > 0);
    if (ok) {
      const sha = Array.isArray(data.results)
        ? data.results.filter((r: any) => r?.status === "committed").pop()?.sha
        : undefined;
      return { ok: true, sha };
    }
    return { ok: false, error: data.error || `commit status=${data.status} committed=${data.committed}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ----------------------------------------------------------------------
// Layer 4 — Score Gate (EQS v1.0 quality enforcement)
// ----------------------------------------------------------------------

interface GateResult {
  allowed: boolean;
  reason: string;
  effective_verdict: "PASS" | "CONDITIONAL" | "FAIL";
}

/**
 * Enforce numeric quality floor independent of the auditor's soft verdict.
 * Prevents weak code from shipping when auditor returns a lenient textual
 * verdict with a poor score.
 */
function scoreGate(verdict: string, score: number | null): GateResult {
  if (score === null || typeof score !== "number" || Number.isNaN(score)) {
    return {
      allowed: false,
      reason: "No numeric score — EQS v1.0 requires quantitative quality gate",
      effective_verdict: "FAIL",
    };
  }
  if (score < 0 || score > 100) {
    return { allowed: false, reason: `Score out of range (${score})`, effective_verdict: "FAIL" };
  }
  if (verdict === "FAIL") {
    return { allowed: false, reason: `Auditor rejected (score ${score})`, effective_verdict: "FAIL" };
  }
  if (score < SCORE_FLOOR) {
    return {
      allowed: false,
      reason: `Score ${score} below hard floor ${SCORE_FLOOR}`,
      effective_verdict: "FAIL",
    };
  }
  if (verdict === "PASS" && score < SCORE_PASS_MIN) {
    return {
      allowed: true,
      reason: `Score ${score} below PASS threshold ${SCORE_PASS_MIN} — downgraded to CONDITIONAL`,
      effective_verdict: "CONDITIONAL",
    };
  }
  if (verdict !== "PASS" && verdict !== "CONDITIONAL") {
    return {
      allowed: true,
      reason: `Verdict "${verdict}" unrecognized; score ${score} >= floor — treating as CONDITIONAL`,
      effective_verdict: "CONDITIONAL",
    };
  }
  return {
    allowed: true,
    reason: `Score ${score}, verdict ${verdict}`,
    effective_verdict: verdict as "PASS" | "CONDITIONAL",
  };
}

// ----------------------------------------------------------------------
// Layer 3 — Self-Heal preflight (inline; mirrors /api/self-heal standalone)
// ----------------------------------------------------------------------

interface SelfHealResult {
  action: "healthy" | "rolled_back" | "skipped" | "no_good_deployment" | "in_progress";
  current_sha?: string;
  current_state?: string;
  rolled_back_to?: string;
  deployment_id?: string;
  error?: string;
}

async function selfHealPreflight(): Promise<SelfHealResult> {
  const vercelToken = (process.env.VERCEL_TOKEN || "").trim();
  if (!vercelToken) return { action: "skipped", error: "VERCEL_TOKEN missing" };

  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&limit=10`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, cache: "no-store" }
    );
    if (!res.ok) return { action: "skipped", error: `Vercel API ${res.status}` };
    const data: any = await res.json();
    const deployments: any[] = data?.deployments || [];
    if (deployments.length === 0) return { action: "skipped", error: "no deployments" };

    const latest = deployments[0];
    const latestSha = latest?.meta?.githubCommitSha;

    if (latest.state === "READY") {
      return { action: "healthy", current_sha: latestSha?.slice(0, 7), current_state: "READY" };
    }
    if (latest.state === "BUILDING" || latest.state === "QUEUED" || latest.state === "INITIALIZING") {
      return { action: "in_progress", current_state: latest.state, current_sha: latestSha?.slice(0, 7) };
    }
    if (latest.state !== "ERROR" && latest.state !== "CANCELED") {
      return { action: "skipped", error: `Unhandled state ${latest.state}` };
    }

    // ERROR / CANCELED — find last READY deployment
    const lastGood = deployments.find((d: any, i: number) => i > 0 && d.state === "READY");
    if (!lastGood) return { action: "no_good_deployment", current_sha: latestSha?.slice(0, 7) };
    const rollbackSha = lastGood?.meta?.githubCommitSha;
    if (!rollbackSha) return { action: "no_good_deployment", error: "last READY has no SHA" };

    // Trigger redeploy at rollback SHA
    const redeployRes = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM_ID}&forceNew=1`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ssc-v2",
          target: "production",
          gitSource: { type: "github", repoId: REPO_ID, ref: BRANCH, sha: rollbackSha },
        }),
      }
    );
    const redeployData: any = await redeployRes.json();
    return {
      action: "rolled_back",
      current_sha: latestSha?.slice(0, 7),
      rolled_back_to: rollbackSha?.slice(0, 7),
      deployment_id: redeployData?.id,
    };
  } catch (e: any) {
    return { action: "skipped", error: e?.message || "self-heal exception" };
  }
}

// ----------------------------------------------------------------------
// Layer 1 — Drift Watchdog
// ----------------------------------------------------------------------

async function checkAndHealDrift(): Promise<{
  drifted: boolean;
  githubSha?: string;
  vercelSha?: string;
  action?: string;
  error?: string;
}> {
  try {
    const ghPat = (process.env.GITHUB_PAT || "").trim();
    const vercelToken = (process.env.VERCEL_TOKEN || "").trim();
    if (!ghPat || !vercelToken) {
      return { drifted: false, error: "GITHUB_PAT or VERCEL_TOKEN missing — drift check skipped" };
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${ghPat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    const ghData = await ghRes.json();
    const githubSha = ghData?.sha;
    if (!githubSha) return { drifted: false, error: `Could not read GitHub HEAD: ${ghData?.message || ghRes.status}` };

    const vRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&state=READY&limit=1`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, cache: "no-store" }
    );
    const vData = await vRes.json();
    const vercelSha = vData?.deployments?.[0]?.meta?.githubCommitSha;
    if (!vercelSha) return { drifted: false, error: "Could not read Vercel production SHA" };

    if (githubSha === vercelSha) return { drifted: false, githubSha, vercelSha };

    const redeployRes = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM_ID}&forceNew=1`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ssc-v2",
          target: "production",
          gitSource: { type: "github", repoId: REPO_ID, ref: BRANCH, sha: githubSha },
        }),
      }
    );
    const redeployData = await redeployRes.json();
    const action = redeployData?.id
      ? `Force-deploy queued (${redeployData.id})`
      : `Redeploy request failed: ${JSON.stringify(redeployData).slice(0, 200)}`;
    return { drifted: true, githubSha, vercelSha, action };
  } catch (e: any) {
    return { drifted: false, error: e?.message || "drift check exception" };
  }
}

// ----------------------------------------------------------------------
// GET — main pipeline
// ----------------------------------------------------------------------

export async function GET(req: Request) {
  const startTime = Date.now();
  const baseUrl = "https://ssc-v2.vercel.app";

  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  log.push(`[${new Date().toISOString()}] Auto-builder cycle started`);

  // Layer 3 — Self-Heal preflight (BEFORE drift watchdog to handle broken deploys first)
  const heal = await selfHealPreflight();
  log.push(`[SELF-HEAL] ${heal.action}${heal.current_sha ? ` @ ${heal.current_sha}` : ""}${heal.error ? ` (${heal.error})` : ""}`);
  if (heal.action === "rolled_back") {
    return NextResponse.json({
      status: "rolled_back",
      stage: "self_heal",
      from_sha: heal.current_sha,
      to_sha: heal.rolled_back_to,
      deployment_id: heal.deployment_id,
      log,
      note: "Rolled back broken deploy. Directive processing resumes on next cron fire.",
    });
  }
  if (heal.action === "in_progress") {
    return NextResponse.json({
      status: "deploy_in_progress",
      stage: "self_heal",
      current_state: heal.current_state,
      log,
      note: "Deploy still running. Skipping this cycle to avoid racing a fresh deployment.",
    });
  }

  // Layer 1 — Drift Watchdog
  const driftCheck = await checkAndHealDrift();
  if (driftCheck.drifted) {
    return NextResponse.json({
      status: "drift_healed",
      stage: "watchdog",
      github_head: driftCheck.githubSha,
      vercel_production: driftCheck.vercelSha,
      action: driftCheck.action,
      log,
      note: "Force-deploy triggered. Directive processing will resume on next cron fire.",
    });
  }
  log.push(`[WATCHDOG] In sync at ${driftCheck.githubSha?.slice(0, 7) || "unknown"}${driftCheck.error ? ` (${driftCheck.error})` : ""}`);

  // Layer 2 — Load queue
  const ghPat = process.env.GITHUB_PAT;
  if (!ghPat) {
    return NextResponse.json({
      status: "blocked", stage: "queue_load",
      error: "GITHUB_PAT not set — cannot read queue",
      log,
    }, { status: 500 });
  }

  const queueResult = await loadQueue(ghPat);
  if (!queueResult.queue) {
    return NextResponse.json({
      status: "blocked", stage: "queue_load",
      error: queueResult.error || `Could not load ${QUEUE_PATH} from git`,
      log,
    }, { status: 500 });
  }
  const queue = queueResult.queue;
  const pendingCount = queue.directives.filter(d => d.status === "pending").length;
  log.push(`[QUEUE] Loaded via ${queueResult.source}. Pending: ${pendingCount}, total: ${queue.directives.length}`);

  // ----------------------------------------------------------------------
  // Stuck-recovery sweep
  // ----------------------------------------------------------------------
  // A directive in_progress for >30 min almost certainly hit a lambda timeout
  // mid-pipeline (previous 504 before we shipped maxDuration, or Builder
  // exceeding 60s on Hobby plan). Without this sweep, such a directive
  // permanently occupies the active slot and starves the queue. Resetting to
  // pending with an incremented attempts counter lets the next cycle retry
  // (and the counter lets us auto-fail after N retries if we wire that up).
  const STUCK_MS = 30 * 60 * 1000;
  const now = Date.now();
  let recoveredStuck = 0;
  for (const d of queue.directives) {
    if (d.status === "in_progress" && d.started_at) {
      const startedMs = Date.parse(d.started_at);
      if (!Number.isNaN(startedMs) && now - startedMs > STUCK_MS) {
        d.status = "pending";
        d.started_at = null;
        (d as any).attempts = ((d as any).attempts || 0) + 1;
        recoveredStuck++;
        log.push(`[RECOVERY] ${d.id} stuck in_progress for >30min — reset to pending (attempt #${(d as any).attempts})`);
      }
    }
  }
  if (recoveredStuck > 0) {
    await saveQueue(queue, `[RECOVERY] Reset ${recoveredStuck} stuck directive(s) to pending`, baseUrl).catch(() => {});
  }

  // Layer 2 — Self-extend queue if low
  if (pendingCount < 2) {
    log.push(`[GENERATOR] Queue low (pending=${pendingCount}). Invoking Directive Generator...`);
    const genResult = await runAgent("directive-generator", {
      queue,
      platform_state: {
        pending_count: pendingCount,
        completed_count: queue.directives.filter(d => d.status === "complete").length,
        failed_count: queue.directives.filter(d => d.status === "failed").length,
        last_updated: queue.updated_at,
      },
    }, baseUrl);

    if (genResult?.directives && Array.isArray(genResult.directives) && genResult.directives.length > 0) {
      const newOnes = genResult.directives as Directive[];
      queue.directives.push(...newOnes);
      const persist = await saveQueue(
        queue,
        `[LAYER 2] Directive Generator appended ${newOnes.length} directive(s): ${newOnes.map(d => d.id).join(", ")}`,
        baseUrl
      );
      if (persist.ok) {
        log.push(`[GENERATOR] Appended ${newOnes.length}: ${newOnes.map(d => d.id).join(", ")}`);
      } else {
        log.push(`[GENERATOR] Generated but failed to persist: ${persist.error}`);
      }
    } else {
      log.push(`[GENERATOR] No directives generated (${genResult?.error || genResult?.status || "unknown"})`);
    }
  }

  // Pick next pending directive by priority
  const candidates = queue.directives.filter(d => d.status === "pending");
  candidates.sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const next = candidates[0];

  if (!next) {
    return NextResponse.json({
      status: "idle",
      message: "No pending directives and generator produced none",
      queue_size: queue.directives.length,
      log,
      timestamp: new Date().toISOString(),
    });
  }

  log.push(`[${new Date().toISOString()}] Processing: ${next.id} — ${next.title}`);

  // Mark in_progress
  next.status = "in_progress";
  next.started_at = new Date().toISOString();
  await saveQueue(queue, `[QUEUE] ${next.id} started`, baseUrl).catch(() => {});

  // ----- 5-Agent Pipeline -----

  log.push(`[ARCHITECT] Decomposing directive...`);
  const archResult = await runAgent("architect", {
    directive: next.directive,
    context: "FlowSeer W251 BOP procurement platform. Next.js 14, Tailwind, TypeScript, Vercel. EQS v1.0 standards enforced.",
  }, baseUrl);
  if (!archResult?.spec && !archResult?.raw) {
    log.push(`[ARCHITECT] FAILED: ${archResult?.error || "No spec returned"}`);
    next.status = "failed";
    next.completed_at = new Date().toISOString();
    await saveQueue(queue, `[QUEUE] ${next.id} failed at architect`, baseUrl).catch(() => {});
    return NextResponse.json({
      status: "failed", directive: next.id, stage: "architect",
      error: archResult?.error, log, elapsed: (Date.now() - startTime) / 1000,
    });
  }
  log.push(`[ARCHITECT] Complete`);

  log.push(`[ANALYST] Reviewing codebase...`);
  const analysisResult = await runAgent("analyst", { spec: archResult.spec || archResult }, baseUrl);
  log.push(`[ANALYST] ${analysisResult?.status || "complete"}`);

  // Run Researcher in parallel-equivalent if the Architect produced research_queries.
  // Previously this was hardcoded to [] which meant the Builder never got real
  // research context. Researcher is a no-op (returns []) when PERPLEXITY_API_KEY
  // is unset or queries are empty, so this is safe to always call.
  const researchQueries = archResult?.spec?.research_queries || archResult?.research_queries || [];
  let researchResults: any[] = [];
  if (Array.isArray(researchQueries) && researchQueries.length > 0) {
    log.push(`[RESEARCHER] Running ${researchQueries.length} quer${researchQueries.length === 1 ? "y" : "ies"}...`);
    const resResult = await runAgent("researcher", {
      queries: researchQueries,
      context: "FlowSeer W251 BOP procurement platform. Santa Teresa NM. Next.js 14.",
    }, baseUrl);
    researchResults = Array.isArray(resResult?.results) ? resResult.results : [];
    log.push(`[RESEARCHER] ${resResult?.status || "complete"} — ${researchResults.length} result(s)`);
  } else {
    log.push(`[RESEARCHER] Skipped — no research_queries in spec`);
  }

  // ----- Builder + Auditor with retry loop -----
  //
  // Prior single-shot flow allowed CONDITIONAL (score 65–79) verdicts to
  // commit, which shipped half-built directives (AUTO-006/007 landed at
  // 72/100 with missing PUT endpoints and DB query files). The retry loop
  // requires a clean PASS before commit — on CONDITIONAL we feed the
  // auditor's top issues back to the Builder as `retry_context` and
  // re-run. After MAX_BUILD_ATTEMPTS without PASS, the directive is
  // marked failed so the queue advances rather than shipping junk.
  const MAX_BUILD_ATTEMPTS = 3;
  let buildResult: any = null;
  let auditResult: any = null;
  let rawVerdict = "UNKNOWN";
  let score: number | null = null;
  let gate: GateResult = { allowed: false, reason: "no build attempted", effective_verdict: "FAIL" };
  let buildAttempts = 0;
  let retryContext: string | undefined;
  const attemptHistory: Array<{ attempt: number; verdict: string; score: number | null; effective: string }> = [];

  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    buildAttempts = attempt;
    log.push(`[BUILDER] Attempt ${attempt}/${MAX_BUILD_ATTEMPTS} — generating code...`);
    buildResult = await runAgent("builder", {
      spec: archResult.spec || archResult,
      research: researchResults,
      analysis: analysisResult?.analysis || {},
      ...(retryContext ? { retry_context: retryContext } : {}),
    }, baseUrl);

    if (!buildResult?.build) {
      log.push(`[BUILDER] Attempt ${attempt} FAILED: ${buildResult?.error || "No build returned"}`);
      if (attempt === MAX_BUILD_ATTEMPTS) {
        next.status = "failed";
        next.completed_at = new Date().toISOString();
        await saveQueue(queue, `[QUEUE] ${next.id} failed at builder after ${attempt} attempts`, baseUrl).catch(() => {});
        return NextResponse.json({
          status: "failed", directive: next.id, stage: "builder",
          error: buildResult?.error, log, elapsed: (Date.now() - startTime) / 1000,
        });
      }
      retryContext = `Previous attempt produced no parseable build output. Emit valid JSON with a complete files array.`;
      continue;
    }
    log.push(`[BUILDER] Attempt ${attempt} complete — ${buildResult.build.files?.length || 0} files`);

    log.push(`[AUDITOR] Reviewing attempt ${attempt}...`);
    auditResult = await runAgent("auditor", {
      spec: archResult.spec || archResult,
      build: buildResult.build,
      research: researchResults,
    }, baseUrl);
    rawVerdict = auditResult?.audit?.verdict || "UNKNOWN";
    score = auditResult?.audit?.score ?? null;
    log.push(`[AUDITOR] Attempt ${attempt} verdict: ${rawVerdict}${score !== null ? ` (${score}/100)` : ""}`);

    gate = scoreGate(rawVerdict, score);
    attemptHistory.push({ attempt, verdict: rawVerdict, score, effective: gate.effective_verdict });
    log.push(`[GATE] Attempt ${attempt}: ${gate.reason} → ${gate.effective_verdict}`);

    // Clean PASS — break out of retry loop and commit.
    if (gate.effective_verdict === "PASS") {
      break;
    }
    // CONDITIONAL with attempts remaining — feed auditor issues back to Builder.
    if (attempt < MAX_BUILD_ATTEMPTS && gate.effective_verdict === "CONDITIONAL") {
      const issues: any[] = Array.isArray(auditResult?.audit?.issues) ? auditResult.audit.issues : [];
      const topIssues = issues.slice(0, 5).map((i: any, idx: number) =>
        `${idx + 1}. [${i.severity || "?"}] ${i.description || JSON.stringify(i)}`
      ).join("\n");
      retryContext = [
        `Previous attempt scored ${score}/100 (${rawVerdict}).`,
        `You MUST fix these issues and re-emit the COMPLETE set of files (do not omit any file from the spec):`,
        topIssues || "(auditor returned no structured issues — re-emit complete spec)",
      ].join("\n");
      log.push(`[RETRY] Re-running Builder with auditor feedback (next attempt ${attempt + 1}/${MAX_BUILD_ATTEMPTS})`);
      continue;
    }
    // FAIL verdict or no attempts left — exit loop, will fail below.
    break;
  }

  const effectiveVerdict = gate.effective_verdict;
  const builderFileCount = buildResult?.build?.files?.length || 0;
  const builderParseError = buildResult?.build?.parse_error === true;

  // Only commit on a clean PASS. CONDITIONAL/FAIL after retries → mark
  // failed so the queue advances rather than shipping incomplete work.
  let commitResult: any = null;
  const shouldCommit = effectiveVerdict === "PASS" && builderFileCount > 0;

  if (shouldCommit) {
    log.push(`[COMMIT] Committing ${builderFileCount} file(s) + queue status (PASS ${score}/100 on attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})...`);
    next.status = "complete";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;
    (next as any).build_attempts = buildAttempts;

    const commitMsg = `[${next.id}] ${next.title} — PASS ${score}/100 (attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})`;

    const persist = await saveQueue(
      queue,
      commitMsg,
      baseUrl,
      buildResult.build.files.map((f: any) => ({ path: f.path, content: f.content }))
    );
    commitResult = { ok: persist.ok, sha: persist.sha, error: persist.error };
    if (persist.ok) {
      next.commit_sha = persist.sha || null;
      log.push(`[COMMIT] OK`);
    } else {
      log.push(`[COMMIT] FAILED: ${persist.error}`);
      next.status = "failed";
    }
  } else {
    let skipReason: string;
    if (!gate.allowed) {
      skipReason = `gate blocked after ${buildAttempts} attempt(s): ${gate.reason}`;
    } else if (effectiveVerdict !== "PASS") {
      skipReason = `did not reach PASS after ${buildAttempts} attempt(s) — final ${effectiveVerdict} (${rawVerdict} ${score}/100)`;
    } else if (builderParseError) {
      skipReason = `Builder parse error — output was not valid JSON`;
    } else if (builderFileCount === 0) {
      skipReason = `Builder produced zero files (verdict ${rawVerdict}, score ${score})`;
    } else {
      skipReason = `unknown skip condition (gate.allowed=${gate.allowed}, files=${builderFileCount})`;
    }
    log.push(`[COMMIT] Skipped — ${skipReason}`);
    next.status = "failed";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;
    (next as any).skip_reason = skipReason;
    (next as any).build_attempts = buildAttempts;
    (next as any).attempt_history = attemptHistory;
    await saveQueue(queue, `[QUEUE] ${next.id} skipped: ${skipReason}`, baseUrl).catch(() => {});
  }

  const elapsed = (Date.now() - startTime) / 1000;

  // Always write a last-run snapshot so we have post-hoc visibility into what
  // each agent returned, even when the cycle fails before commit. The snapshot
  // is git-tracked (under data/) but kept small — truncated content previews
  // only, no full file bodies — so it's safe to commit on every cycle.
  const runSnapshot = {
    timestamp: new Date().toISOString(),
    directive: { id: next.id, title: next.title, status: next.status },
    elapsed_seconds: elapsed,
    pipeline: {
      architect: {
        status: archResult?.status || "complete",
        spec_keys: archResult?.spec ? Object.keys(archResult.spec) : [],
        acceptance_criteria_count: Array.isArray(archResult?.spec?.acceptance_criteria) ? archResult.spec.acceptance_criteria.length : 0,
        research_queries_count: Array.isArray(archResult?.spec?.research_queries) ? archResult.spec.research_queries.length : 0,
        spec_parse_error: archResult?.spec?.parse_error === true,
      },
      researcher: {
        results_count: researchResults.length,
      },
      analyst: {
        status: analysisResult?.status || "complete",
        approval: analysisResult?.analysis?.approval,
      },
      builder: {
        status: buildResult?.status || "complete",
        files_count: builderFileCount,
        parse_error: builderParseError,
        first_file_path: buildResult?.build?.files?.[0]?.path,
        raw_preview: typeof buildResult?.build?.raw === "string" ? buildResult.build.raw.slice(0, 400) : undefined,
      },
      auditor: {
        status: auditResult?.status || "complete",
        verdict: rawVerdict,
        score,
        summary: auditResult?.audit?.summary,
        pre_check_failed: auditResult?.audit?.pre_check_failed === true,
        issue_count: Array.isArray(auditResult?.audit?.issues) ? auditResult.audit.issues.length : 0,
        top_issues: Array.isArray(auditResult?.audit?.issues)
          ? auditResult.audit.issues.slice(0, 3).map((i: any) => ({ severity: i.severity, description: i.description }))
          : [],
      },
      gate: { allowed: gate.allowed, effective_verdict: effectiveVerdict, reason: gate.reason },
      build_attempts: buildAttempts,
      attempt_history: attemptHistory,
    },
    log,
  };
  await saveQueue(
    queue, // no-op queue payload; we use the extraFiles slot to write snapshot
    `[DEBUG] last_run snapshot for ${next.id}`,
    baseUrl,
    [{ path: "data/last_run.json", content: JSON.stringify(runSnapshot, null, 2) + "\n" }]
  ).catch(() => {});

  return NextResponse.json({
    status: next.status === "complete" ? "complete" : "failed",
    directive: { id: next.id, title: next.title, status: next.status, auditor_score: next.auditor_score },
    pipeline: {
      self_heal: { action: heal.action, sha: heal.current_sha },
      watchdog: { drifted: false, sha: driftCheck.githubSha?.slice(0, 7) || "unknown" },
      architect: { status: archResult.status || "complete" },
      analyst: { status: analysisResult?.status || "complete", approval: analysisResult?.analysis?.approval },
      builder: { status: buildResult.status || "complete", files: builderFileCount, parse_error: builderParseError },
      auditor: { status: auditResult?.status || "complete", raw_verdict: rawVerdict, score, pre_check_failed: auditResult?.audit?.pre_check_failed === true },
      gate: { allowed: gate.allowed, effective_verdict: effectiveVerdict, reason: gate.reason },
      build_attempts: buildAttempts,
      attempt_history: attemptHistory,
    },
    commit: commitResult,
    log,
    elapsed_seconds: elapsed,
    timestamp: new Date().toISOString(),
  });
}
