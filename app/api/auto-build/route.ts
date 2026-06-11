import { NextResponse } from "next/server";
import { validateTailwindTokens } from "@/lib/tailwind-gate";
import { sendAlert, classifyApiError } from "@/lib/notify";

// Vercel function timeout: 300s (Pro plan max). Was 60 on Hobby.
// Pro upgrade lifted ceiling so full Sonnet 4 + 8K-token Builder fits cleanly.
export const maxDuration = 300;

const ALERT_COOLDOWN_MIN = 360; // 6h between identical alerts

/**
 * Cheap Anthropic reachability probe (1 output token). Catches the exact
 * failure mode that silently drained the queue on 2026-05-19: when the API
 * credit balance hit zero, every agent call failed instantly and each cron
 * fire burned one directive to "failed" until the queue was empty. Running
 * this BEFORE we touch the queue lets us pause cleanly and alert instead of
 * marking real work as failed.
 */
async function anthropicHealthCheck(
  apiKey: string
): Promise<{ ok: boolean; error?: string; kind?: ReturnType<typeof classifyApiError> }> {
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not set", kind: "auth" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (data?.error) {
      return { ok: false, error: data.error.message || "unknown API error", kind: classifyApiError(data.error.message) };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, kind: "other" };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "health check exception", kind: "other" };
  }
}

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
// Conditional-ship valve (2026-06-11): the PASS>=80 commit gate, combined with
// an LLM Auditor that anchors at CONDITIONAL ~72 even after its own findings
// are fixed, produced a structural deadlock — AUTO-002 through AUTO-047
// churned for weeks with ZERO commits while the queue grew. A final-attempt
// CONDITIONAL with score >= this floor and ZERO CRITICAL findings now ships,
// and the residual findings are appended to the queue as an auto fix-up
// directive. CRITICALs (compile breaks, schema mismatches) still hard-block.
const SCORE_CONDITIONAL_SHIP_MIN = 70;

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
      headers: { "Content-Type": "application/json", "x-internal-secret": (process.env.CRON_SECRET || "").trim() },
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
  extraFiles: Array<{ path: string; content: string }> = [],
  touchedIds: string[] | null = null
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  try {
    // MERGE-BEFORE-WRITE (2026-06-11). Last-writer-wins clobbered the queue
    // twice: overlapping cron runs reverted each other's directive statuses,
    // and an in-flight run wiped externally-added directives (AUTO-043/044)
    // plus a requeue. Strategy: re-fetch the live remote queue as the base,
    // then overlay ONLY (a) directives this run actually touched and (b)
    // directives the remote doesn't know about. Remote-only directives and
    // remote status changes to untouched directives are preserved.
    let toWrite: Queue = queue;
    try {
      const live = await loadQueue((process.env.GITHUB_PAT || "").trim());
      if (live?.queue?.directives) {
        const base = live.queue;
        const touched = new Set(touchedIds || []);
        const baseById = new Map(base.directives.map((d: any) => [d.id, d]));
        for (const d of queue.directives) {
          if (touched.has(d.id) || !baseById.has(d.id)) {
            baseById.set(d.id, d);
          }
        }
        base.directives = Array.from(baseById.values());
        toWrite = base;
        // keep the local in-memory queue coherent with what we persist
        queue.directives = base.directives;
      }
    } catch {
      // merge is best-effort; fall back to writing our copy
    }
    toWrite.updated_at = new Date().toISOString();
    const files = [
      { path: QUEUE_PATH, content: JSON.stringify(toWrite, null, 2) + "\n" },
      ...extraFiles,
    ];
    const res = await fetch(`${baseUrl}/api/github-commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": (process.env.CRON_SECRET || "").trim() },
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
// COMPILE GATE — deterministic static import resolution
// ----------------------------------------------------------------------
// The Auditor is an LLM. It scored AUTO-033 "95/100 PASS" even though the
// generated route imported `@/db`, a module that did not exist — so every
// deploy of that commit failed `next build` on Vercel with
// "Module not found: Can't resolve '@/db'". A serverless function can't run
// `next build`, but it CAN verify, before committing, that every LOCAL import
// in the generated files resolves to a real file (in the repo or in the same
// batch). This closes the entire "Module not found" class that has been
// breaking the loop. It is conservative: bare package imports are ignored,
// and if the repo tree can't be loaded the gate fails OPEN (never stalls the
// queue on a transient GitHub hiccup).

async function loadRepoPaths(ghPat: string): Promise<Set<string> | null> {
  const pat = (ghPat || "").trim();
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!Array.isArray(data?.tree)) return null;
    const set = new Set<string>();
    for (const e of data.tree) if (e?.path) set.add(e.path as string);
    return set;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// Builder grounding context (added 2026-06-10).
// Root cause of the AUTO-034..039 zero-throughput streak: the Builder never
// saw the repo manifest or the real DB schema, so attempt 1 was routinely
// wasted inventing imports (@/components/ui/card) and columns (createdAt),
// and the 2-attempt budget (hard-capped by the 300s function ceiling) left
// nothing for audit-feedback fixes. The tree is already fetched every cycle
// for the compile gate — now it reaches the Builder too.
// ----------------------------------------------------------------------

async function loadRepoFileRaw(ghPat: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${(ghPat || "").trim()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data && typeof data.content === "string") {
      return Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}

const REPO_CONTEXT_DIRS = ["app/", "components/", "lib/", "types/", "db/", "styles/", "middleware.ts"];
const REPO_CONTEXT_MAX_PATHS = 700;

async function buildRepoContext(
  ghPat: string,
  repoPaths: Set<string> | null
): Promise<{ source_paths: string[]; db_schema: string | null } | null> {
  if (!repoPaths) return null;
  const sourcePaths = Array.from(repoPaths)
    .filter(p => REPO_CONTEXT_DIRS.some(d => p === d || p.startsWith(d)))
    .filter(p => /\.(ts|tsx|js|jsx|css|sql)$/.test(p))
    .sort()
    .slice(0, REPO_CONTEXT_MAX_PATHS);
  const dbSchema = await loadRepoFileRaw(ghPat, "lib/db/schema.ts");
  return { source_paths: sourcePaths, db_schema: dbSchema };
}

function extractImportSpecifiers(content: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,            // import x from '...'
    /\bimport\s+['"]([^'"]+)['"]/g,          // import '...'
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,  // require('...')
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,   // dynamic import('...')
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) specs.push(m[1]);
  }
  return specs;
}

// Node builtins (with or without node: prefix) — always resolvable.
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "dns", "events", "fs", "http",
  "https", "net", "os", "path", "process", "querystring", "stream",
  "string_decoder", "timers", "tls", "url", "util", "worker_threads", "zlib",
]);

function importResolves(spec: string, importerPath: string, known: Set<string>, installedPkgs: Set<string> | null): boolean {
  let target: string;
  if (spec.startsWith("@/")) {
    target = spec.slice(2); // tsconfig: "@/*" -> "./*"
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = importerPath.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    target = dir.join("/");
  } else {
    // Bare package import. 2026-06-11: this used to fail open unconditionally —
    // AUTO-047 shipped 4 chart components importing `recharts` (not in
    // package.json); the gate waved them through, the Auditor's BUILDABILITY
    // lens missed it (the exact AUTO-006 failure mode recurring), and the
    // PASS 88/100 commit broke the production build. Now: validate the
    // package root against the live manifest. Fails open only if the
    // manifest could not be fetched (installedPkgs === null).
    if (installedPkgs === null) return true;
    const clean = spec.startsWith("node:") ? spec.slice(5) : spec;
    const segs = clean.split("/");
    const root = clean.startsWith("@") ? segs.slice(0, 2).join("/") : segs[0];
    if (NODE_BUILTINS.has(root)) return true;
    return installedPkgs.has(root);
  }
  target = target.replace(/\/+$/, "");
  const exts = [
    "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss",
    "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
  ];
  // A bare directory does NOT resolve unless it has an index file — that is
  // exactly the `@/db` case that shipped broken (db/ existed with migrations/
  // and schema/, but no db/index.ts). So we check ONLY real module targets and
  // index files; we deliberately do not treat "some file exists under dir/" as
  // resolvable.
  for (const e of exts) if (known.has(target + e)) return true;
  return false;
}

// Layer 2c Tailwind token validation lives in lib/tailwind-gate.ts (shared
// with __tests__/tailwind-gate.test.ts so the gate and its test never drift).

function validateImports(
  files: Array<{ path: string; content: string }>,
  repoPaths: Set<string>,
  installedPkgs: Set<string> | null
): Array<{ file: string; import: string }> {
  const known = new Set(repoPaths);
  for (const f of files) known.add(f.path.replace(/^\/+/, ""));
  const unresolved: Array<{ file: string; import: string }> = [];
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(f.path)) continue;
    const importer = f.path.replace(/^\/+/, "");
    for (const spec of extractImportSpecifiers(f.content || "")) {
      if (!importResolves(spec, importer, known, installedPkgs)) {
        unresolved.push({ file: f.path, import: spec });
      }
    }
  }
  return unresolved;
}

// ----------------------------------------------------------------------
// Layer 2b — Named-export validation (added 2026-06-10).
// AUTO-039 imported { Skeletons } from a path that EXISTS (so path-level
// validation passed) but exports no such symbol — broke `next build` for
// 4 hours. For named imports resolving to repo files, verify the symbol is
// actually exported. Files containing `export *` re-exports are skipped
// (can't verify without a full graph). Fetched contents are returned so the
// Auditor can see the real interfaces of everything the build imports.
// ----------------------------------------------------------------------

function extractExportedNames(content: string): { names: Set<string>; hasStar: boolean } {
  const names = new Set<string>();
  let hasStar = false;
  const src = content || "";
  if (/export\s*\*\s*from/.test(src)) hasStar = true;
  let m: RegExpExecArray | null;
  const declRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src))) names.add(m[1]);
  const braceRe = /export\s*\{([^}]+)\}/g;
  while ((m = braceRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().split(/\s+as\s+/);
      const exported = (alias[1] || alias[0]).trim();
      if (exported) names.add(exported);
    }
  }
  if (/export\s+default/.test(src)) names.add("default");
  return { names, hasStar };
}

function extractNamedImports(content: string): Array<{ spec: string; symbols: string[] }> {
  const out: Array<{ spec: string; symbols: string[] }> = [];
  const re = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content || ""))) {
    const symbols = m[1]
      .split(",")
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => s && !s.startsWith("type "));
    out.push({ spec: m[2], symbols });
  }
  return out;
}

function resolveRepoFile(spec: string, importer: string, repoPaths: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) {
    const dir = importer.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === ".") continue;
      else if (seg === "..") dir.pop();
      else dir.push(seg);
    }
    base = dir.join("/");
  }
  if (!base) return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (repoPaths.has(cand)) return cand;
  }
  return null;
}

async function validateNamedExports(
  files: Array<{ path: string; content: string }>,
  repoPaths: Set<string>,
  ghPat: string
): Promise<{ missing: Array<{ file: string; import: string; symbol: string }>; fetched: Map<string, string> }> {
  const missing: Array<{ file: string; import: string; symbol: string }> = [];
  const fetched = new Map<string, string>();
  const batchByPath = new Map(files.map(f => [f.path.replace(/^\/+/, ""), f.content || ""]));
  let fetchBudget = 12; // hard cap on GitHub content fetches per cycle
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f.path)) continue;
    const importer = f.path.replace(/^\/+/, "");
    for (const { spec, symbols } of extractNamedImports(f.content || "")) {
      if (symbols.length === 0) continue;
      const target = resolveRepoFile(spec, importer, repoPaths);
      if (!target) continue; // path-level validation owns unresolved paths
      let content = batchByPath.get(target) ?? fetched.get(target);
      if (content === undefined) {
        if (fetchBudget <= 0) continue;
        fetchBudget--;
        const raw = await loadRepoFileRaw(ghPat, target);
        if (raw === null) continue; // fail open on fetch error
        content = raw;
        fetched.set(target, raw);
      }
      const { names, hasStar } = extractExportedNames(content);
      if (hasStar) continue;
      for (const sym of symbols) {
        if (!names.has(sym)) missing.push({ file: f.path, import: spec, symbol: sym });
      }
    }
  }
  return { missing, fetched };
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

    // CANCELED deployments are *intentional skips* produced by vercel.json's
    // ignoreCommand (data-only commits). They do not change what is serving
    // production and must never be treated as an outage. Judge health by the
    // most recent deployment that actually attempted a build. (2026-06-10:
    // treating CANCELED as failure made self-heal "roll back" every cycle,
    // fueling an infinite redeploy loop with the drift watchdog.)
    const latest = deployments.find((d: any) => d.state !== "CANCELED");
    if (!latest) return { action: "healthy", current_state: "ALL_CANCELED" };
    const latestSha = latest?.meta?.githubCommitSha;

    if (latest.state === "READY") {
      return { action: "healthy", current_sha: latestSha?.slice(0, 7), current_state: "READY" };
    }
    if (latest.state === "BUILDING" || latest.state === "QUEUED" || latest.state === "INITIALIZING") {
      return { action: "in_progress", current_state: latest.state, current_sha: latestSha?.slice(0, 7) };
    }
    if (latest.state !== "ERROR") {
      return { action: "skipped", error: `Unhandled state ${latest.state}` };
    }

    // ERROR — find last READY deployment
    const errorIdx = deployments.indexOf(latest);
    const lastGood = deployments.find((d: any, i: number) => i > errorIdx && d.state === "READY");
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

    // SHAs differ — but vercel.json's ignoreCommand deliberately skips builds
    // for commits touching only data/, tools/, or docs/. If everything between
    // the deployed SHA and GitHub HEAD lives in those paths, production is in
    // sync BY DESIGN. Redeploying HEAD here just creates a deployment that
    // ignoreCommand immediately cancels, which self-heal then misread as an
    // outage — the 2026-06-09/10 infinite redeploy loop. Only buildable drift
    // (changes outside the ignored paths) warrants a force-deploy.
    const IGNORED_PREFIXES = ["data/", "tools/", "docs/"];
    try {
      const cmpRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/compare/${vercelSha}...${githubSha}`,
        {
          headers: {
            Authorization: `Bearer ${ghPat}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          cache: "no-store",
        }
      );
      const cmpData: any = await cmpRes.json();
      const files: any[] = Array.isArray(cmpData?.files) ? cmpData.files : [];
      if (cmpRes.ok && files.length > 0) {
        const buildable = files.filter(
          (f: any) => !IGNORED_PREFIXES.some(p => (f.filename || "").startsWith(p))
        );
        if (buildable.length === 0) {
          return {
            drifted: false,
            githubSha,
            vercelSha,
            action: `HEAD ahead by ignored-path-only changes (${files.length} file(s) in data/tools/docs) — in sync by design, no redeploy`,
          };
        }
      } else if (!cmpRes.ok) {
        // Can't prove the delta is buildable — do NOT blind-redeploy (that is
        // what fed the loop). Log and let the next cycle retry the compare.
        return {
          drifted: false,
          githubSha,
          vercelSha,
          error: `compare API ${cmpRes.status} — skipping redeploy this cycle`,
        };
      }
    } catch (cmpErr: any) {
      return {
        drifted: false,
        githubSha,
        vercelSha,
        error: `compare failed (${cmpErr?.message || "exception"}) — skipping redeploy this cycle`,
      };
    }

    // Per-SHA dedupe before redeploying. 2026-06-10: the watchdog redeployed
    // HEAD eight times in a row — each attempt got CANCELED because HEAD's
    // *tip* commit was data-only and ignoreCommand only diffs the tip, even
    // though the cumulative delta contained code. Rules:
    //   - A recent ERROR deploy for this SHA → that code is broken; redeploying
    //     it is futile. Leave it to the deploy-sentinel and skip.
    //   - A QUEUED/BUILDING deploy for this SHA → already in flight; skip.
    //   - Only CANCELED attempts (or none) → proceed, and disable
    //     ignoreCommand for THIS deployment via projectSettings so an
    //     intentional drift-heal can't be vetoed by the tip-commit heuristic.
    try {
      const dRes = await fetch(
        `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&limit=20`,
        { headers: { Authorization: `Bearer ${vercelToken}` }, cache: "no-store" }
      );
      const dData: any = await dRes.json();
      const sameSha = (dData?.deployments || []).filter(
        (d: any) => d?.meta?.githubCommitSha === githubSha
      );
      if (sameSha.some((d: any) => d.state === "ERROR")) {
        return {
          drifted: true,
          githubSha,
          vercelSha,
          action: `HEAD ${githubSha.slice(0, 7)} already has a failed (ERROR) deployment — not retrying; deploy-sentinel owns broken builds`,
        };
      }
      if (sameSha.some((d: any) => ["QUEUED", "BUILDING", "INITIALIZING"].includes(d.state))) {
        return {
          drifted: true,
          githubSha,
          vercelSha,
          action: `Deployment for HEAD ${githubSha.slice(0, 7)} already in flight — waiting`,
        };
      }
      // 2026-06-10: the projectSettings ignoreCommand bypass below proved
      // unreliable — watchdog redeploys of a data-only-tip SHA were CANCELED
      // every cycle for 4 hours. Two canceled attempts for the same SHA
      // means a third will cancel too: stop burning deployments and leave
      // the drift to resolve via the next code push or sentinel directive.
      const canceledAttempts = sameSha.filter((d: any) => d.state === "CANCELED").length;
      if (canceledAttempts >= 2) {
        return {
          drifted: true,
          githubSha,
          vercelSha,
          action: `HEAD ${githubSha.slice(0, 7)} already canceled ${canceledAttempts}x (ignoreCommand bypass ineffective) — not retrying`,
        };
      }
    } catch {
      // Dedupe is best-effort — fall through to redeploy on lookup failure.
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
          // Buildable drift is already confirmed above via the compare API —
          // this deploy must not be vetoed by the tip-commit ignoreCommand.
          projectSettings: { commandForIgnoringBuildStep: "" },
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

  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const url = new URL(req.url);
  const queryToken = (url.searchParams.get("token") || "").trim();

  // Auth gate (hardened 2026-05-31). Previously `?force=true` let ANYONE on
  // the internet trigger a full build cycle — spending API credits and
  // committing to the repo. Now a caller must be a Vercel Cron invocation
  // (Vercel sets x-vercel-cron and strips it from external requests) or
  // present CRON_SECRET, either via the Authorization header Vercel injects
  // into cron calls or a ?token= param for authorized manual runs.
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  const secretOk =
    cronSecret.length > 0 &&
    (authHeader === `Bearer ${cronSecret}` || queryToken === cronSecret);
  if (!isVercelCron && !secretOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  log.push(`[${new Date().toISOString()}] Auto-builder cycle started`);

  // Layer 3 — Self-Heal preflight (BEFORE drift watchdog to handle broken deploys first)
  const heal = await selfHealPreflight();
  log.push(`[SELF-HEAL] ${heal.action}${heal.current_sha ? ` @ ${heal.current_sha}` : ""}${heal.error ? ` (${heal.error})` : ""}`);
  if (heal.action === "rolled_back") {
    await sendAlert(
      "self_heal_rollback",
      `Production deploy was broken and auto-rolled-back (${heal.current_sha} → ${heal.rolled_back_to}). Site is healthy on the prior good build; the bad change needs a look.`,
      { baseUrl, cooldownMinutes: 60 }
    );
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
  const STUCK_MS = 15 * 60 * 1000;
  const now = Date.now();
  let recoveredStuck = 0;
  const recoveredIds: string[] = [];
  for (const d of queue.directives) {
    if (d.status === "in_progress" && d.started_at) {
      const startedMs = Date.parse(d.started_at);
      if (!Number.isNaN(startedMs) && now - startedMs > STUCK_MS) {
        d.status = "pending";
        d.started_at = null;
        (d as any).attempts = ((d as any).attempts || 0) + 1;
        recoveredStuck++;
        recoveredIds.push(d.id);
        log.push(`[RECOVERY] ${d.id} stuck in_progress for >30min — reset to pending (attempt #${(d as any).attempts})`);
      }
    }
  }
  if (recoveredStuck > 0) {
    await saveQueue(queue, `[RECOVERY] Reset ${recoveredStuck} stuck directive(s) to pending`, baseUrl, [], recoveredIds).catch(() => {});
  }

  // ----------------------------------------------------------------------
  // Layer 0 — API health preflight (added after the 2026-05-19 credit
  // outage). If the Anthropic API is unreachable for a PERSISTENT reason
  // (credit exhausted / bad key), pause WITHOUT consuming any directive and
  // text the operator. Transient reasons (rate limit / overloaded) also pause
  // this cycle — the next cron retries — but don't page, since they self-heal.
  // This is the single guard that prevents another silent queue burn.
  // ----------------------------------------------------------------------
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const health = await anthropicHealthCheck(anthropicKey);
  if (!health.ok) {
    const persistent = health.kind === "credit" || health.kind === "auth";
    log.push(`[PREFLIGHT] Anthropic API ${health.kind}: ${health.error} — pausing cycle, no directives consumed`);
    if (persistent) {
      await sendAlert(
        `infra_anthropic_${health.kind}`,
        `Build pipeline PAUSED — Anthropic API ${health.kind} error: "${health.error}". No directives were consumed. It resumes automatically once resolved (Console → Plans & Billing for credit issues).`,
        { baseUrl, cooldownMinutes: ALERT_COOLDOWN_MIN }
      );
    }
    return NextResponse.json({
      status: "paused",
      stage: "preflight",
      kind: health.kind,
      reason: health.error,
      note: "Anthropic API unreachable. Queue left intact; next cron will retry.",
      log,
    });
  }
  log.push(`[PREFLIGHT] Anthropic API healthy`);

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
        baseUrl,
        [],
        newOnes.map(d => d.id)
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
    await sendAlert(
      "queue_idle",
      `Build queue is empty — no pending directives and the generator produced none. The pipeline is idle until new work is added.`,
      { baseUrl, cooldownMinutes: 720 }
    );
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
  await saveQueue(queue, `[QUEUE] ${next.id} started`, baseUrl, [], [next.id]).catch(() => {});

  // ----- 5-Agent Pipeline -----

  log.push(`[ARCHITECT] Decomposing directive...`);
  const archInput = {
    directive: next.directive,
    context: "FlowSeer W251 BOP procurement platform. Next.js 14, Tailwind, TypeScript, Vercel. EQS v1.0 standards enforced.",
  };
  let archResult = await runAgent("architect", archInput, baseUrl);
  if (!archResult?.spec && !archResult?.raw) {
    // One immediate retry — a single Anthropic hiccup or cold-start fetch
    // failure should not consume the whole cycle (2026-06-10: AUTO-034 was
    // permanently failed by one transient architect miss right after a
    // deployment swap).
    log.push(`[ARCHITECT] First call failed (${archResult?.error || "no spec"}) — retrying once...`);
    archResult = await runAgent("architect", archInput, baseUrl);
  }
  if (!archResult?.spec && !archResult?.raw) {
    const archErr = archResult?.error || "No spec returned";
    log.push(`[ARCHITECT] FAILED after retry: ${archErr}`);
    // Infrastructure failure, not a directive defect — requeue (cap 3) so
    // the next cycle retries instead of killing the directive.
    const archRetries = ((next as any).architect_error_retries || 0) as number;
    if (archRetries < 3) {
      (next as any).architect_error_retries = archRetries + 1;
      next.status = "pending";
      (next as any).failure_detail = `architect infra failure: ${String(archErr).slice(0, 300)}`;
      await saveQueue(queue, `[QUEUE] ${next.id} requeued (architect infra failure, retry ${archRetries + 1}/3): ${String(archErr).slice(0, 120)}`, baseUrl, [], [next.id]).catch(() => {});
    } else {
      next.status = "failed";
      next.completed_at = new Date().toISOString();
      (next as any).failure_detail = `architect failed ${archRetries + 1}x: ${String(archErr).slice(0, 300)}`;
      await saveQueue(queue, `[QUEUE] ${next.id} failed at architect after ${archRetries + 1} cycles: ${String(archErr).slice(0, 120)}`, baseUrl, [], [next.id]).catch(() => {});
    }
    return NextResponse.json({
      status: next.status === "pending" ? "requeued" : "failed",
      directive: next.id, stage: "architect",
      error: archErr, log, elapsed: (Date.now() - startTime) / 1000,
    });
  }
  log.push(`[ARCHITECT] Complete`);

  // Lossless scope splitting (2026-06-11): if the Architect deferred scope
  // into follow_up_directives, append them to the queue as pending NOW so
  // deferred requirements can never be silently dropped. The EQS standard
  // covers the full original scope — splitting changes sequencing, not
  // coverage.
  const followUps: any[] = Array.isArray((archResult.spec || archResult)?.follow_up_directives)
    ? (archResult.spec || archResult).follow_up_directives
    : [];
  if (followUps.length > 0) {
    const maxNum = queue.directives.reduce((m: number, d: any) => {
      const n = parseInt(String(d.id || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    followUps.slice(0, 4).forEach((fu: any, i: number) => {
      if (!fu?.directive) return;
      queue.directives.push({
        id: `AUTO-${String(maxNum + 1 + i).padStart(3, "0")}`,
        title: String(fu.title || "Follow-up").slice(0, 120),
        directive: String(fu.directive),
        status: "pending",
        created_at: new Date().toISOString(),
        origin: `split_from:${next.id}`,
      } as any);
    });
    log.push(`[ARCHITECT] Lossless split: ${Math.min(followUps.length, 4)} follow-up directive(s) appended to queue (origin ${next.id})`);
  }
  // Scope-limit telemetry — never truncate: the audit must evaluate every
  // criterion the spec demands. Oversized specs are an Architect defect to
  // surface, not requirements to drop.
  const critCount = (archResult.spec || archResult)?.acceptance_criteria?.length || 0;
  if (critCount > 8) {
    log.push(`[ARCHITECT] WARNING: ${critCount} acceptance criteria exceeds the 8-criteria scope limit — spec proceeds UNTRUNCATED; expect split on regeneration`);
  }

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
  // Capped at 2 (was 3): a full 3-attempt cycle runs ~300s+ and gets killed
  // by the Vercel function timeout mid-build, orphaning the directive
  // in_progress and (on retry) looping while burning credits with no result.
  // Two attempts complete in ~220s — safely under the 300s ceiling — so the
  // directive always reaches a definite pass/fail instead of timing out.
  const MAX_BUILD_ATTEMPTS = 2;
  // Live repo tree for the deterministic compile gate (fail-open if unavailable).
  const repoPaths = await loadRepoPaths(ghPat);
  log.push(
    repoPaths
      ? `[COMPILE-GATE] Repo tree loaded (${repoPaths.size} paths)`
      : `[COMPILE-GATE] Repo tree unavailable — gate fails open this cycle`
  );
  // Package manifest for bare-import validation in the compile gate.
  let installedPkgs: Set<string> | null = null;
  try {
    const pkgRes = await fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/package.json`,
      { cache: "no-store" }
    );
    if (pkgRes.ok) {
      const pkg = await pkgRes.json();
      installedPkgs = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ]);
    }
  } catch { /* fail open — gate skips bare-import validation this cycle */ }
  // Tailwind config source for token validation (Layer 2c).
  let tailwindConfigSrc: string | null = null;
  try {
    for (const cfgName of ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs"]) {
      const cfgRes = await fetch(
        `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${cfgName}`,
        { cache: "no-store" }
      );
      if (cfgRes.ok) { tailwindConfigSrc = await cfgRes.text(); break; }
    }
  } catch { /* fail open — gate skips Tailwind token validation this cycle */ }
  log.push(
    installedPkgs
      ? `[COMPILE-GATE] Manifest loaded (${installedPkgs.size} packages) — bare imports validated`
      : `[COMPILE-GATE] Manifest unavailable — bare imports fail open this cycle`
  );
  // Grounding context for the Builder — manifest + real schema (see helper).
  const repoContext = await buildRepoContext(ghPat, repoPaths);
  log.push(
    repoContext
      ? `[GROUNDING] Builder context: ${repoContext.source_paths.length} source paths, schema ${repoContext.db_schema ? "loaded" : "MISSING"}`
      : `[GROUNDING] Repo context unavailable — Builder runs ungrounded this cycle`
  );
  let buildResult: any = null;
  let auditResult: any = null;
  let rawVerdict = "UNKNOWN";
  let score: number | null = null;
  let gate: GateResult = { allowed: false, reason: "no build attempted", effective_verdict: "FAIL" };
  let buildAttempts = 0;
  let importedInterfaces: Map<string, string> = new Map();
  let bestAudit: { score: number | null; verdict: string; issues: any[] } | null = null;
  // Seed attempt 1 from feedback carried over a near-miss requeue (see the
  // post-loop block) so the new cycle continues the work, not restarts it.
  let retryContext: string | undefined = (next as any).carryover_feedback || undefined;
  // Structured prior findings for the Auditor's delta-audit convergence rule.
  // Seeded from a near-miss carryover; updated after every audited attempt.
  let priorIssuesForAudit: any[] | null = Array.isArray((next as any).carryover_issues) ? (next as any).carryover_issues : null;
  let priorScoreForAudit: number | null = typeof (next as any).carryover_score === "number" ? (next as any).carryover_score : null;
  if ((next as any).carryover_issues) delete (next as any).carryover_issues;
  if ((next as any).carryover_score !== undefined) delete (next as any).carryover_score;
  if (retryContext) {
    delete (next as any).carryover_feedback;
    log.push(`[CARRYOVER] Attempt 1 seeded with prior cycle's audit findings`);
  }
  const attemptHistory: Array<{ attempt: number; verdict: string; score: number | null; effective: string }> = [];

  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    buildAttempts = attempt;
    log.push(`[BUILDER] Attempt ${attempt}/${MAX_BUILD_ATTEMPTS} — generating code...`);
    buildResult = await runAgent("builder", {
      spec: archResult.spec || archResult,
      research: researchResults,
      analysis: analysisResult?.analysis || {},
      ...(repoContext ? { repo_context: repoContext } : {}),
      ...(retryContext ? { retry_context: retryContext } : {}),
    }, baseUrl);

    if (!buildResult?.build) {
      log.push(`[BUILDER] Attempt ${attempt} FAILED: ${buildResult?.error || "No build returned"}`);
      if (attempt === MAX_BUILD_ATTEMPTS) {
        next.status = "failed";
        next.completed_at = new Date().toISOString();
        await saveQueue(queue, `[QUEUE] ${next.id} failed at builder after ${attempt} attempts`, baseUrl, [], [next.id]).catch(() => {});
        return NextResponse.json({
          status: "failed", directive: next.id, stage: "builder",
          error: buildResult?.error, log, elapsed: (Date.now() - startTime) / 1000,
        });
      }
      retryContext = `Previous attempt produced no parseable build output. Emit valid JSON with a complete files array.`;
      continue;
    }
    log.push(`[BUILDER] Attempt ${attempt} complete — ${buildResult.build.files?.length || 0} files`);

    // ── COMPILE GATE (deterministic, pre-audit) ──────────────────────────
    // Before we trust the LLM auditor or commit anything, verify every local
    // import in the generated files actually resolves. This is the lens the
    // auditor lacked when it passed AUTO-033's `@/db` (Module not found).
    if (repoPaths) {
      const batch = (buildResult.build.files || []).map((f: any) => ({
        path: f.path,
        content: typeof f.content === "string" ? f.content : "",
      }));
      const unresolved = validateImports(batch, repoPaths, installedPkgs);
      if (unresolved.length > 0) {
        const detail = unresolved.slice(0, 8).map(u => `  ${u.file} → '${u.import}'`).join("\n");
        log.push(`[COMPILE-GATE] Attempt ${attempt}: ${unresolved.length} unresolved import(s):\n${detail}`);
        attemptHistory.push({ attempt, verdict: "COMPILE_FAIL", score: null, effective: "FAIL" });
        if (attempt < MAX_BUILD_ATTEMPTS) {
          retryContext = [
            `Your previous output DOES NOT COMPILE. These imports point to files that do not exist in the repo and were not included in your output:`,
            detail,
            `Fix EVERY one — either import from the correct existing path, or include the missing file in your files array. Re-emit the COMPLETE set of files. Never import a module that does not exist.`,
          ].join("\n");
          log.push(`[RETRY] Re-running Builder to fix unresolved imports (attempt ${attempt + 1}/${MAX_BUILD_ATTEMPTS})`);
          continue;
        }
        // Out of attempts — hard-block commit so the broken code never ships.
        gate = {
          allowed: false,
          reason: `compile gate: ${unresolved.length} unresolved import(s) after ${attempt} attempt(s)`,
          effective_verdict: "FAIL",
        };
        rawVerdict = "COMPILE_FAIL";
        break;
      }
      log.push(`[COMPILE-GATE] Attempt ${attempt}: all imports resolve`);

      // Layer 2c — Tailwind token gate. Catches AUTO-048's class of break:
      // a color utility (border-border, bg-card, bg-bg) whose token is absent
      // from tailwind.config, which fails `next build` at the CSS layer.
      const badTw = validateTailwindTokens(batch, tailwindConfigSrc);
      if (badTw.length > 0) {
        const detail = badTw.slice(0, 8).map(u => `  ${u.file} → '${u.cls}'`).join("\n");
        log.push(`[COMPILE-GATE] Attempt ${attempt}: ${badTw.length} undefined Tailwind token(s):\n${detail}`);
        attemptHistory.push({ attempt, verdict: "COMPILE_FAIL", score: null, effective: "FAIL" });
        if (attempt < MAX_BUILD_ATTEMPTS) {
          retryContext = [
            `Your previous output uses Tailwind color utilities whose tokens are NOT defined in tailwind.config:`,
            detail,
            `Either use a token that exists in the config, or include the tailwind.config change that defines these tokens in your files array. A class like \`border-border\` requires a \`border\` color key under theme.extend.colors. Re-emit the COMPLETE set of files.`,
          ].join("\n");
          log.push(`[RETRY] Re-running Builder to fix undefined Tailwind tokens (attempt ${attempt + 1}/${MAX_BUILD_ATTEMPTS})`);
          continue;
        }
        gate = {
          allowed: false,
          reason: `compile gate: ${badTw.length} undefined Tailwind token(s) after ${attempt} attempt(s)`,
          effective_verdict: "FAIL",
        };
        rawVerdict = "COMPILE_FAIL";
        break;
      }
      log.push(`[COMPILE-GATE] Attempt ${attempt}: all Tailwind tokens defined`);

      // Symbol-level pass (Layer 2b) — catches AUTO-039's class of break:
      // named import of a symbol the (existing) target file doesn't export.
      const symCheck = await validateNamedExports(batch, repoPaths, ghPat);
      importedInterfaces = symCheck.fetched;
      if (symCheck.missing.length > 0) {
        const detail = symCheck.missing.slice(0, 8).map(u => `  ${u.file} → '${u.import}' has no export '${u.symbol}'`).join("\n");
        log.push(`[COMPILE-GATE] Attempt ${attempt}: ${symCheck.missing.length} missing named export(s):\n${detail}`);
        attemptHistory.push({ attempt, verdict: "COMPILE_FAIL", score: null, effective: "FAIL" });
        if (attempt < MAX_BUILD_ATTEMPTS) {
          const exportLists = Array.from(symCheck.fetched.entries())
            .map(([p, c]) => `${p} exports: ${Array.from(extractExportedNames(c).names).join(", ") || "(none parsed)"}`)
            .join("\n");
          retryContext = [
            `Your previous output imports symbols that DO NOT EXIST in the target files:`,
            detail,
            `The actual exports of those files are:`,
            exportLists,
            `Use only symbols that actually exist (or include your own implementation in the files array). Re-emit the COMPLETE set of files.`,
          ].join("\n");
          log.push(`[RETRY] Re-running Builder to fix missing exports (attempt ${attempt + 1}/${MAX_BUILD_ATTEMPTS})`);
          continue;
        }
        gate = {
          allowed: false,
          reason: `compile gate: ${symCheck.missing.length} missing named export(s) after ${attempt} attempt(s)`,
          effective_verdict: "FAIL",
        };
        rawVerdict = "COMPILE_FAIL";
        break;
      }
      log.push(`[COMPILE-GATE] Attempt ${attempt}: all named exports verified (${symCheck.fetched.size} repo file(s) inspected)`);
    }

    log.push(`[AUDITOR] Reviewing attempt ${attempt}...`);
    auditResult = await runAgent("auditor", {
      spec: archResult.spec || archResult,
      build: buildResult.build,
      research: researchResults,
      ...(repoContext ? { repo_context: repoContext } : {}),
      imported_files: Array.from(importedInterfaces.entries()).map(([p, c]) => ({
        path: p,
        content: c.slice(0, 4000),
      })),
      // Delta-audit: on attempt >= 2 (or a carryover cycle) the Auditor judges
      // the revision against the prior findings, with a mandatory convergence
      // rule — all prior CRITICAL/HIGH resolved + no new CRITICAL => PASS.
      ...(priorIssuesForAudit && priorIssuesForAudit.length > 0
        ? { prior_issues: priorIssuesForAudit.slice(0, 8), prior_score: priorScoreForAudit }
        : {}),
    }, baseUrl);
    rawVerdict = auditResult?.audit?.verdict || "UNKNOWN";
    score = auditResult?.audit?.score ?? null;
    log.push(`[AUDITOR] Attempt ${attempt} verdict: ${rawVerdict}${score !== null ? ` (${score}/100)` : ""}`);

    gate = scoreGate(rawVerdict, score);
    attemptHistory.push({ attempt, verdict: rawVerdict, score, effective: gate.effective_verdict });
    if (Array.isArray(auditResult?.audit?.issues) && auditResult.audit.issues.length > 0) {
      priorIssuesForAudit = auditResult.audit.issues;
      priorScoreForAudit = typeof score === "number" ? score : null;
    }
    log.push(`[GATE] Attempt ${attempt}: ${gate.reason} → ${gate.effective_verdict}`);

    // Track the best audited attempt (2026-06-11): a later attempt that
    // regresses (e.g. compile-fails) must not erase an earlier near-miss.
    // AUTO-041's attempt 1 scored 72; attempt 2 broke the compile gate and
    // the directive was permanently failed on the worse result.
    if (typeof score === "number" && (bestAudit === null || score > (bestAudit.score as number))) {
      bestAudit = {
        score,
        verdict: gate.effective_verdict,
        issues: Array.isArray(auditResult?.audit?.issues) ? auditResult.audit.issues : [],
      };
    }

    // Clean PASS — break out of retry loop and commit.
    if (gate.effective_verdict === "PASS") {
      break;
    }
    // CONDITIONAL or FAIL with attempts remaining — feed auditor issues back
    // to Builder. 2026-06-10: sub-floor FAILs previously got no retry even
    // with concrete fixable findings (AUTO-035 died at 55 with a wrong
    // migration column name and a missing import while attempt 2 sat unused).
    // A FAIL's issues are exactly as actionable as a CONDITIONAL's; the
    // commit gate below still requires a clean PASS either way.
    if (attempt < MAX_BUILD_ATTEMPTS && (gate.effective_verdict === "CONDITIONAL" || gate.effective_verdict === "FAIL")) {
      const issues: any[] = Array.isArray(auditResult?.audit?.issues) ? auditResult.audit.issues : [];
      const topIssues = issues.slice(0, 5).map((i: any, idx: number) =>
        `${idx + 1}. [${i.severity || "?"}] ${i.description || JSON.stringify(i)}${i.fix ? ` FIX: ${i.fix}` : ""}`
      ).join("\n");
      retryContext = [
        `Previous attempt scored ${score}/100 (${rawVerdict}).`,
        `You MUST fix these issues and re-emit the COMPLETE set of files (do not omit any file from the spec):`,
        topIssues || "(auditor returned no structured issues — re-emit complete spec)",
      ].join("\n");
      log.push(`[RETRY] Re-running Builder with auditor feedback (next attempt ${attempt + 1}/${MAX_BUILD_ATTEMPTS})`);
      continue;
    }
    // No attempts left — exit loop, will fail below.
    break;
  }

  const effectiveVerdict = gate.effective_verdict;
  const builderFileCount = buildResult?.build?.files?.length || 0;
  const builderParseError = buildResult?.build?.parse_error === true;

  // Commit on a clean PASS — or via the conditional-ship valve: a
  // final-attempt CONDITIONAL with score >= SCORE_CONDITIONAL_SHIP_MIN and
  // ZERO CRITICAL findings ships, with residual findings appended to the
  // queue as an auto fix-up directive. Without this valve the pipeline
  // deadlocked: the Auditor never awards PASS>=80 in practice, so nothing
  // committed for weeks while the queue grew (AUTO-002 → AUTO-047).
  let commitResult: any = null;
  const cleanPass = effectiveVerdict === "PASS" && builderFileCount > 0;
  const finalIssues: any[] = Array.isArray(auditResult?.audit?.issues) ? auditResult.audit.issues : [];
  const finalHasCritical = finalIssues.some((i: any) => String(i?.severity || "").toUpperCase() === "CRITICAL");
  const conditionalShip =
    !cleanPass &&
    gate.allowed &&
    effectiveVerdict === "CONDITIONAL" &&
    typeof score === "number" && score >= SCORE_CONDITIONAL_SHIP_MIN &&
    !finalHasCritical &&
    builderFileCount > 0 &&
    !builderParseError;
  const shouldCommit = cleanPass || conditionalShip;

  if (shouldCommit) {
    const shipLabel = conditionalShip ? `CONDITIONAL-SHIP ${score}/100 (zero CRITICAL)` : `PASS ${score}/100`;
    log.push(`[COMMIT] Committing ${builderFileCount} file(s) + queue status (${shipLabel} on attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})...`);
    next.status = "complete";
    next.completed_at = new Date().toISOString();
    next.auditor_score = score;
    (next as any).build_attempts = buildAttempts;
    if (conditionalShip) {
      (next as any).conditional_ship = true;
      // Residual-findings fix-up directive: ship now, repay the debt next
      // cycle. Never spawned from a -FIX directive (no recursion) and never
      // duplicated.
      const fixId = `${next.id}-FIX`;
      if (!next.id.endsWith("-FIX") && !queue.directives.some((d) => d.id === fixId) && finalIssues.length > 0) {
        const issueLines = finalIssues.slice(0, 8).map((i: any, idx: number) =>
          `${idx + 1}. [${i.severity || "?"}] ${i.file ? i.file + ": " : ""}${i.description || JSON.stringify(i)}${i.fix ? ` FIX: ${i.fix}` : ""}`
        ).join("\n");
        queue.directives.push({
          id: fixId,
          title: `Fix residual audit findings from ${next.id}`,
          directive: `${next.id} ("${next.title}") shipped via the conditional-ship valve at ${score}/100 with zero CRITICAL findings. Resolve every residual audit finding below in the files committed by that directive. Do not change unrelated files, do not regress passing acceptance criteria.\n\nRESIDUAL FINDINGS:\n${issueLines}`,
          priority: typeof next.priority === "number" ? next.priority : 5,
          status: "pending",
          origin: "auto",
          rationale: `Auto-generated debt repayment for conditional-ship of ${next.id}`,
          created_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
          commit_sha: null,
          auditor_score: null,
        } as any);
        log.push(`[QUEUE] Appended fix-up directive ${fixId} (${Math.min(finalIssues.length, 8)} residual finding(s))`);
      }
    }

    const commitMsg = `[${next.id}] ${next.title} — ${shipLabel} (attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})`;

    const persist = await saveQueue(
      queue,
      commitMsg,
      baseUrl,
      buildResult.build.files.map((f: any) => ({ path: f.path, content: f.content })),
      [next.id]
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

    // Infrastructure failure vs quality failure. AUDIT_ERROR means the
    // Auditor LLM never produced a parseable verdict — the CODE was never
    // judged. Permanently failing the directive for that (AUTO-034,
    // 2026-06-09) wastes good work. Requeue as pending so the next cron
    // cycle retries, capped at 3 audit-infra retries to avoid livelock.
    const auditInfraFailure = rawVerdict === "AUDIT_ERROR" || auditResult?.audit?.audit_error === true;
    const auditRetries = ((next as any).audit_error_retries || 0) as number;
    // Near-miss carryover (2026-06-10, widened 2026-06-11): judged on the
    // BEST audited attempt, not the last — a final compile-fail must not
    // bury a 70+ CONDITIONAL. Carryover never lowers the bar: nothing
    // commits below a clean PASS; this only retries with memory.
    const nearMissRetries = ((next as any).near_miss_retries || 0) as number;
    const nearMissBasis = bestAudit && typeof bestAudit.score === "number" && bestAudit.score >= 70 && bestAudit.verdict === "CONDITIONAL"
      ? bestAudit
      : null;
    const isNearMiss = nearMissBasis !== null && builderFileCount > 0 && nearMissRetries < 2;
    if (auditInfraFailure && auditRetries < 3) {
      (next as any).audit_error_retries = auditRetries + 1;
      next.status = "pending";
      (next as any).skip_reason = `${skipReason} — audit infrastructure failure, requeued (retry ${auditRetries + 1}/3)`;
      log.push(`[QUEUE] ${next.id} requeued as pending — audit infra failure (retry ${auditRetries + 1}/3)`);
    } else if (isNearMiss) {
      const carried = (nearMissBasis!.issues || []).slice(0, 6).map((i: any, idx: number) =>
        `${idx + 1}. [${i.severity || "?"}] ${i.description || JSON.stringify(i)}${i.fix ? ` FIX: ${i.fix}` : ""}`
      ).join("\n");
      const lastAttemptNote = rawVerdict === "COMPILE_FAIL"
        ? `\nNOTE: the most recent attempt ALSO failed the compile gate (${gate.reason}) — do not repeat that import/export mistake.`
        : "";
      (next as any).near_miss_retries = nearMissRetries + 1;
      (next as any).carryover_issues = (nearMissBasis!.issues || []).slice(0, 8);
      (next as any).carryover_score = nearMissBasis!.score;
      (next as any).carryover_feedback = [
        `A previous cycle's best attempt scored ${nearMissBasis!.score}/100 (CONDITIONAL). These are the EXACT remaining findings. Fix every one of them in your FIRST attempt this cycle:`,
        carried || "(no structured issues — re-emit the complete spec with maximum rigor)",
      ].join("\n") + lastAttemptNote;
      next.status = "pending";
      (next as any).skip_reason = `${skipReason} — near-miss (best ${nearMissBasis!.score}/100), requeued with carried feedback (carryover ${nearMissRetries + 1}/2)`;
      log.push(`[QUEUE] ${next.id} requeued as pending — near-miss best ${nearMissBasis!.score}/100, feedback carried (${nearMissRetries + 1}/2)`);
    } else {
      next.status = "failed";
      next.completed_at = new Date().toISOString();
      (next as any).skip_reason = skipReason;
    }
    next.auditor_score = score;
    (next as any).build_attempts = buildAttempts;
    (next as any).attempt_history = attemptHistory;
    await saveQueue(queue, `[QUEUE] ${next.id} ${next.status === "pending" ? "requeued" : "skipped"}: ${skipReason}`, baseUrl, [], [next.id]).catch(() => {});
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
    queue, // queue payload merged against live remote; touched = this run's directive
    `[DEBUG] last_run snapshot for ${next.id}`,
    baseUrl,
    [{ path: "data/last_run.json", content: JSON.stringify(runSnapshot, null, 2) + "\n" }],
    [next.id]
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
