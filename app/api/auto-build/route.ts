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

export async function GET(req: Request) {
  const startTime = Date.now();
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://ssc-v2.vercel.app";

  // Verify this is a legitimate cron call or has the secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // Allow: cron calls (have auth header matching secret), force param, or no secret configured
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !force) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
