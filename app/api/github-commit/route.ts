import { NextResponse } from "next/server";

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

async function getFileSha(path: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (res.ok) {
      const data = await res.json();
      return data.sha;
    }
    return null;
  } catch {
    return null;
  }
}

async function commitFile(file: FileToCommit, message: string, token: string): Promise<{ path: string; status: string; error?: string }> {
  try {
    const sha = await getFileSha(file.path, token);
    const body: any = {
      message: `[auto-build] ${message}: ${file.path}`,
      content: Buffer.from(file.content).toString("base64"),
      branch: BRANCH,
      committer: { name: "FlowSeer Auto-Builder", email: "autobuilder@flowseer.internal" },
    };
    if (sha) body.sha = sha; // Update existing file

    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${file.path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (res.ok) {
      return { path: file.path, status: "committed" };
    } else {
      const err = await res.json();
      return { path: file.path, status: "failed", error: err.message };
    }
  } catch (e: any) {
    return { path: file.path, status: "failed", error: e.message };
  }
}

export async function POST(req: Request) {
  try {
    const { files, message, directive_id } = await req.json();
    const token = process.env.GITHUB_PAT;

    if (!token) {
      return NextResponse.json({ error: "GITHUB_PAT not set. Add it via /api/admin." }, { status: 500 });
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "files array required. Each file needs {path, content}." }, { status: 400 });
    }

    const commitMessage = message || `Auto-build ${directive_id || "directive"}`;
    const results = [];

    for (const file of files) {
      if (!file.path || !file.content) {
        results.push({ path: file.path || "unknown", status: "skipped", error: "Missing path or content" });
        continue;
      }
      const result = await commitFile(file, commitMessage, token);
      results.push(result);
    }

    const committed = results.filter(r => r.status === "committed").length;
    const failed = results.filter(r => r.status === "failed").length;

    return NextResponse.json({
      status: failed === 0 ? "success" : committed > 0 ? "partial" : "failed",
      committed,
      failed,
      total: files.length,
      results,
      message: commitMessage,
      note: committed > 0 ? "Vercel will auto-deploy within 60 seconds." : "No files were committed.",
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
