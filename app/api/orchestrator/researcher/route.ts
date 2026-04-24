import { NextResponse } from "next/server";

// Vercel function timeout: 60s (Hobby plan max).
// 5-agent pipeline + LLM calls exceed default 10s — required for end-to-end runs.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { queries, context } = await req.json();
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "PERPLEXITY_API_KEY not set", agent: "researcher", status: "skipped", results: [] }, { status: 200 });

    if (!queries || queries.length === 0) {
      return NextResponse.json({ agent: "researcher", model: "perplexity-sonar", status: "skipped", results: [], reason: "No research queries provided" });
    }

    const results = [];
    for (const query of queries.slice(0, 5)) {
      try {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: [
              { role: "system", content: "You are a research agent for an industrial gas turbine procurement platform. Provide factual, sourced information. Focus on W251 gas turbines, BOP equipment, supplier data, and power generation industry intelligence. Be concise and data-focused." },
              { role: "user", content: `${query}\n\nContext: ${context || "W251 gas turbine BOP procurement for data center project in Santa Teresa, NM"}` },
            ],
            max_tokens: 2048,
          }),
        });

        const data = await res.json();
        results.push({
          query,
          answer: data.choices?.[0]?.message?.content || "No result",
          citations: data.citations || [],
        });
      } catch (e: any) {
        results.push({ query, answer: `Error: ${e.message}`, citations: [] });
      }
    }

    return NextResponse.json({ agent: "researcher", model: "perplexity-sonar-pro", status: "complete", results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
