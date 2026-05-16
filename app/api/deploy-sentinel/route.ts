import { NextResponse } from "next/server";

/**
 * FlowSeer Deploy Sentinel — Layer 6 of the autonomous build governance loop.
 *
 * Sits alongside the existing layers (Self-Heal preflight, Drift Watchdog,
 * Score Gate, Retry-on-CONDITIONAL) and closes the last gap: deploy errors
 * that pass the Auditor but fail at compile/deploy time on Vercel.
 *
 * Cron schedule: every 15 minutes (vercel.json).
 *
 * Pipeline per fire:
 *   1. Poll Vercel deployments API for production deploys in last 2 hours
 *   2. If the most recent state is ERROR and the cause looks fixable
 *      (build/typecheck/webpack error in a non-protected file):
 *      a. Fetch build logs, extract first compilation error
 *      b. Apply guardrails (dedupe + circuit breaker + protected-path check)
 *      c. Construct a `sentinel`-origin directive at priority 0
 *      d. Insert into directive queue via /api/github-commit
 *      e. Append to data/sentinel_history.json (audit trail)
 *   3. Next auto-build cron picks it up and runs the SAME 5-agent pipeline
 *      with the SAME EQS score gate. The sentinel never bypasses Audit.
 *
 * Hard invariants — never violated under any circumstance:
 *   - Sentinel writes ONLY directive descriptions, never code
 *   - Fix directives must pass the standard EQS audit gate to commit
 *   - Sentinel refuses to generate fixes that would touch the orchestrator
 *     itself (app/api/auto-build, app/api/deploy-sentinel, app/api/admin,
 *     app/api/orchestrator/*) — recursive self-modification is escalated
 *   - Max 1 open sentinel directive at a time (no double-spawning)
 *   - Max 3 sentinel-origin fixes touching the same file in 24 hours
 *     (circuit breaker against thrash)
 */

export const maxDuration = 60;

const REPO_OWNER = "Buch5303";
const REPO_NAME = "ssc-v2";
const BRANCH = "main";
const QUEUE_PATH = "data/directive_queue.json";
const HISTORY_PATH = "data/sentinel_history.json";
const VERCEL_PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const VERCEL_TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";

// Protected paths — sentinel will NOT auto-fix anything under these prefixes.
// The orchestrator must never modify itself unattended; the admin route
// controls infra; touching them on a failing deploy could brick the cron.
const PROTECTED_PATH_PREFIXES = [
  "app/api/auto-build",
  "app/api/deploy-sentinel",
  "app/api/admin",
  "app/api/orchestrator/",
  "app/api/github-commit",
  "app/api/self-heal",
  ".github/workflows/",
  "vercel.json",
  "next.config.js",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

// Circuit breaker thresholds
const MAX_OPEN_SENTINEL_DIRECTIVES = 1;
const MAX_FIXES_PER_FILE_24H = 3;

// How far back to look for failed deploys
const DEPLOY_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  sentinel_meta?: {
    deploy_id: string;
    error_signature: string;
    target_file: string;
    target_line?: number;
  };
}

interface Queue {
  version: number;
  updated_at: string;
  description?: string;
  directives: Directive[];
}

interface SentinelHistoryEntry {
  timestamp: string;
  deploy_id: string;
  deploy_sha: string;
  action: "directive_queued" | "skipped" | "escalated";
  reason: string;
  target_file?: string;
  target_line?: number;
  error_signature?: string;
  directive_id?: string;
}

interface SentinelHistory {
  version: number;
  updated_at: string;
  entries: SentinelHistoryEntry[];
}

interface BuildError {
  file: string;
  line?: number;
  column?: number;
  errorType: "typescript" | "webpack-module-not-found" | "syntax" | "unknown";
  message: string;
  signature: string; // stable hash for dedupe
}

// ----------------------------------------------------------------------
// Vercel API helpers
// ----------------------------------------------------------------------

