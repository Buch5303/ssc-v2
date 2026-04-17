import { NextResponse } from "next/server";

const VERCEL_API = "https://api.vercel.com";
const PROJECT_ID = "prj_xkkc4f5HDNmz8r2NSowGeXG97tCe";
const TEAM_ID = "team_YC8EeZxkrZ7q7TcsHM1KXekk";

async function vercelFetch(path: string, method: string, body?: any) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { error: "VERCEL_TOKEN not set — add it in Vercel dashboard once, then this manages itself" };

  const res = await fetch(`${VERCEL_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export async function POST(req: Request) {
  try {
    const { action, key, value, keys } = await req.json();

    switch (action) {
      // Set a single env var
      case "set_env": {
        if (!key || !value) return NextResponse.json({ error: "key and value required" }, { status: 400 });
        const result = await vercelFetch(
          `/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
          "POST",
          { key, value, type: "plain", target: ["production", "preview", "development"] }
        );
        return NextResponse.json({ action: "set_env", key, result });
      }

      // Set multiple env vars at once
      case "set_env_batch": {
        if (!keys || !Array.isArray(keys)) return NextResponse.json({ error: "keys array required" }, { status: 400 });
        const results = [];
        for (const { key: k, value: v } of keys) {
          const result = await vercelFetch(
            `/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
            "POST",
            { key: k, value: v, type: "plain", target: ["production", "preview", "development"] }
          );
          results.push({ key: k, result });
        }
        return NextResponse.json({ action: "set_env_batch", results });
      }

      // List all env vars (keys only, not values for security)
      case "list_env": {
        const result = await vercelFetch(
          `/v9/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`,
          "GET"
        );
        const envs = result.envs?.map((e: any) => ({
          id: e.id, key: e.key, target: e.target, 
          type: e.type, updatedAt: e.updatedAt,
        })) || [];
        return NextResponse.json({ action: "list_env", envs });
      }

      // Trigger a redeployment
      case "redeploy": {
        // Get latest deployment
        const deps = await vercelFetch(
          `/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=1&target=production`,
          "GET"
        );
        const latest = deps.deployments?.[0];
        if (!latest) return NextResponse.json({ error: "No deployment found" }, { status: 404 });

        const result = await vercelFetch(
          `/v13/deployments?teamId=${TEAM_ID}`,
          "POST",
          { name: "ssc-v2", deploymentId: latest.uid, target: "production", meta: { action: "redeploy" } }
        );
        return NextResponse.json({ action: "redeploy", result: { id: result.id, url: result.url, readyState: result.readyState } });
      }

      // Check Vercel token status
      case "check_token": {
        const result = await vercelFetch("/v2/user", "GET");
        return NextResponse.json({
          action: "check_token",
          valid: !!result.user,
          user: result.user ? { username: result.user.username, email: result.user.email } : null,
        });
      }

      // Bootstrap: set the Vercel token itself (called from setup page)
      case "bootstrap": {
        const bootstrapToken = value;
        if (!bootstrapToken) return NextResponse.json({ error: "Token required" }, { status: 400 });

        // Verify the token works first
        const verify = await fetch(`${VERCEL_API}/v2/user`, {
          headers: { Authorization: `Bearer ${bootstrapToken}` },
        });
        const userData = await verify.json();
        if (!userData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

        // Use the token to set itself as an env var
        const result = await fetch(
          `${VERCEL_API}/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bootstrapToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              key: "VERCEL_TOKEN",
              value: bootstrapToken,
              type: "encrypted",
              target: ["production", "preview", "development"],
              comment: "FlowSeer self-management token — enables autonomous env var management",
            }),
          }
        );
        const setResult = await result.json();

        return NextResponse.json({
          action: "bootstrap",
          success: true,
          user: { username: userData.user.username, email: userData.user.email },
          note: "VERCEL_TOKEN set. Redeploy needed to activate. After redeploy, FlowSeer can manage all env vars autonomously.",
          setResult,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}`, valid_actions: ["set_env", "set_env_batch", "list_env", "redeploy", "check_token", "bootstrap"] }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const token = url.searchParams.get("token");

  // Bootstrap via GET — only works if VERCEL_TOKEN is NOT already set (one-time setup)
  if (action === "bootstrap" && token) {
    if (process.env.VERCEL_TOKEN) {
      return NextResponse.json({ error: "Already bootstrapped", status: "ACTIVE" });
    }

    try {
      // Verify the token
      const verify = await fetch(`${VERCEL_API}/v2/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const userData = await verify.json();
      if (!userData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

      // Set VERCEL_TOKEN
      const setToken = await fetch(
        `${VERCEL_API}/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "VERCEL_TOKEN", value: token, type: "encrypted",
            target: ["production", "preview", "development"],
            comment: "FlowSeer self-management — set via bootstrap",
          }),
        }
      );
      const setResult = await setToken.json();

      return NextResponse.json({
        action: "bootstrap", success: true,
        user: { username: userData.user.username, email: userData.user.email },
        note: "VERCEL_TOKEN set. Triggering redeploy...",
        setResult,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const hasToken = !!process.env.VERCEL_TOKEN;
  return NextResponse.json({
    endpoint: "/api/admin",
    status: hasToken ? "ACTIVE — Full self-management enabled" : "SETUP NEEDED — Bootstrap with Vercel token",
    actions: ["set_env", "set_env_batch", "list_env", "redeploy", "check_token", "bootstrap"],
  });
}
