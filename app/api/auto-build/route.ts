import { NextResponse } from "next/server";

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
  origin: "seed" | "auto" | "ceo";
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

  log.push(`[BUILDER] Generating code...`);
  const buildResult = await runAgent("builder", {
    spec: archResult.spec || archResult,
    research: [],
    analysis: analysisResult?.analysis || {},
  }, baseUrl);
  if (!buildResult?.build) {
    log.push(`[BUILDER] FAILED: ${buildResult?.error || "No build returned"}`);
    next.status = "failed";
    next.completed_at = new Date().toISOString();
    await saveQueue(queue, `[QUEUE] ${next.id} failed at builder`, baseUrl).catch(() => {});
    return NextResponse.json({
      status: "failed", directive: next.id, stage: "builder",
      error: buildResult?.error, log, elapsed: (Date.now() - startTime) / 1000,
    });
  }
  log.push(`[BUILDER] Complete — ${buildResult.build.files?.length || 0} files`);

  log.push(`[AUDITOR] Reviewing code...`);
  const auditResult = await runAgent("auditor", {
    spec: archResult.spec || archResult,
    build: buildResult.build,
  }, baseUrl);
  const rawVerdict = auditResult?.audit?.verdict || "UNKNOWN";
  const score = auditResult?.audit?.score ?? null;
  log.push(`[AUDITOR] Raw verdict: ${rawVerdict}${score !== null ? ` (${score}/100)` : ""}`);

  // Layer 4 — Score Gate
  const gate = scoreGate(rawVerdict, score);
  log.push(`[GATE] ${gate.reason} → ${gate.effective_verdict}`);
  const effectiveVerdict = gate.effective_verdict;

  // Commit if gate allowed
  let commitResult: any = null;
  if (gate.allowed && buildResult.build?.files?.length > 0) {
    log.push(`[COMMIT] Committing ${buildResult.build.files.length} file(s) + queue status...`);

    next.status = "complete";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;

    const commitMsg = `[${next.id}] ${next.title} — Auditor: ${rawVerdict} ${score}/100 — Gate: ${effectiveVerdict}${gate.reason.includes("downgraded") ? " (downgraded)" : ""}`;

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
    log.push(`[COMMIT] Skipped — gate blocked (${gate.reason})`);
    next.status = "failed";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;
    await saveQueue(queue, `[QUEUE] ${next.id} gated out: ${gate.reason}`, baseUrl).catch(() => {});
  }

  const elapsed = (Date.now() - startTime) / 1000;

  return NextResponse.json({
    status: next.status === "complete" ? "complete" : "failed",
    directive: { id: next.id, title: next.title, status: next.status, auditor_score: next.auditor_score },
    pipeline: {
      self_heal: { action: heal.action, sha: heal.current_sha },
      watchdog: { drifted: false, sha: driftCheck.githubSha?.slice(0, 7) || "unknown" },
      architect: { status: archResult.status || "complete" },
      analyst: { status: analysisResult?.status || "complete", approval: analysisResult?.analysis?.approval },
      builder: { status: buildResult.status || "complete", files: buildResult.build?.files?.length || 0 },
      auditor: { status: auditResult?.status || "complete", raw_verdict: rawVerdict, score },
      gate: { allowed: gate.allowed, effective_verdict: effectiveVerdict, reason: gate.reason },
    },
    commit: commitResult,
    log,
    elapsed_seconds: elapsed,
    timestamp: new Date().toISOString(),
  });
}
