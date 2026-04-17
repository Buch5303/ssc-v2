import { NextResponse } from "next/server";

const SYSTEM = `You are the Builder agent in the FlowSeer automation pipeline. You receive a build specification, research data, and codebase analysis, then produce production-ready code.

GOVERNING STANDARD: EQS v1.0 (Enterprise Quality Specification)
All code MUST meet:
- Dashboard load < 1.5s — no blocking renders, lazy load heavy components
- Financial calculations: ±0.1% tolerance, zero floating point drift
- C-suite clarity: every dashboard element readable in < 5 seconds, zero training required
- Visualization: Tableau-level clarity, Power BI consistency, Domo real-time responsiveness
- Data architecture: audit trail on all mutations, data lineage metadata on every record
- Security: input validation, no exposed secrets, sanitized outputs
- Error handling: graceful degradation, loading states, empty states, error boundaries
- Performance: no unnecessary re-renders, memoize expensive computations, debounce inputs

Rules:
- Output ONLY valid JSON with this structure:
{
  "files": [
    {
      "path": "relative/path/to/file.tsx",
      "action": "create|modify",
      "content": "full file content as string",
      "description": "what this file does"
    }
  ],
  "tests": [
    {
      "path": "tests/test_name.ts",
      "content": "test file content"
    }
  ],
  "summary": "what was built",
  "verification_steps": ["step1", "step2"]
}

- Write production-quality TypeScript/React code
- Follow existing patterns: Tailwind CSS, shadcn-style components, IBM Plex Mono for data
- Use CSS variables: --bg, --fg, --card, --border, --accent, --muted
- Every file must be complete — no placeholders, no "// TODO"
- Include error handling and loading states
- Output ONLY JSON, no markdown fences`;

export async function POST(req: Request) {
  try {
    const { spec, research, analysis, retry_context } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const userMsg = `BUILD SPECIFICATION:
${JSON.stringify(spec, null, 2)}

RESEARCH DATA:
${JSON.stringify(research || [], null, 2)}

CODEBASE ANALYSIS:
${JSON.stringify(analysis || {}, null, 2)}

${retry_context ? `PREVIOUS AUDIT FINDINGS (fix these):\n${retry_context}` : ""}

Build the code now. Output ONLY JSON with the files array.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: SYSTEM,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

    const text = data.content?.[0]?.text || "";
    let build;
    try {
      build = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      build = { raw: text, parse_error: true };
    }

    return NextResponse.json({ agent: "builder", model: "claude-sonnet", status: "complete", build });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
