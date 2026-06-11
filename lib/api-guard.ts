import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Shared API auth guard (2026-06-11).
 *
 * Security audit found 9+ API routes with NO authentication, including
 * /api/github-commit — an unauthenticated endpoint that commits arbitrary
 * files to main with the server-side GitHub PAT (i.e. remote code execution
 * into production for anyone on the internet). Every sensitive route now
 * calls one of these guards as its first statement.
 *
 * Two acceptance paths:
 *   1. Internal secret — server-to-server calls (cron pipeline, sentinel,
 *      notify) send `Authorization: Bearer <CRON_SECRET|ADMIN_SECRET>` or
 *      `x-internal-secret`.
 *   2. NextAuth session — browser calls from the cookie-authenticated
 *      dashboard (same-origin fetch carries the session JWT cookie).
 *
 * requireInternal()       → secret only (e.g. github-commit).
 * requireSessionOrInternal() → either path (dashboard-facing APIs).
 *
 * Both return null when authorized, or a 401 NextResponse to return as-is.
 * Fails CLOSED: if no secrets are configured, nothing passes path 1.
 */

function hasValidInternalSecret(req: Request): boolean {
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-internal-secret") || "").trim();
  const provided = bearer || headerSecret;
  if (!provided) return false;
  const valid = [process.env.CRON_SECRET, process.env.ADMIN_SECRET]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0);
  return valid.some((s) => s === provided);
}

export function requireInternal(req: Request): NextResponse | null {
  if (hasValidInternalSecret(req)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function requireSessionOrInternal(req: Request): Promise<NextResponse | null> {
  if (hasValidInternalSecret(req)) return null;
  try {
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (token) return null;
  } catch {
    // fall through to 401
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
