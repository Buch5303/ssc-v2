import { NextResponse } from "next/server";

const SYSTEM = `You are FlowSeer's Supply Chain Risk Engine for the TG20/W251 BOP procurement program.

Program: 50MW W251 gas turbine data center, Santa Teresa NM. $9.27M BOP across 19 categories, 40 packages.

Analyze supply chain risks and return ONLY valid JSON:
{
  "overall_risk_score": number (0-100, higher = more risk),
  "risk_grade": "LOW|MODERATE|ELEVATED|HIGH|CRITICAL",
  "risk_categories": [
    {
      "category": "BOP category name",
      "risk_score": number (0-100),
      "risk_factors": ["factor1", "factor2"],
      "mitigation": "recommended action",
      "single_source": boolean,
      "lead_time_weeks": number,
      "value_usd": number
    }
  ],
  "top_risks": [
    {
      "rank": 1,
      "risk": "description",
      "probability": "HIGH|MEDIUM|LOW",
      "impact_usd": number,
      "mitigation": "what to do"
    }
  ],
  "concentration_risk": {
    "single_source_count": number,
    "single_source_value": number,
    "top_supplier_exposure_pct": number
  },
  "schedule_risks": [
    {
      "item": "equipment name",
      "lead_time_weeks": number,
      "critical_path": boolean,
      "slip_impact": "what happens if this slips"
    }
  ]
}`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
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
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: `Analyze supply chain risks for the TG20/W251 BOP program as of ${new Date().toISOString().split("T")[0]}.

Key facts:
- EthosEnergy ICD overdue — blocks $1.73M (Transformer $760K, Exhaust $431K, Electrical Distribution $535K)
- Baker Hughes VIB_MON quoted $340K (+26.7% over estimate)
- Generator is binding constraint: 40-56 week lead time, $2.09M
- Trillium disqualified, replaced by Flowserve for Piping & Valves ($507K)
- 13 RFQs drafted, 1 responded, May 25 send date fixed
- 19 categories priced, 18 ESTIMATED, 1 VERIFIED

${body.additional_context || ""}

Output ONLY valid JSON.`,
        }],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

    const text = data.content?.[0]?.text || "";
    let analysis;
    try {
      analysis = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      analysis = { raw: text, parse_error: true };
    }

    return NextResponse.json({ status: "complete", analysis, generated_at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
