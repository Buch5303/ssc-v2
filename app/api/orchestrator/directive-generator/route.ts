import { NextResponse } from "next/server";

// Vercel function timeout: 300s (Pro plan max). Was 60 on Hobby.
// Pro upgrade lifted ceiling so full Sonnet 4 + 8K-token Builder fits cleanly.
export const maxDuration = 300;

/**
 * Layer 2 — Directive Generator
 *
 * The self-perpetuation agent. When the directive queue runs low
 * (pending count < 2), auto-build calls this endpoint and the agent
 * inspects platform state to generate 1-3 new directives aligned with
 * the EQS v1.0 standard and the current state of the platform.
 *
 * Inputs considered:
 *   - Current directive queue (for non-duplication)
 *   - Completed directives so far (for continuity)
 *   - Recent runtime errors (from Vercel logs if accessible)
 *   - EQS compliance gaps (pages exceeding load budget, etc.)
 *   - Roadmap priorities from Autonomous Build Directive v1.0 §VII
 *
 * Output: JSON array of new directive objects ready to append to the
 * queue file.
 *
 * Per Autonomous Build Directive v1.0 Section III, Layer 2.
 */

const SYSTEM = `You are the Directive Generator agent in the FlowSeer autonomous build platform.

GOVERNING STANDARD: EQS v1.0 (Enterprise Quality Specification)
All directives you generate MUST, when implemented, advance the platform toward:
- Dashboard load < 1.5s, AI inference < 2s, real-time latency < 300ms
- Financial accuracy ±0.1%, C-suite clarity in < 5 seconds
- Tableau-level visualization, Palantir-grade intelligence
- 100% auditable data, immutable audit logs
- SOC 2 / ISO 27001 / Zero Trust orientation

ROADMAP PRIORITIES (from Autonomous Build Directive v1.0 §VII):
- Week 1: Neon DB migration, live data pipeline
- Week 2: RBAC, Mailgun, RFQ response lifecycle
- Week 3: Audit trail wiring, dashboard performance to 1.5s budget, edge-case hardening
- Week 4: Notifications (email + in-app), mobile responsive
- Week 5: Test expansion to 250+, API docs, security audit
- Week 6: Operational docs, final QA

LAYER 5 SAFETY RAILS — you MAY NOT propose directives that modify:
- /api/auth/** (authentication)
- /api/admin/** (self-management backdoor)
- .github/workflows/** (deploy path)
- middleware.ts (security boundary)
- Destructive DB migrations (drop/rename tables or columns)
- Autonomy governance files (AUTONOMY_DIRECTIVE.md, AUTONOMY_ATTESTATION.md)

RULES FOR GENERATED DIRECTIVES:
1. Output ONLY a valid JSON array. No prose, no markdown fences, no commentary.
2. Generate 1 to 3 directives — quality over quantity.
3. Do NOT duplicate or substantially overlap with existing pending or completed directives.
4. Each directive must be concrete, scoped, and machine-executable by a Builder agent in a single pipeline run.
5. Each directive must reference at least one EQS clause it advances.
6. Use sequential ID format: AUTO-{next_number}, continuing from the highest existing ID.
7. Priority: 1=highest. Use the Week-N roadmap as a rough guide.

OUTPUT SCHEMA (strict):
[
  {
    "id": "AUTO-###",
    "title": "Short title (max 60 chars)",
    "directive": "Concrete, actionable specification. What to build, where, with what constraints. Must reference EQS clause(s).",
    "priority": 1,
    "origin": "auto",
    "rationale": "Why this directive now — what state or signal triggered it"
  }
]`;

export async function POST(req: Request) {
  try {
    const { queue, platform_state } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }

    const pending = (queue?.directives || []).filter((d: any) => d.status === "pending");
    const completed = (queue?.directives || []).filter((d: any) => d.status === "complete");
    const highestId = (queue?.directives || [])
      .map((d: any) => parseInt((d.id || "AUTO-000").replace("AUTO-", ""), 10))
      .reduce((a: number, b: number) => Math.max(a, b), 0);

    const contextBlock = `
CURRENT QUEUE STATE:
- Pending directives: ${pending.length}
- Completed directives: ${completed.length}
- Next ID to use: AUTO-${String(highestId + 1).padStart(3, "0")}

EXISTING DIRECTIVE TITLES (do not duplicate):
${(queue?.directives || []).map((d: any) => `- [${d.status}] ${d.id}: ${d.title}`).join("\n")}

PLATFORM STATE:
${JSON.stringify(platform_state || {}, null, 2)}

Generate 1-3 new directives to keep the autonomous build pipeline productive.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: contextBlock }],
      }),
    });

    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    const text = data.content?.[0]?.text || "";
    let newDirectives: any[] = [];
    try {
      newDirectives = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return NextResponse.json({
        agent: "directive-generator",
        status: "parse_failed",
        raw: text.slice(0, 1000),
      }, { status: 500 });
    }

    if (!Array.isArray(newDirectives)) {
      return NextResponse.json({
        agent: "directive-generator",
        status: "invalid_format",
        raw: text.slice(0, 1000),
      }, { status: 500 });
    }

    // Enrich with common metadata
    const nowIso = new Date().toISOString();
    newDirectives = newDirectives.map((d, i) => ({
      id: d.id || `AUTO-${String(highestId + 1 + i).padStart(3, "0")}`,
      title: d.title,
      directive: d.directive,
      priority: d.priority || 99,
      status: "pending",
      origin: "auto",
      rationale: d.rationale || "",
      created_at: nowIso,
      started_at: null,
      completed_at: null,
      commit_sha: null,
      auditor_score: null,
    }));

    return NextResponse.json({
      agent: "directive-generator",
      model: "claude-sonnet-4",
      status: "complete",
      generated_count: newDirectives.length,
      directives: newDirectives,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
