import { NextResponse } from "next/server";

/**
 * FlowSeer Auto-Builder
 * 
 * Runs on Vercel Cron every hour. Pulls next directive from queue,
 * runs the full 5-agent pipeline autonomously, logs results.
 * 
 * The queue lives in this file as a constant for now.
 * Phase 2: queue reads from Neon DB.
 */

const DIRECTIVE_QUEUE = [
  {
    id: "AUTO-001",
    title: "Neon DB write endpoints",
    directive: "Create POST endpoints for /api/data/pricing, /api/data/contacts, and /api/data/rfq that accept JSON payloads and write to the existing Neon PostgreSQL database. Each endpoint must validate input, compute audit metadata (timestamp, source, before/after snapshot), and return the updated record. Use the DATABASE_URL environment variable for connection.",
    priority: 1,
    status: "pending",
  },
  {
    id: "AUTO-002",
    title: "Loading skeletons for all dashboard pages",
    directive: "Add animated loading skeleton components to all 11 dashboard pages. Each page should show a skeleton that matches its layout structure (KPI strip skeleton, table skeleton, panel skeleton) while data is fetching. Use CSS animations only — no external libraries. Skeletons must feel fast and controlled per EQS v1.0 standards.",
    priority: 2,
    status: "pending",
  },
  {
    id: "AUTO-003",
    title: "Empty state designs",
    directive: "Create elegant empty state components for every data-bearing section across all dashboard pages. When a table has zero rows, a chart has no data, or a panel has no content, display a controlled, intelligent placeholder that explains what data will appear and how to populate it. Use the DataState component with state='empty'. Never show blank space.",
    priority: 3,
    status: "pending",
  },
  {
    id: "AUTO-004",
    title: "Dashboard performance optimization",
    directive: "Add React.memo to all expensive components (KPI, Badge, Panel, StatRow, AlertCard). Add dynamic imports with next/dynamic for heavy dashboard pages. Add route prefetching on sidebar hover. Compress all inline styles to CSS modules where possible. Target: all pages loading under 1.5 seconds per EQS v1.0.",
    priority: 4,
    status: "pending",
  },
  {
    id: "AUTO-005",
    title: "Mobile responsive pass",
    directive: "Make all 11 dashboard pages fully responsive. On mobile (< 768px): collapse the sidebar into a hamburger menu, stack KPI grids from 6-column to 2-column, make tables horizontally scrollable, ensure all text is readable at 14px minimum on mobile, and ensure touch targets are at least 44x44px. Test against iPhone 14 Pro viewport (393x852).",
    priority: 5,
    status: "pending",
  },
];

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
 * Layer 1 — Drift Watchdog.
 * Compares the SHA at GitHub HEAD (main) to the SHA of the current Vercel
 * production deployment. If they diverge, triggers a force redeploy via the
 * Vercel REST API so production catches up to HEAD.
 *
 * Returns {drifted: false} when in sync, {drifted: true, action: "..."} when
 * a corrective deploy has been requested.
 */
async function checkAndHealDrift(): Promise<{
  drifted: boolean;
  githubSha?: string;
  vercelSha?: string;
  action?: string;
  error?: string;
}> {
  try {
    const owner = "Buch5303";
    const repo = "ssc-v2";
    const ghPat = process.env.GITHUB_PAT;
    const vercelToken = process.env.VERCEL_TOKEN;
    const vercelProjectId = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
    const vercelTeamId = "team_YC8EeZxkrZ7q7TcsHM1KXekk";

    if (!ghPat || !vercelToken) {
      return { drifted: false, error: "GITHUB_PAT or VERCEL_TOKEN missing — drift check skipped" };
    }

    // Get GitHub main HEAD SHA
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/main`,
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

    // Get latest READY production deployment SHA from Vercel
    const vRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${vercelProjectId}&teamId=${vercelTeamId}&target=production&state=READY&limit=1`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    );
    const vData = await vRes.json();
    const vercelSha = vData?.deployments?.[0]?.meta?.githubCommitSha;
    if (!vercelSha) return { drifted: false, error: "Could not read Vercel production SHA" };

    if (githubSha === vercelSha) {
      return { drifted: false, githubSha, vercelSha };
    }

    // DRIFT DETECTED — trigger Vercel redeploy of HEAD
    const redeployRes = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${vercelTeamId}&forceNew=1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "ssc-v2",
          target: "production",
          gitSource: {
            type: "github",
            repoId: "1193314065",
            ref: "main",
            sha: githubSha,
          },
        }),
      }
    );
    const redeployData = await redeployRes.json();
    const action =
      redeployData?.id
        ? `Force-deploy queued (${redeployData.id})`
        : `Redeploy request failed: ${JSON.stringify(redeployData).slice(0, 200)}`;

    return { drifted: true, githubSha, vercelSha, action };
  } catch (e: any) {
    return { drifted: false, error: e?.message || "drift check exception" };
  }
}