async function vercelFetch(path: string): Promise<any> {
  const token = (process.env.VERCEL_TOKEN || "").trim();
  if (!token) throw new Error("VERCEL_TOKEN not set");
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vercel API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listRecentDeployments(): Promise<any[]> {
  const since = Date.now() - DEPLOY_LOOKBACK_MS;
  const data = await vercelFetch(
    `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&limit=20&since=${since}`
  );
  return data?.deployments || [];
}

async function fetchBuildLogs(deploymentId: string): Promise<any[]> {
  const data = await vercelFetch(
    `/v3/deployments/${deploymentId}/events?teamId=${VERCEL_TEAM_ID}&limit=200`
  );
  return Array.isArray(data) ? data : data?.events || [];
}

// ----------------------------------------------------------------------
// Error parsing — extract the first actionable build error
// ----------------------------------------------------------------------

/**
 * Strip Vercel's ANSI color codes so the regex sees clean text.
 */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Stable signature for dedupe — file + line + error fragment, normalized.
 * Two identical errors get the same signature; identical errors must
 * never trigger two fix attempts back-to-back.
 */
function makeSignature(file: string, line: number | undefined, msg: string): string {
  const norm = msg.toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${file}:${line ?? "?"}:${norm}`;
}

function parseBuildError(events: any[]): BuildError | null {
  // Flatten events to plain text, in order
  const lines: string[] = [];
  for (const e of events) {
    const t = stripAnsi(String(e?.text || e?.payload?.text || ""));
    if (t) lines.push(t);
  }

  // Pattern 1 — Next.js / TypeScript: "./path/to/file.tsx:67:28" followed by "Type error: <msg>"
  for (let i = 0; i < lines.length - 1; i++) {
    const loc = lines[i].match(/^\.\/(.+?):(\d+):(\d+)\s*$/);
    if (loc) {
      // search forward up to 8 lines for the "Type error:" payload
      for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
        const msgMatch = lines[j].match(/^Type error:\s*(.+)$/);
        if (msgMatch) {
          const file = loc[1].trim();
          const line = parseInt(loc[2], 10);
          const message = msgMatch[1].trim();
          return {
            file, line, column: parseInt(loc[3], 10),
            errorType: "typescript",
            message,
            signature: makeSignature(file, line, message),
          };
        }
      }
    }
  }

  // Pattern 2 — Webpack module-not-found:
  //   "./path/to/file.ts"
  //   "Module not found: Can't resolve '<module>'"
  for (let i = 0; i < lines.length - 1; i++) {
    const path = lines[i].match(/^\.\/(.+\.(?:tsx?|jsx?))\s*$/);
    if (path) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(/^Module not found: Can't resolve ['"](.+?)['"]/);
        if (m) {
          const file = path[1].trim();
          const message = `Module not found: Can't resolve '${m[1]}'`;
          return {
            file,
            errorType: "webpack-module-not-found",
            message,
            signature: makeSignature(file, undefined, message),
          };
        }
      }
    }
  }

  // Pattern 3 — Generic syntax / unknown error with file location
  for (const line of lines) {
    const m = line.match(/^\.\/(.+?):(\d+):(\d+)\s*$/);
    if (m && /error|failed/i.test(lines[lines.indexOf(line) + 1] || "")) {
      const file = m[1].trim();
      const ln = parseInt(m[2], 10);
      const message = (lines[lines.indexOf(line) + 1] || "").trim().slice(0, 200);
      return {
        file, line: ln, column: parseInt(m[3], 10),
        errorType: "syntax",
        message,
        signature: makeSignature(file, ln, message),
      };
    }
  }

  return null;
}

function isProtectedPath(file: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(prefix => file.startsWith(prefix));
}

// ----------------------------------------------------------------------
// Queue + history helpers — read via raw.githubusercontent.com (anonymous
// is fine for public repo), write via /api/github-commit (which holds the
// authenticated PAT).
// ----------------------------------------------------------------------

