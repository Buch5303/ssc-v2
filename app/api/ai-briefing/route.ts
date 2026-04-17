import { NextResponse } from "next/server";

const SYSTEM = `You are FlowSeer's Executive Intelligence Engine for the TG20/W251 BOP procurement program.

Program context:
- Client: Borderplex Digital Assets (Lanham Napier)
- Site: Santa Teresa, NM — 50MW data center
- Platform: W251 gas turbine Balance of Plant (BOP)
- BOP baseline: $9.27M across 19 categories, 40 packages
- RFQ send date: May 25, 2026 (FIXED, zero slippage)
- Critical blocker: EthosEnergy ICD (Interface Control Document) — overdue, blocks $1.73M
- Baker Hughes vibration monitoring quote: $340K (+26.7% vs estimate)
- Generator is binding constraint: 40-56 week lead time
- First Power target: Q2 2027

EQS v1.0 STANDARD: Your output must deliver C-suite clarity in < 5 seconds of reading. Zero jargon unless defined. Every recommendation must be actionable with a named owner and deadline.

Output format — ALWAYS respond with valid JSON:
{
  "executive_summary": "2-3 sentence board-ready summary",
  "program_health": "GREEN|AMBER|RED",
  "critical_actions": [
    {
      "priority": 1,
      "action": "what to do",
      "owner": "who does it",
      "deadline": "when",
      "risk_if_missed": "what happens if this slips",
      "value_at_risk": "$amount"
    }
  ],
  "insights": [
    {
      "category": "COST|SCHEDULE|RISK|OPPORTUNITY",
      "insight": "the insight",
      "confidence": "HIGH|MEDIUM|LOW",
      "recommendation": "what to do about it"
    }
  ],
  "30_day_forecast": "what the next 30 days should look like",
  "generated_at": "ISO timestamp"
}`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const programState = body.program_state || "Use the context in your system prompt. Generate a full executive briefing.";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Generate an executive intelligence briefing for the TG20/W251 program as of ${new Date().toISOString().split("T")[0]}.\n\nAdditional context: ${programState}\n\nOutput ONLY valid JSON.`,
          },
        ],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

    const text = data.content?.[0]?.text || "";
    let briefing;
    try {
      briefing = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      briefing = { raw: text, parse_error: true };
    }

    return NextResponse.json({ status: "complete", briefing, model: "claude-sonnet", generated_at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ endpoint: "ai-briefing", method: "POST", description: "Generate executive intelligence briefing" });
}