export async function GET(req: Request) {
  const startTime = Date.now();
  // Always use the production alias — VERCEL_URL returns the ephemeral
  // per-deployment hostname which is gated by Vercel Deployment Protection
  // and returns HTML to server-to-server calls. Production alias is public.
  const baseUrl = "https://ssc-v2.vercel.app";

  // Verify this is a legitimate cron call or has the secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Allow: cron calls (have auth header matching secret), force param, or no secret configured
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ============================================================
  // LAYER 1 — DRIFT WATCHDOG
  // Before processing any directive: verify GitHub HEAD SHA matches
  // Vercel production deploy SHA. If drifted, force-deploy HEAD and
  // exit. Directive processing resumes on the next cron fire with a
  // clean production state.
  // Per Autonomous Build Directive v1.0 Section III, Layer 1.
  // ============================================================
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

  // Find next pending directive
  const next = DIRECTIVE_QUEUE.find(d => d.status === "pending");
  if (!next) {
    return NextResponse.json({
      status: "idle",
      message: "No pending directives in queue",
      queue_length: DIRECTIVE_QUEUE.length,
      all_complete: true,
      timestamp: new Date().toISOString(),
    });
  }

  const log: string[] = [];
  log.push(`[${new Date().toISOString()}] Auto-builder started: ${next.id} — ${next.title}`);

  // Step 1: Architect
  log.push(`[ARCHITECT] Decomposing directive...`);
  const archResult = await runAgent("architect", {
    directive: next.directive,
    context: "FlowSeer W251 BOP procurement platform. Next.js 14, Tailwind, TypeScript, Vercel. EQS v1.0 standards enforced.",
  }, baseUrl);

  if (!archResult?.spec && !archResult?.raw) {
    log.push(`[ARCHITECT] FAILED: ${archResult?.error || "No spec returned"}`);
    return NextResponse.json({
      status: "failed",
      directive: next.id,
      stage: "architect",
      error: archResult?.error,
      log,
      elapsed: (Date.now() - startTime) / 1000,
    });
  }
  log.push(`[ARCHITECT] Complete — spec generated`);

  // Step 2: Analyst (parallel — skip researcher for auto-build)
  log.push(`[ANALYST] Reviewing codebase...`);
  const analysisResult = await runAgent("analyst", {
    spec: archResult.spec || archResult,
  }, baseUrl);
  log.push(`[ANALYST] ${analysisResult?.status || "complete"}`);

  // Step 3: Builder
  log.push(`[BUILDER] Generating code...`);
  const buildResult = await runAgent("builder", {
    spec: archResult.spec || archResult,
    research: [],
    analysis: analysisResult?.analysis || {},
  }, baseUrl);

  if (!buildResult?.build) {
    log.push(`[BUILDER] FAILED: ${buildResult?.error || "No build returned"}`);
    return NextResponse.json({
      status: "failed",
      directive: next.id,
      stage: "builder",
      error: buildResult?.error,
      log,
      elapsed: (Date.now() - startTime) / 1000,
    });
  }
  log.push(`[BUILDER] Complete — ${buildResult.build.files?.length || 0} files generated`);

  // Step 4: Auditor
  log.push(`[AUDITOR] Reviewing code...`);
  const auditResult = await runAgent("auditor", {
    spec: archResult.spec || archResult,
    build: buildResult.build,
  }, baseUrl);
  log.push(`[AUDITOR] Verdict: ${auditResult?.audit?.verdict || "UNKNOWN"}`);

  // Step 5: Auto-commit if auditor passes
  let commitResult = null;
  const verdict = auditResult?.audit?.verdict || "UNKNOWN";
  if ((verdict === "PASS" || verdict === "CONDITIONAL") && buildResult.build?.files?.length > 0) {
    log.push(`[COMMIT] Auditor passed — committing ${buildResult.build.files.length} files to GitHub...`);
    try {
      const commitRes = await fetch(`${baseUrl}/api/github-commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: buildResult.build.files.map((f: any) => ({ path: f.path, content: f.content })),
          message: `${next.id}: ${next.title}`,
          directive_id: next.id,
        }),
      });
      commitResult = await commitRes.json();
      log.push(`[COMMIT] ${commitResult.status} — ${commitResult.committed || 0} files committed, ${commitResult.failed || 0} failed`);
      if (commitResult.committed > 0) {
        log.push(`[DEPLOY] Vercel will auto-deploy within 60 seconds`);
      }
    } catch (e: any) {
      log.push(`[COMMIT] Error: ${e.message}`);
      commitResult = { status: "error", error: e.message };
    }
  } else if (verdict === "FAIL") {
    log.push(`[COMMIT] Skipped — auditor rejected. Code not committed.`);
  }

  const elapsed = (Date.now() - startTime) / 1000;

  return NextResponse.json({
    status: "complete",
    directive: { id: next.id, title: next.title },
    pipeline: {
      architect: { status: archResult.status || "complete" },
      analyst: { status: analysisResult?.status || "complete", approval: analysisResult?.analysis?.approval },
      builder: { status: buildResult.status || "complete", files: buildResult.build?.files?.length || 0 },
      auditor: { status: auditResult?.status || "complete", verdict: auditResult?.audit?.verdict },
    },
    build_output: buildResult.build,
    audit: auditResult?.audit,
    commit: commitResult,
    log,
    elapsed_seconds: elapsed,
    timestamp: new Date().toISOString(),
    note: "Auto-builder completed pipeline. Code review ready. To apply: submit files via GitHub commit.",
  });
}
// Auto-build system deployed 2026-04-20T20:03:42Z
