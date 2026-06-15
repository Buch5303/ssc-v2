// ----------------------------------------------------------------------
// FlowSeer Promotion Gate (Layer 7) — preview-build-as-gate
// ----------------------------------------------------------------------
// The orchestrator's in-function compile gate can validate import resolution,
// named exports and Tailwind tokens, but it CANNOT run the real `next build`
// (it has only file paths, and the TS compiler is not in the serverless
// bundle). That is exactly how the AUTO-061 class slips through: code that
// passes the static gate but fails `tsc`/`next build` at deploy time.
//
// This gate closes that gap WITHOUT needing a GitHub Actions workflow (and so
// without the `workflow` token scope the autobuilder PAT lacks). The flow:
//
//   1. The orchestrator commits the directive's files to a CANDIDATE branch
//      (always rebuilt as "main + this batch" — see github-commit route).
//   2. Vercel automatically builds a PREVIEW deployment for that branch —
//      the exact production `next build` (compile + tsc + everything).
//   3. We poll that preview. READY  → fast-forward main to the candidate
//      (production deploys, broken code never reached it). Anything else →
//      do NOT promote; the caller fails the directive and leaves the
//      candidate branch intact for inspection.
//
// Safety invariants:
//   - main is only ever advanced by a NON-FORCE fast-forward, so a promote
//     can never clobber concurrent commits — it fails cleanly and the
//     directive retries.
//   - A non-READY preview never reaches main. Production integrity is the
//     default, not the exception.
//   - Entirely gated by the PROMOTION_GATE env flag in the orchestrator;
//     when unset, none of this runs and behavior is identical to today.

const VERCEL_PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const VERCEL_TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";
const GH_API = "https://api.github.com/repos/Buch5303/ssc-v2";

export type PreviewVerdict = "READY" | "ERROR" | "CANCELED" | "TIMEOUT" | "NOT_FOUND";

export interface PromotionResult {
  promoted: boolean;
  verdict: PreviewVerdict | "PROMOTE_FAILED";
  candidateSha: string;
  deploymentId?: string;
  inspectorUrl?: string;
  reason: string;
}

async function vercelGet(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vercel API ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json();
}

/**
 * Find the Vercel deployment whose commit sha matches the candidate. This is
 * the preview build of the candidate branch (target is "preview", not
 * "production"), so we deliberately do NOT filter by target.
 */
async function findDeploymentBySha(sha: string, token: string): Promise<any | null> {
  const data = await vercelGet(
    `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=30`,
    token
  );
  const deployments: any[] = data?.deployments || [];
  return deployments.find((d) => (d?.meta?.githubCommitSha || "") === sha) || null;
}

/**
 * Poll the candidate's preview build until it reaches a terminal state or the
 * timeout elapses. Returns the verdict plus deployment id/inspector URL.
 */
export async function pollCandidateBuild(opts: {
  sha: string;
  vercelToken: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<{ verdict: PreviewVerdict; deploymentId?: string; inspectorUrl?: string }> {
  const timeoutMs = opts.timeoutMs ?? 200_000; // under the 300s function ceiling
  const intervalMs = opts.intervalMs ?? 8_000;
  const deadline = Date.now() + timeoutMs;
  let lastId: string | undefined;
  let lastUrl: string | undefined;

  while (Date.now() < deadline) {
    let dep: any = null;
    try {
      dep = await findDeploymentBySha(opts.sha, opts.vercelToken);
    } catch {
      // transient Vercel API hiccup — keep polling
    }
    if (dep) {
      lastId = dep.uid || dep.id;
      lastUrl = dep.inspectorUrl;
      const state = dep.state;
      if (state === "READY") return { verdict: "READY", deploymentId: lastId, inspectorUrl: lastUrl };
      if (state === "ERROR") return { verdict: "ERROR", deploymentId: lastId, inspectorUrl: lastUrl };
      if (state === "CANCELED") return { verdict: "CANCELED", deploymentId: lastId, inspectorUrl: lastUrl };
      // BUILDING / QUEUED / INITIALIZING → keep waiting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { verdict: "TIMEOUT", deploymentId: lastId, inspectorUrl: lastUrl };
}

/**
 * Fast-forward main to the candidate sha. NON-FORCE: GitHub rejects this if
 * main is not an ancestor of the candidate (i.e. main moved underneath us),
 * which is the safe outcome — we never clobber, the directive just retries.
 */
export async function fastForwardMain(opts: { sha: string; githubPat: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${GH_API}/git/refs/heads/main`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${opts.githubPat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: opts.sha, force: false }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `promote main: HTTP ${res.status} ${body.slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "fastForwardMain exception" };
  }
}

/**
 * Run the full promotion gate for a candidate commit: wait for its preview
 * build, then promote to main only on READY. Anything else returns
 * promoted:false with a verdict the caller can act on (fail the directive,
 * leave the candidate branch for inspection).
 */
export async function runPromotionGate(opts: {
  candidateSha: string;
  vercelToken: string;
  githubPat: string;
  timeoutMs?: number;
}): Promise<PromotionResult> {
  const { candidateSha, vercelToken, githubPat } = opts;

  if (!vercelToken) {
    return {
      promoted: false,
      verdict: "NOT_FOUND",
      candidateSha,
      reason: "VERCEL_TOKEN missing — cannot read candidate build state",
    };
  }

  const build = await pollCandidateBuild({ sha: candidateSha, vercelToken, timeoutMs: opts.timeoutMs });
  if (build.verdict !== "READY") {
    return {
      promoted: false,
      verdict: build.verdict,
      candidateSha,
      deploymentId: build.deploymentId,
      inspectorUrl: build.inspectorUrl,
      reason: `candidate preview did not reach READY (state=${build.verdict}) — not promoting`,
    };
  }

  const ff = await fastForwardMain({ sha: candidateSha, githubPat });
  if (!ff.ok) {
    return {
      promoted: false,
      verdict: "PROMOTE_FAILED",
      candidateSha,
      deploymentId: build.deploymentId,
      inspectorUrl: build.inspectorUrl,
      reason: ff.error || "fast-forward of main failed",
    };
  }

  return {
    promoted: true,
    verdict: "READY",
    candidateSha,
    deploymentId: build.deploymentId,
    inspectorUrl: build.inspectorUrl,
    reason: "candidate preview READY — promoted to main",
  };
}
