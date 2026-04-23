import { NextResponse } from "next/server";

/**
 * FlowSeer Auto-Builder
 *
 * Runs on Vercel Cron daily. Each fire:
 *   1. Layer 1 — Drift Watchdog: force-deploy HEAD if production is behind
 *   2. Layer 2 — Directive queue load + self-extend if pending < 2
 *   3. Pick next pending directive, mark in_progress, persist to git
 *   4. Run 5-agent pipeline (Architect → Analyst → Builder → Auditor)
 *   5. On Auditor PASS/CONDITIONAL: commit generated files + updated queue
 *      status in a single git commit
 *   6. On failure: mark directive failed in queue and exit
 *
 * Queue lives in /data/directive_queue.json, fully git-tracked for audit.
 * Per Autonomous Build Directive v1.0.
 */

const REPO_OWNER = "Buch5303";
const REPO_NAME = "ssc-v2";
const BRANCH = "main";
const QUEUE_PATH = "data/directive_queue.json";
const VERCEL_PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const VERCEL_TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";
const REPO_ID = "1193314065";

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

/** Load queue from GitHub via authenticated API (bypasses raw CDN cache). */
async function loadQueue(ghPat: string): Promise<Queue | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${QUEUE_PATH}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${ghPat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const decoded = Buffer.from(data.content, "base64").toString("utf8");
    return JSON.parse(decoded) as Queue;
  } catch {
    return null;
  }
}

/**
 * Persist the queue back to git. Batches with optional extra files into a
 * single commit so pipeline runs produce one atomic git event per directive.
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
      // Per-file commits; no single SHA returned. Return last result's sha if present.
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
    const ghPat = process.env.GITHUB_PAT;
    const vercelToken = process.env.VERCEL_TOKEN;
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
      }
    );
    const ghData = await ghRes.json();
    const githubSha = ghData?.sha;
    if (!githubSha) return { drifted: false, error: "Could not read GitHub HEAD" };

    const vRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&state=READY&limit=1`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    );
    const vData = await vRes.json();
    const vercelSha = vData?.deployments?.[0]?.meta?.githubCommitSha;
    if (!vercelSha) return { drifted: false, error: "Could not read Vercel production SHA" };

    if (githubSha === vercelSha) {
      return { drifted: false, githubSha, vercelSha };
    }

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

  // Layer 1 — Drift Watchdog
  const driftCheck = await checkAndHealDrift();
  if (driftCheck.drifted) {
    return NextResponse.json({
      status: "drift_healed",
      stage: "watchdog",
      github_head: driftCheck.githubSha,
      vercel_production: driftCheck.vercelSha,
      action: driftCheck.action,
      timestamp: new Date().toISOString(),
      note: "Force-deploy triggered. Directive processing will resume on next cron fire.",
    });
  }
  log.push(`[WATCHDOG] In sync at ${driftCheck.githubSha?.slice(0, 7) || "unknown"}`);

  // Layer 2 — Load queue from git
  const ghPat = process.env.GITHUB_PAT;
  if (!ghPat) {
    return NextResponse.json({
      status: "blocked",
      stage: "queue_load",
      error: "GITHUB_PAT not set — cannot read queue",
      log,
    }, { status: 500 });
  }

  let queue = await loadQueue(ghPat);
  if (!queue) {
    return NextResponse.json({
      status: "blocked",
      stage: "queue_load",
      error: `Could not load ${QUEUE_PATH} from git`,
      log,
    }, { status: 500 });
  }
  const pendingCount = queue.directives.filter(d => d.status === "pending").length;
  log.push(`[QUEUE] Loaded. Pending: ${pendingCount}, total: ${queue.directives.length}`);

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

  // Mark in_progress (best-effort; do not block pipeline on persistence failure)
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
  const verdict = auditResult?.audit?.verdict || "UNKNOWN";
  const score = auditResult?.audit?.score ?? null;
  log.push(`[AUDITOR] Verdict: ${verdict}${score !== null ? ` (${score}/100)` : ""}`);

  // Commit if auditor passed
  let commitResult: any = null;
  if ((verdict === "PASS" || verdict === "CONDITIONAL") && buildResult.build?.files?.length > 0) {
    log.push(`[COMMIT] Committing ${buildResult.build.files.length} file(s) + queue status...`);

    next.status = "complete";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;

    const persist = await saveQueue(
      queue,
      `[${next.id}] ${next.title} — Auditor: ${verdict}${score !== null ? ` ${score}/100` : ""}`,
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
  } else if (verdict === "FAIL") {
    log.push(`[COMMIT] Skipped — auditor rejected.`);
    next.status = "failed";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;
    await saveQueue(queue, `[QUEUE] ${next.id} rejected by auditor`, baseUrl).catch(() => {});
  }

  const elapsed = (Date.now() - startTime) / 1000;

  return NextResponse.json({
    status: next.status === "complete" ? "complete" : "failed",
    directive: { id: next.id, title: next.title, status: next.status, auditor_score: next.auditor_score },
    pipeline: {
      watchdog: { drifted: false },
      architect: { status: archResult.status || "complete" },
      analyst: { status: analysisResult?.status || "complete", approval: analysisResult?.analysis?.approval },
      builder: { status: buildResult.status || "complete", files: buildResult.build?.files?.length || 0 },
      auditor: { status: auditResult?.status || "complete", verdict, score },
    },
    commit: commitResult,
    log,
    elapsed_seconds: elapsed,
    timestamp: new Date().toISOString(),
  });
}
