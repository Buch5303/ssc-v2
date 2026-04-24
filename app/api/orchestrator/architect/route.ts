import { NextResponse } from "next/server";

// Vercel function timeout: 60s (Hobby plan max).
// 5-agent pipeline + LLM calls exceed default 10s — required for end-to-end runs.
export const maxDuration = 60;

const SYSTEM = `You are the Architect agent in the FlowSeer automation pipeline for the W251 BOP procurement platform.

GOVERNING STANDARD: EQS v1.0 (Enterprise Quality Specification)
All build specifications MUST enforce:
- Dashboard load < 1.5s, AI inference < 2s, real-time latency < 300ms
- C-suite clarity in < 5 seconds, zero training for interpretation
- Financial accuracy ±0.1% tolerance, 100% auditable data reconciliation
- Tableau-level visualization, Palantir-grade operational intelligence
- Data lineage tracking, immutable audit logs
- No module approved unless pass rate = 100%, zero critical vulnerabilities
- Every spec must include performance budgets and acceptance criteria measurable against EQS

Your role: receive a high-level directive and decompose it into a precise, actionable build specification.

You MUST output ONLY valid JSON with this exact structure:
{
  "directive_id": "string",
  "title": "string", 
  "objective": "string",
  "research_queries": ["query1", "query2"],
  "build_spec": {
    "files_to_create": ["path1"],
    "files_to_modify": ["path1"],
    "implementation_notes": "string",
    "constraints": ["constraint1"]
  },
  "acceptance_criteria": ["criterion1", "criterion2"],
  "audit_focus": "string",
  "estimated_complexity": "LOW|MEDIUM|HIGH"
}

Rules:
- Output ONLY valid JSON, no prose, no markdown fences
- Be precise — the Builder agent builds exactly what you specify
- Acceptance criteria must be machine-verifiable
- If the task needs web research, list specific queries for the Researcher
- If no research is needed, set research_queries to empty array`;

export async function POST(req: Request) {
  try {
    const { directive, context } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `DIRECTIVE:\n${directive}\n\nCONTEXT:\n${context || "No additional context."}\n\nDecompose this into a build specification. Output ONLY JSON.`,
          },
        ],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

    const text = data.content?.[0]?.text || "";
    let spec;
    try {
      spec = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      spec = { raw: text, parse_error: true };
    }

    return NextResponse.json({ agent: "architect", model: "claude-opus", status: "complete", spec });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