async function loadJsonFromRepo<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function commitFiles(
  files: Array<{ path: string; content: string }>,
  message: string,
  baseUrl: string
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  try {
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
    return { ok: false, error: data.error || `commit status=${data.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "commit exception" };
  }
}

// ----------------------------------------------------------------------
// Directive construction
// ----------------------------------------------------------------------

function buildFixDirective(err: BuildError, deploySha: string, queue: Queue): Directive {
  // Determine next sentinel directive id — SENTINEL-001, SENTINEL-002, ...
  const existing = queue.directives
    .filter(d => d.id.startsWith("SENTINEL-"))
    .map(d => parseInt(d.id.replace("SENTINEL-", ""), 10))
    .filter(n => !Number.isNaN(n));
  const nextNum = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  const id = `SENTINEL-${String(nextNum).padStart(3, "0")}`;

  const locationDesc = err.line ? `${err.file}:${err.line}` : err.file;
  const title = `Fix ${err.errorType} build error at ${locationDesc}`;

  const directiveBody = [
    `The most recent production deploy at commit ${deploySha.slice(0, 7)} failed with a ${err.errorType} error.`,
    ``,
    `LOCATION: ${err.file}${err.line ? ` line ${err.line}` : ""}${err.column ? ` column ${err.column}` : ""}`,
    `ERROR:    ${err.message}`,
    ``,
    `Required outcome:`,
    `1. Open ${err.file} and read the surrounding context (at least 20 lines before and after the error site).`,
    `2. Apply the minimum-surface-area fix that makes the next \`next build\` pass while preserving the file's existing behavior.`,
    `3. Do NOT modify any unrelated files. Do NOT change public function signatures or component prop contracts unless directly required by the error.`,
    `4. Do NOT bypass the type system with \`any\`, \`@ts-ignore\`, or \`@ts-expect-error\` — fix the underlying type contract.`,
    `5. The build must compile cleanly (no Type errors, no Module not found) and the touched file must continue to satisfy EQS v1.0 (auditable, sane error handling, no exposed secrets, no broken imports).`,
    ``,
    `This directive was generated automatically by the Deploy Sentinel layer in response to a real production deploy failure. It must pass the standard EQS audit gate to commit — no special concessions.`,
  ].join("\n");

  return {
    id,
    title,
    directive: directiveBody,
    priority: 0, // jumps ahead of all AUTO-/seed directives (which are >=1)
    status: "pending",
    origin: "sentinel",
    rationale: `Deploy Sentinel: production deploy failed on ${err.file}${err.line ? `:${err.line}` : ""} — ${err.errorType}. Auto-fix directive queued.`,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    commit_sha: null,
    auditor_score: null,
    sentinel_meta: {
      deploy_id: "", // filled by caller (which has the deployment id)
      error_signature: err.signature,
      target_file: err.file,
      target_line: err.line,
    },
  };
}

// ----------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------

export async function GET(req: Request) {
  const startedAt = Date.now();
  const log: string[] = [];
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const force = url.searchParams.get("force") === "true";

  log.push(`[${new Date().toISOString()}] Deploy Sentinel cycle started`);

  // 0. Token gate — if Vercel API isn't reachable, nothing to do
  if (!(process.env.VERCEL_TOKEN || "").trim()) {
    log.push(`[CONFIG] VERCEL_TOKEN missing — sentinel cannot read deployments`);
    return NextResponse.json({
      status: "blocked", reason: "VERCEL_TOKEN missing", log,
    }, { status: 500 });
  }
  if (!(process.env.GITHUB_PAT || "").trim()) {
    log.push(`[CONFIG] GITHUB_PAT missing — sentinel cannot write directives`);
    return NextResponse.json({
      status: "blocked", reason: "GITHUB_PAT missing", log,
    }, { status: 500 });
  }

  // 1. Find the most recent production deploy
  let deployments: any[];
  try {
    deployments = await listRecentDeployments();
  } catch (e: any) {
    log.push(`[VERCEL] Could not list deployments: ${e.message}`);
    return NextResponse.json({ status: "error", reason: e.message, log }, { status: 500 });
  }
  log.push(`[VERCEL] Loaded ${deployments.length} recent production deployment(s)`);

  const latest = deployments[0];
  if (!latest) {
    return NextResponse.json({ status: "idle", reason: "no recent deployments", log });
  }
  const latestState = latest.state;
  const latestSha = latest?.meta?.githubCommitSha || "unknown";
  log.push(`[VERCEL] Latest: ${latest.id} state=${latestState} sha=${latestSha.slice(0, 7)}`);

  if (latestState !== "ERROR" && !force) {
    return NextResponse.json({
      status: "idle",
      reason: `latest deploy state is ${latestState}, no action needed`,
      latest: { id: latest.id, sha: latestSha.slice(0, 7), state: latestState },
      log,
    });
  }

  // 2. Fetch and parse build logs
  let events: any[];
  try {
    events = await fetchBuildLogs(latest.id);
  } catch (e: any) {
    log.push(`[VERCEL] Could not fetch build logs: ${e.message}`);
    return NextResponse.json({ status: "error", reason: e.message, log }, { status: 500 });
  }
  log.push(`[VERCEL] Loaded ${events.length} build event(s) for ${latest.id}`);

  const err = parseBuildError(events);
  if (!err) {
    log.push(`[PARSE] No actionable build error pattern matched — escalating instead of guessing`);
    await appendHistory(baseUrl, log, {
      timestamp: new Date().toISOString(),
      deploy_id: latest.id,
      deploy_sha: latestSha,
      action: "escalated",
      reason: "no actionable error pattern matched in build logs",
    });
    return NextResponse.json({
      status: "escalated",
      reason: "deploy failed but error not auto-parseable — manual review required",
      deploy: { id: latest.id, sha: latestSha.slice(0, 7) },
      log,
    });
  }
  log.push(`[PARSE] ${err.errorType} at ${err.file}${err.line ? `:${err.line}` : ""} — ${err.message.slice(0, 100)}`);

  // 3. Protected-path guardrail — never modify the orchestrator itself
  if (isProtectedPath(err.file)) {
    log.push(`[GUARDRAIL] ${err.file} is on the protected list — refusing to auto-fix, escalating`);
    await appendHistory(baseUrl, log, {
      timestamp: new Date().toISOString(),
      deploy_id: latest.id, deploy_sha: latestSha,
      action: "escalated",
      reason: `protected path: ${err.file}`,
      target_file: err.file, target_line: err.line, error_signature: err.signature,
    });
    return NextResponse.json({
      status: "escalated",
      reason: `target file ${err.file} is on the protected list — sentinel will not self-modify the orchestrator. Manual fix required.`,
      log,
    });
  }

  // 4. Load queue + history for dedupe & circuit breaker
  const queue = await loadJsonFromRepo<Queue>(QUEUE_PATH);
  if (!queue) {
    log.push(`[QUEUE] Could not load directive queue — aborting`);
    return NextResponse.json({ status: "error", reason: "queue load failed", log }, { status: 500 });
  }
  const history = (await loadJsonFromRepo<SentinelHistory>(HISTORY_PATH)) || {
    version: 1,
    updated_at: new Date().toISOString(),
    entries: [],
  };

  // 4a. Dedupe — refuse to queue if any sentinel directive is currently open
  // (pending or in_progress). One outage at a time. Prevents double-spawning
  // when sentinel fires twice on the same failed deploy.
  const openSentinel = queue.directives.filter(
    d => d.origin === "sentinel" && (d.status === "pending" || d.status === "in_progress")
  );
  if (openSentinel.length >= MAX_OPEN_SENTINEL_DIRECTIVES) {
    log.push(`[DEDUPE] ${openSentinel.length} sentinel directive(s) already open: ${openSentinel.map(d => d.id).join(", ")} — skipping`);
    await appendHistory(baseUrl, log, {
      timestamp: new Date().toISOString(),
      deploy_id: latest.id, deploy_sha: latestSha,
      action: "skipped",
      reason: `sentinel directive ${openSentinel[0].id} already open`,
      target_file: err.file, error_signature: err.signature,
    });
    return NextResponse.json({
      status: "skipped",
      reason: `${openSentinel.length} open sentinel directive(s) — waiting for the pipeline to drain first`,
      open_directives: openSentinel.map(d => d.id),
      log,
    });
  }

  // 4b. Dedupe — if the same error signature was queued/attempted in the
  // last 24h via sentinel, don't re-queue (auditor or builder couldn't fix
  // it the first time; trying again identically won't help).
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentSameSig = history.entries.filter(
    h => h.error_signature === err.signature &&
         h.action === "directive_queued" &&
         Date.parse(h.timestamp) > dayAgo
  );
  if (recentSameSig.length > 0) {
    log.push(`[DEDUPE] Same error signature already attempted in last 24h via ${recentSameSig.map(h => h.directive_id).join(", ")} — escalating`);
    await appendHistory(baseUrl, log, {
      timestamp: new Date().toISOString(),
      deploy_id: latest.id, deploy_sha: latestSha,
      action: "escalated",
      reason: `repeat failure on identical error signature — auto-fix did not resolve it`,
      target_file: err.file, target_line: err.line, error_signature: err.signature,
    });
    return NextResponse.json({
      status: "escalated",
      reason: "identical build error after prior auto-fix — manual review required",
      prior_directives: recentSameSig.map(h => h.directive_id),
      log,
    });
  }

  // 4c. Circuit breaker — refuse if same file has been auto-fixed N times in 24h
  const sameFile24h = history.entries.filter(
    h => h.target_file === err.file &&
         h.action === "directive_queued" &&
         Date.parse(h.timestamp) > dayAgo
  );
  if (sameFile24h.length >= MAX_FIXES_PER_FILE_24H) {
    log.push(`[CIRCUIT] ${err.file} has had ${sameFile24h.length} auto-fixes in last 24h (limit ${MAX_FIXES_PER_FILE_24H}) — escalating`);
    await appendHistory(baseUrl, log, {
      timestamp: new Date().toISOString(),
      deploy_id: latest.id, deploy_sha: latestSha,
      action: "escalated",
      reason: `circuit breaker tripped — ${err.file} hit ${MAX_FIXES_PER_FILE_24H} fix limit`,
      target_file: err.file, target_line: err.line, error_signature: err.signature,
    });
    return NextResponse.json({
      status: "escalated",
      reason: `${err.file} has been auto-fixed ${sameFile24h.length}× in 24h — circuit breaker engaged, manual review required`,
      log,
    });
  }

  // 5. Build the directive, attach deploy_id to sentinel_meta
  const directive = buildFixDirective(err, latestSha, queue);
  directive.sentinel_meta!.deploy_id = latest.id;
  queue.directives.push(directive);
  queue.updated_at = new Date().toISOString();

  // 6. Append history entry
  const historyEntry: SentinelHistoryEntry = {
    timestamp: new Date().toISOString(),
    deploy_id: latest.id,
    deploy_sha: latestSha,
    action: "directive_queued",
    reason: `${err.errorType} at ${err.file}${err.line ? `:${err.line}` : ""}`,
    target_file: err.file,
    target_line: err.line,
    error_signature: err.signature,
    directive_id: directive.id,
  };
  history.entries.push(historyEntry);
  // Keep history bounded — last 500 entries is plenty for analysis,
  // anything older lives in git history.
  if (history.entries.length > 500) {
    history.entries = history.entries.slice(-500);
  }
  history.updated_at = new Date().toISOString();

  // 7. Atomic commit: queue + history together so we never get a directive
  // without its audit trail or vice versa.
  const commit = await commitFiles(
    [
      { path: QUEUE_PATH, content: JSON.stringify(queue, null, 2) + "\n" },
      { path: HISTORY_PATH, content: JSON.stringify(history, null, 2) + "\n" },
    ],
    `[sentinel] ${directive.id} queued: ${directive.title}`,
    baseUrl
  );

  if (!commit.ok) {
    log.push(`[COMMIT] Failed to persist sentinel directive: ${commit.error}`);
    return NextResponse.json({
      status: "error",
      reason: `directive built but commit failed: ${commit.error}`,
      log,
    }, { status: 500 });
  }

  log.push(`[COMMIT] OK — ${directive.id} queued at sha ${commit.sha?.slice(0, 7) || "?"}`);
  log.push(`[DONE] Next auto-build cron will pick up ${directive.id} (priority 0)`);

  return NextResponse.json({
    status: "queued",
    directive: {
      id: directive.id,
      title: directive.title,
      target_file: err.file,
      target_line: err.line,
      error_type: err.errorType,
    },
    deploy: { id: latest.id, sha: latestSha.slice(0, 7) },
    commit_sha: commit.sha,
    elapsed_seconds: (Date.now() - startedAt) / 1000,
    log,
  });
}

/**
 * Best-effort history append used on early-exit paths. Standalone commit
 * (not atomic with anything) because the early-exit paths don't touch the
 * queue. Failures are logged but don't change the response.
 */
async function appendHistory(
  baseUrl: string,
  log: string[],
  entry: SentinelHistoryEntry
): Promise<void> {
  try {
    const history = (await loadJsonFromRepo<SentinelHistory>(HISTORY_PATH)) || {
      version: 1, updated_at: new Date().toISOString(), entries: [],
    };
    history.entries.push(entry);
    if (history.entries.length > 500) history.entries = history.entries.slice(-500);
    history.updated_at = new Date().toISOString();
    const r = await commitFiles(
      [{ path: HISTORY_PATH, content: JSON.stringify(history, null, 2) + "\n" }],
      `[sentinel] history: ${entry.action} — ${entry.reason}`,
      baseUrl
    );
    if (!r.ok) log.push(`[HISTORY] append failed: ${r.error}`);
  } catch (e: any) {
    log.push(`[HISTORY] append exception: ${e?.message || "unknown"}`);
  }
}
