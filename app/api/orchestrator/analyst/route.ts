import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { spec, codebase_summary } = await req.json();
    const apiKey = process.env.GOOGLE_AI_KEY;
    if (!apiKey) return NextResponse.json({ error: "GOOGLE_AI_KEY not set", agent: "analyst", status: "skipped", analysis: { risks: [], conflicts: [], recommendations: [] } }, { status: 200 });

    const prompt = `You are the Analyst agent in an automated build pipeline for a Next.js procurement dashboard (FlowSeer).

CURRENT BUILD SPEC:
${JSON.stringify(spec, null, 2)}

CODEBASE SUMMARY:
${codebase_summary || "Next.js 14 app with Tailwind CSS, TypeScript, NextAuth, Recharts. Routes: /dashboard/overview, /dashboard/cost-intel, /dashboard/supplier-network, /dashboard/rfq-pipeline, /dashboard/analytics, /dashboard/log-response, /dashboard/send-rfq, /dashboard/automation. API routes under /api/. Components in /components/. Tools in /tools/. Deployed on Vercel."}

Analyze the build spec against the existing codebase. Output ONLY valid JSON:
{
  "risks": ["risk1", "risk2"],
  "conflicts": ["file or pattern conflicts"],
  "dependencies_needed": ["any new packages"],
  "recommendations": ["suggestion1"],
  "approval": "PROCEED|CAUTION|BLOCK",
  "notes": "brief summary"
}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-05-06:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 0.2 },
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    let analysis;
    try {
      analysis = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      analysis = { raw: text, parse_error: true, approval: "PROCEED" };
    }

    return NextResponse.json({ agent: "analyst", model: "gemini-2.5-pro", status: "complete", analysis });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
