import { NextResponse } from "next/server";

/**
 * Layer 3 — Self-Heal / Auto-Rollback endpoint
 *
 * Inspects the most recent production deployments on Vercel. If the latest is
 * in an ERROR or CANCELED state, rolls back by force-deploying the last known
 * READY SHA. Safe to call on healthy state (returns "healthy" with no action).
 *
 * Runs automatically at the start of every auto-build cron cycle, and can be
 * invoked on-demand here for manual recovery or monitoring.
 *
 * Per Autonomous Build Directive v1.0 — Layer 3.
 */

const VERCEL_PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const VERCEL_TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";
const REPO_ID = "1193314065";
const BRANCH = "main";

type HealAction =
  | "healthy"
  | "rolled_back"
  | "skipped"
  | "no_good_deployment"
  | "in_progress";

interface HealResponse {
  action: HealAction;
  current_sha?: string;
  current_state?: string;
  rolled_back_to?: string;
  deployment_id?: string;
  error?: string;
  inspected_count?: number;
  timestamp: string;
}

async function runSelfHeal(dryRun: boolean): Promise<HealResponse> {
  const timestamp = new Date().toISOString();
  const vercelToken = (process.env.VERCEL_TOKEN || "").trim();
  if (!vercelToken) {
    return { action: "skipped", error: "VERCEL_TOKEN missing", timestamp };
  }

  let deployments: any[] = [];
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&limit=10`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, cache: "no-store" }
    );
    if (!res.ok) {
      return { action: "skipped", error: `Vercel API ${res.status}`, timestamp };
    }
    const data: any = await res.json();
    deployments = data?.deployments || [];
  } catch (e: any) {
    return { action: "skipped", error: e?.message || "deployment list exception", timestamp };
  }

  if (deployments.length === 0) {
    return { action: "skipped", error: "no deployments", timestamp };
  }

  const latest = deployments[0];
  const latestSha: string | undefined = latest?.meta?.githubCommitSha;
  const inspected_count = deployments.length;

  if (latest.state === "READY") {
    return {
      action: "healthy",
      current_sha: latestSha?.slice(0, 7),
      current_state: "READY",
      inspected_count,
      timestamp,
    };
  }

  if (latest.state === "BUILDING" || latest.state === "QUEUED" || latest.state === "INITIALIZING") {
    return {
      action: "in_progress",
      current_state: latest.state,
      current_sha: latestSha?.slice(0, 7),
      inspected_count,
      timestamp,
    };
  }

  if (latest.state !== "ERROR" && latest.state !== "CANCELED") {
    return {
      action: "skipped",
      error: `Unhandled state ${latest.state}`,
      current_sha: latestSha?.slice(0, 7),
      inspected_count,
      timestamp,
    };
  }

  // Latest is ERROR or CANCELED — look for most recent READY to roll back to
  const lastGood = deployments.find((d: any, i: number) => i > 0 && d.state === "READY");
  if (!lastGood) {
    return {
      action: "no_good_deployment",
      current_sha: latestSha?.slice(0, 7),
      current_state: latest.state,
      inspected_count,
      timestamp,
    };
  }

  const rollbackSha: string | undefined = lastGood?.meta?.githubCommitSha;
  if (!rollbackSha) {
    return {
      action: "no_good_deployment",
      error: "last READY deployment has no SHA",
      current_sha: latestSha?.slice(0, 7),
      inspected_count,
      timestamp,
    };
  }

  if (dryRun) {
    // Safe mode — report what would happen without actually redeploying
    return {
      action: "rolled_back",
      current_sha: latestSha?.slice(0, 7),
      current_state: latest.state,
      rolled_back_to: rollbackSha.slice(0, 7),
      deployment_id: "(dry-run)",
      inspected_count,
      timestamp,
    };
  }

  try {
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
    if (!redeployData?.id) {
      return {
        action: "skipped",
        error: `Rollback deploy failed: ${JSON.stringify(redeployData).slice(0, 200)}`,
        current_sha: latestSha?.slice(0, 7),
        inspected_count,
        timestamp,
      };
    }
    return {
      action: "rolled_back",
      current_sha: latestSha?.slice(0, 7),
      current_state: latest.state,
      rolled_back_to: rollbackSha.slice(0, 7),
      deployment_id: redeployData.id,
      inspected_count,
      timestamp,
    };
  } catch (e: any) {
    return {
      action: "skipped",
      error: e?.message || "redeploy exception",
      inspected_count,
      timestamp,
    };
  }
}

export async function GET(req: Request) {
  // Default to dry_run=true so GET never accidentally triggers a rollback
  // from a casual browser hit. Pass ?execute=true to actually act.
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("execute") !== "true";
  const result = await runSelfHeal(dryRun);
  return NextResponse.json({ ...result, dry_run: dryRun });
}

export async function POST(req: Request) {
  // POST always executes (intended for /api/admin or automated callers)
  const url = new URL(req.url);
  const force = url.searchParams.get("execute") !== "false"; // default true
  const result = await runSelfHeal(!force);
  return NextResponse.json({ ...result, dry_run: !force });
}
