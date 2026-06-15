import { NextResponse } from "next/server";
import { requireInternal } from "@/lib/api-guard";

/**
 * GitHub Commit API
 * 
 * Accepts an array of files and commits them directly to the ssc-v2 repo
 * via the GitHub Contents API. This closes the autonomous build loop:
 * 
 * Vercel Cron → Auto-Build → AI Agents → GitHub Commit → Vercel Deploy
 * 
 * No human in the loop.
 */

const REPO_OWNER = "Buch5303";
const REPO_NAME = "ssc-v2";
const BRANCH = "main";

interface FileToCommit {
  path: string;
  content: string;
}

const API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Atomically commit ALL files in a single git commit via the Git Data API
 * (blobs → tree → commit → ref update).
 *
 * Why this replaced the previous per-file Contents-API loop: that loop made
 * ONE commit per file, and every commit to main triggers its own Vercel
 * production deploy. A multi-file directive therefore fired N deploys and
 * passed through transient, half-applied trees (file A referencing file B
 * before B was committed) — which deployed RED, tripped the Self-Heal
 * rollback, and generated a failure notice on every cycle. One atomic commit
 * = one deploy = the tree is never half-applied.
 */
async function atomicCommit(
  files: FileToCommit[],
  message: string,
  token: string,
  branch: string = BRANCH
): Promise<{ ok: boolean; sha?: string; error?: string; branch?: string }> {
  const h = ghHeaders(token);
  try {
    // 1. Resolve the base commit. main commits stack on main's head as before.
    //    Candidate branches (promotion gate) are ALWAYS based on main's current
    //    head — a candidate is exactly "main + this batch", so a later
    //    fast-forward of main onto the candidate can never fail on a stale base.
    const mainRefRes = await fetch(`${API}/git/ref/heads/${BRANCH}`, { headers: h, cache: "no-store" });
    if (!mainRefRes.ok) return { ok: false, error: `read main ref: HTTP ${mainRefRes.status} ${(await mainRefRes.text()).slice(0, 160)}` };
    const mainSha = (await mainRefRes.json())?.object?.sha;
    if (!mainSha) return { ok: false, error: "could not resolve main head" };
    const baseCommitSha = mainSha;
    if (branch !== BRANCH) {
      // Ensure the candidate ref exists; its head is irrelevant (we force-update
      // it below and always tree off main), but the PATCH in step 6 needs a ref.
      const candRes = await fetch(`${API}/git/ref/heads/${branch}`, { headers: h, cache: "no-store" });
      if (candRes.status === 404) {
        const createRes = await fetch(`${API}/git/refs`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
        });
        if (!createRes.ok) return { ok: false, error: `create branch ${branch}: HTTP ${createRes.status} ${(await createRes.text()).slice(0, 160)}` };
      } else if (!candRes.ok) {
        return { ok: false, error: `read ref ${branch}: HTTP ${candRes.status} ${(await candRes.text()).slice(0, 160)}` };
      }
    }

    // 2. Base tree
    const baseCommitRes = await fetch(`${API}/git/commits/${baseCommitSha}`, { headers: h, cache: "no-store" });
    if (!baseCommitRes.ok) return { ok: false, error: `read base commit: HTTP ${baseCommitRes.status}` };
    const baseTreeSha = (await baseCommitRes.json())?.tree?.sha;
    if (!baseTreeSha) return { ok: false, error: "could not resolve base tree sha" };

    // 3. One blob per file
    const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (const f of files) {
      const blobRes = await fetch(`${API}/git/blobs`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" }),
      });
      if (!blobRes.ok) return { ok: false, error: `blob ${f.path}: HTTP ${blobRes.status} ${(await blobRes.text()).slice(0, 160)}` };
      const blobSha = (await blobRes.json())?.sha;
      if (!blobSha) return { ok: false, error: `blob ${f.path}: no sha returned` };
      treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: blobSha });
    }

    // 4. New tree on top of base
    const treeRes = await fetch(`${API}/git/trees`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeRes.ok) return { ok: false, error: `create tree: HTTP ${treeRes.status} ${(await treeRes.text()).slice(0, 160)}` };
    const newTreeSha = (await treeRes.json())?.sha;
    if (!newTreeSha) return { ok: false, error: "could not create tree" };

    // 5. New commit
    const author = { name: "FlowSeer Auto-Builder", email: "autobuilder@flowseer.internal", date: new Date().toISOString() };
    const commitRes = await fetch(`${API}/git/commits`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        message: `[auto-build] ${message}`,
        tree: newTreeSha,
        parents: [baseCommitSha],
        author,
        committer: author,
      }),
    });
    if (!commitRes.ok) return { ok: false, error: `create commit: HTTP ${commitRes.status} ${(await commitRes.text()).slice(0, 160)}` };
    const newCommitSha = (await commitRes.json())?.sha;
    if (!newCommitSha) return { ok: false, error: "could not create commit" };

    // 6. Advance the target branch. main is non-force (rejects if someone else
    //    moved it). Candidate branches are disposable and always rebuilt off
    //    main, so they force-update to the new commit.
    const updRes = await fetch(`${API}/git/refs/heads/${branch}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ sha: newCommitSha, force: branch !== BRANCH }),
    });
    if (!updRes.ok) return { ok: false, error: `update ref ${branch}: HTTP ${updRes.status} ${(await updRes.text()).slice(0, 160)}` };

    return { ok: true, sha: newCommitSha, branch };
  } catch (e: any) {
    return { ok: false, error: e?.message || "atomicCommit exception" };
  }
}

export async function POST(req: Request) {
  const denied = requireInternal(req);
  if (denied) return denied;
  try {
    const { files, message, directive_id, branch } = await req.json();
    const token = process.env.GITHUB_PAT;
    const targetBranch = typeof branch === "string" && branch.trim() ? branch.trim() : BRANCH;

    if (!token) {
      return NextResponse.json({ error: "GITHUB_PAT not set. Add it via /api/admin." }, { status: 500 });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "files array required. Each file needs {path, content}." }, { status: 400 });
    }

    const commitMessage = message || `Auto-build ${directive_id || "directive"}`;

    // Validate + filter
    const valid: FileToCommit[] = [];
    const results: Array<{ path: string; status: string; error?: string; sha?: string }> = [];
    for (const file of files) {
      if (!file.path || typeof file.content !== "string" || file.content.length === 0) {
        results.push({ path: file.path || "unknown", status: "skipped", error: "Missing path or content" });
        continue;
      }
      valid.push({ path: file.path, content: file.content });
    }

    if (valid.length === 0) {
      return NextResponse.json({
        status: "failed", committed: 0, failed: 0, total: files.length, results,
        message: commitMessage, note: "No valid files to commit.", timestamp: new Date().toISOString(),
      });
    }

    // ONE atomic commit for the whole batch → ONE deploy, never a half-applied tree.
    const commit = await atomicCommit(valid, commitMessage, token, targetBranch);

    if (commit.ok) {
      for (const f of valid) results.push({ path: f.path, status: "committed", sha: commit.sha });
    } else {
      for (const f of valid) results.push({ path: f.path, status: "failed", error: commit.error });
    }

    const committed = results.filter(r => r.status === "committed").length;
    const failed = results.filter(r => r.status === "failed").length;

    return NextResponse.json({
      status: commit.ok ? "success" : "failed",
      committed,
      failed,
      total: files.length,
      sha: commit.sha,
      branch: commit.branch || targetBranch,
      results,
      message: commitMessage,
      note: commit.ok ? "Single atomic commit pushed. Vercel will auto-deploy within 60 seconds." : `Commit failed: ${commit.error}`,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const raw = process.env.GITHUB_PAT || "";
  const token = raw.trim();
  const hasToken = !!token;

  if (!hasToken) {
    return NextResponse.json({
      endpoint: "/api/github-commit",
      status: "NEEDS GITHUB_PAT env var",
      auth: "missing",
      repo: `${REPO_OWNER}/${REPO_NAME}`,
      branch: BRANCH,
    });
  }

  // Actually hit GitHub with the token — don't just check it's present.
  // This catches trailing-whitespace PATs, expired tokens, and scope issues.
  let auth: "ok" | "failed" = "failed";
  let authError: string | undefined;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );
    if (res.ok) {
      auth = "ok";
    } else {
      const body = await res.text().catch(() => "");
      authError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
    }
  } catch (e: any) {
    authError = e?.message || "fetch exception";
  }

  // Flag if raw value had whitespace (common paste error in Vercel env UI)
  const hadWhitespace = raw !== token;

  return NextResponse.json({
    endpoint: "/api/github-commit",
    status: auth === "ok" ? "ACTIVE — Can commit files to repo" : "AUTH FAILED — see auth_error",
    auth,
    auth_error: authError,
    pat_had_whitespace: hadWhitespace,
    repo: `${REPO_OWNER}/${REPO_NAME}`,
    branch: BRANCH,
  });
}
