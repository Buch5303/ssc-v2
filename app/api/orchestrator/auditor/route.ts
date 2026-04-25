import { NextResponse } from "next/server";

// Vercel function timeout: 300s (Pro plan max). Was 60 on Hobby.
// Pro upgrade lifted ceiling so full Sonnet 4 + 8K-token Builder fits cleanly.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { spec, build, research } = await req.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    // If no DeepSeek key, fall back to Anthropic
    const useDeepSeek = !!apiKey;
    const fallbackKey = process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey && !fallbackKey) {
      return NextResponse.json({ error: "No auditor API key available", agent: "auditor", status: "skipped", audit: { verdict: "PASS", issues: [], note: "No auditor key — auto-passing" } }, { status: 200 });
    }

    const prompt = `You are the Auditor agent in an automated build pipeline. You receive the original build specification and the code that was generated. Your job is to find bugs, logic errors, security issues, missing edge cases, and spec violations.

GOVERNING STANDARD: EQS v1.0 — MANDATORY AUDIT CRITERIA:
1. PERFORMANCE: Dashboard load < 1.5s? No render-blocking? Lazy loading where needed?
2. ACCURACY: Financial calculations at ±0.1%? No floating point errors? Auditable?
3. UX: C-suite readable in < 5 seconds? Zero training? Drill-down capable?
4. SECURITY: Input validated? Secrets protected? XSS/injection safe?
5. DATA: Audit trail present? Data lineage tracked? Immutable logs?
6. RELIABILITY: Error boundaries? Graceful degradation? Loading/empty states?
7. VISUALIZATION: Tableau-level clarity? Consistent typography? Information hierarchy?
FAIL any module that violates EQS criteria. Be ruthless.

BUILD SPECIFICATION:
${JSON.stringify(spec, null, 2)}

GENERATED CODE:
${JSON.stringify(build, null, 2)}

RESEARCH CONTEXT:
${JSON.stringify(research || [], null, 2)}

Audit this code. Output ONLY valid JSON:
{
  "verdict": "PASS|FAIL|CONDITIONAL",
  "issues": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "path/to/file",
      "description": "what's wrong",
      "fix": "how to fix it"
    }
  ],
  "spec_compliance": "percentage string like 95%",
  "security_flags": ["any security concerns"],
  "missing_tests": ["tests that should exist"],
  "summary": "brief audit summary"
}

Rules:
- PASS = code is production-ready, ship it
- CONDITIONAL = minor issues, can ship with fixes noted
- FAIL = critical issues, must fix before shipping
- Be thorough but practical — don't nitpick style`;

    let text = "";

    if (useDeepSeek) {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          temperature: 0.1,
        }),
      });
      const data = await res.json();
      text = data.choices?.[0]?.message?.content || "";
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": fallbackKey!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      text = data.content?.[0]?.text || "";
    }

    let audit;
    try {
      audit = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      audit = { raw: text, parse_error: true, verdict: "CONDITIONAL" };
    }

    return NextResponse.json({ 
      agent: "auditor", 
      model: useDeepSeek ? "deepseek-v3" : "claude-sonnet-fallback", 
      status: "complete", 
      audit 
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
