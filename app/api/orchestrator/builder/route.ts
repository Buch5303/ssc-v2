import { NextResponse } from "next/server";

// Vercel function timeout: 300s (Pro plan max). Was 60 on Hobby.
// Pro upgrade lifted ceiling so full Sonnet 4 + 8K-token Builder fits cleanly.
export const maxDuration = 300;

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
- Follow existing patterns: Tailwind CSS, IBM Plex Mono for data
- Use CSS variables: --bg, --fg, --card, --border, --accent, --muted
- Every file must be complete — no placeholders, no "// TODO"
- Include error handling and loading states
- HARD RULE: import local modules ONLY from the EXISTING REPO FILES manifest, or include the file in your own output. Do NOT assume shadcn defaults (@/components/ui/card, button, etc.) exist — check the manifest.
- HARD RULE: reference ONLY tables and columns present in the ACTUAL DATABASE SCHEMA provided. Never invent columns (e.g. createdAt vs updated_at). Type DB rows via typeof <table>.$inferSelect, never hand-written interfaces with required fields the schema lacks.
- HARD RULE: no \`any\` types (including [key: string]: any) — builds run with TypeScript strict mode and the auditor rejects \`any\`.
- Output ONLY JSON, no markdown fences`;

export async function POST(req: Request) {
  try {
    const { spec, research, analysis, retry_context, repo_context } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

    const groundingBlock = repo_context
      ? [
          `EXISTING REPO FILES (the ONLY local modules you may import without also creating them in your output):`,
          (repo_context.source_paths || []).join("\n"),
          ``,
          `ACTUAL DATABASE SCHEMA (lib/db/schema.ts) — the ONLY tables and columns that exist. Anything not listed here DOES NOT EXIST:`,
          repo_context.db_schema || "(schema unavailable — create no new DB references this run)",
        ].join("\n")
      : "";

    const userMsg = `BUILD SPECIFICATION:
${JSON.stringify(spec, null, 2)}

${groundingBlock}

RESEARCH DATA:
${JSON.stringify(research || [], null, 2)}

CODEBASE ANALYSIS:
${JSON.stringify(analysis || {}, null, 2)}

${retry_context ? `PREVIOUS AUDIT FINDINGS (fix these):\n${retry_context}` : ""}

Build the code now. Output ONLY JSON with the files array.`;

    // Builder is on Vercel Pro (300s function ceiling), so we run the full
    // Sonnet 4 + 16384-token budget. Prior defaults of 4096 (Hobby) and
    // 8192 (Pro v1) both caused mid-string truncation on multi-file
    // directives — AUTO-006 / AUTO-007 emitted 3-of-5 files and the
    // remaining 2 were lost mid-JSON, dropping audit scores to 72/100
    // CONDITIONAL and shipping incomplete RFQ CRUD (missing PUT + queries).
    // 16384 gives headroom for 5-6 file directives in one pass. Override
    // per-env via BUILDER_MAX_TOKENS if a directive needs even more.
    const model = process.env.BUILDER_MODEL || "claude-sonnet-4-6";
    const maxTokens = parseInt(process.env.BUILDER_MAX_TOKENS || "16384", 10);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: SYSTEM,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });

    const text = data.content?.[0]?.text || "";
    const stopReason = data.stop_reason;
    let build;
    let parseRecovery: string | undefined;
    const cleaned = text.replace(/```json|```/g, "").trim();
    try {
      build = JSON.parse(cleaned);
    } catch {
      // Truncation recovery: when stop_reason is "max_tokens" the JSON usually
      // breaks mid-string. Try to salvage the complete file objects from the
      // `files` array up to the last fully-closed entry. Each file is shaped
      // like {"path":"...","action":"...","content":"...","description":"..."}
      // and complete entries are followed by either `},{` or `}]`. Scanning
      // for those boundaries lets us recover N-1 files when the Nth was the
      // one that got cut off.
      const recovered: any[] = [];
      const filesStart = cleaned.indexOf('"files"');
      if (filesStart >= 0) {
        const arrStart = cleaned.indexOf("[", filesStart);
        if (arrStart >= 0) {
          let depth = 0;
          let entryStart = -1;
          let inString = false;
          let escape = false;
          for (let i = arrStart + 1; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (escape) { escape = false; continue; }
            if (c === "\\") { escape = true; continue; }
            if (c === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c === "{") { if (depth === 0) entryStart = i; depth++; }
            else if (c === "}") {
              depth--;
              if (depth === 0 && entryStart >= 0) {
                try {
                  recovered.push(JSON.parse(cleaned.slice(entryStart, i + 1)));
                } catch { /* skip malformed entry */ }
                entryStart = -1;
              }
            }
            else if (c === "]" && depth === 0) break;
          }
        }
      }
      if (recovered.length > 0) {
        build = { files: recovered, recovered_from_truncation: true, original_stop_reason: stopReason };
        parseRecovery = `recovered ${recovered.length} file(s) from truncated JSON (stop_reason=${stopReason || "unknown"})`;
      } else {
        build = { raw: text, parse_error: true, stop_reason: stopReason };
      }
    }

    return NextResponse.json({
      agent: "builder",
      model,
      max_tokens: maxTokens,
      status: "complete",
      build,
      ...(parseRecovery ? { parse_recovery: parseRecovery } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
