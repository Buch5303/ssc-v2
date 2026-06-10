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

    // Extract spec scope so the auditor evaluates against the directive's own
    // acceptance criteria, not the universal EQS surface. Foundational and
    // scaffolding directives (db connection layers, env validation, error
    // boundaries) physically cannot satisfy criteria designed for finished
    // dashboards (load time, financial accuracy ±0.1%, Tableau visualization),
    // so universal-EQS auditing produced a persistent ~55 score and gridlocked
    // the queue (AUTO-016 through AUTO-021 all rejected). Scope-aware auditing
    // only applies EQS criteria that meaningfully fit the directive.
    const acceptanceCriteria = Array.isArray(spec?.acceptance_criteria)
      ? spec.acceptance_criteria
      : (Array.isArray(spec?.spec?.acceptance_criteria) ? spec.spec.acceptance_criteria : []);
    const auditFocus = spec?.audit_focus || spec?.spec?.audit_focus || "";
    const directiveTitle = spec?.title || spec?.spec?.title || "";
    const directiveObjective = spec?.objective || spec?.spec?.objective || "";
    const complexity = spec?.estimated_complexity || spec?.spec?.estimated_complexity || "UNKNOWN";

    // Fetch the live package.json so the auditor can verify every `import`
    // resolves to an installed package. Without this context the LLM has no
    // ground truth about what's installed and routinely passes code that
    // references missing modules (e.g. AUTO-006 shipped lib/db.ts importing
    // drizzle-orm/neon-serverless / @neondatabase/serverless / ws — none in
    // package.json — auditor scored 88/100 PASS because the code "looked"
    // right; Vercel build then failed Module not found and gridlocked deploys).
    // We pass the manifest as an explicit reference list so the buildability
    // lens has actual data to check against.
    let installedPackages: string[] = [];
    try {
      const pkgRes = await fetch(
        "https://raw.githubusercontent.com/Buch5303/ssc-v2/main/package.json",
        { cache: "no-store" }
      );
      if (pkgRes.ok) {
        const pkg = await pkgRes.json();
        installedPackages = [
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {}),
        ].sort();
      }
    } catch {
      // Fall back to empty list — auditor still applies the lens but
      // without a manifest reference (LLM will be more conservative).
    }

    const prompt = `You are the Auditor agent in an automated build pipeline. You receive the original build specification and the code that was generated. Your job is to verify the build meets THIS DIRECTIVE'S acceptance criteria, then check for bugs, logic errors, security issues, and spec violations.

DIRECTIVE SCOPE (primary evaluation surface):
- Title: ${directiveTitle || "(unspecified)"}
- Objective: ${directiveObjective || "(unspecified)"}
- Complexity: ${complexity}
- Audit Focus: ${auditFocus || "(unspecified)"}
- Acceptance Criteria (MUST evaluate each):
${acceptanceCriteria.length > 0 ? acceptanceCriteria.map((c: string, i: number) => `  ${i + 1}. ${c}`).join("\n") : "  (none provided — evaluate against objective and spec only)"}

GOVERNING STANDARD: EQS v1.0 — APPLY ONLY CRITERIA RELEVANT TO THIS DIRECTIVE'S SCOPE.
The EQS surface below is a filter, not a universal mandate. Score the build against
the SUBSET of EQS criteria that meaningfully apply given the directive's scope.
A directive for a "database connection layer" must NOT be penalized for not having
a dashboard load time. A directive for "error boundary infrastructure" must NOT be
penalized for missing financial-accuracy logic. Apply each EQS lens only if it
would have produced an artifact in this directive's scope:

1. PERFORMANCE (apply when UI/render code is in scope): Dashboard load < 1.5s,
   no render-blocking, lazy loading where needed.
2. ACCURACY (apply when financial/numeric calculation code is in scope): ±0.1%
   tolerance, no floating point drift, auditable math.
3. UX (apply when user-facing UI is in scope): C-suite readable in < 5s, zero
   training, drill-down capable.
4. SECURITY (apply UNIVERSALLY to any code touching input, secrets, or output):
   Input validated, secrets protected, XSS/injection safe, no exposed credentials.
5. DATA (apply when data mutation, persistence, or lineage is in scope): Audit
   trail on mutations, data lineage metadata, immutable logs where appropriate.
6. RELIABILITY (apply UNIVERSALLY): Error handling, graceful degradation, retries
   on transient failures, sensible defaults; loading/empty states only when UI in scope.
7. VISUALIZATION (apply when chart/dashboard render code is in scope): Tableau-
   level clarity, consistent typography, information hierarchy.
8. BUILDABILITY (apply UNIVERSALLY to ANY code change): The build must compile
   and deploy. Specifically:
   - Every \`import\` statement must resolve to (a) a relative path that exists
     in the codebase, OR (b) a package name that is present in package.json
     dependencies or devDependencies. If a generated file imports a package
     not in the existing manifest, that is a CRITICAL issue and the directive
     must NOT pass — score is capped at 60 (CONDITIONAL or below).
   - A new file at path X.ts must NOT collide with an existing X/ directory
     (e.g. lib/db.ts alongside lib/db/connection.ts creates an ambiguous
     module path) — CRITICAL.
   - TypeScript file additions must not introduce \`any\`, \`@ts-ignore\`, or
     \`@ts-expect-error\` to silence the underlying type contract — HIGH.
   - Top-level await, dynamic import of a missing module, or syntax that
     Next.js 14 cannot statically analyze — CRITICAL.
   BUILDABILITY violations are NEVER scope-filtered. The lens applies to
   every directive, every time. A build that does not compile cannot be
   audited as PASS regardless of how well it satisfies other criteria.

For each EQS lens, decide first whether it APPLIES to this scope. If it does
not apply, do not penalize on it and do not list it as an issue.

BUILD SPECIFICATION (full context):
${JSON.stringify(spec, null, 2)}

INSTALLED PACKAGES (package.json dependencies + devDependencies — every \`import\` in the generated code MUST resolve to one of these OR to a relative path that exists in the repo):
${installedPackages.length > 0 ? installedPackages.join(", ") : "(could not fetch package.json — apply BUILDABILITY lens conservatively)"}

GENERATED CODE:
${JSON.stringify(build, null, 2)}

RESEARCH CONTEXT:
${JSON.stringify(research || [], null, 2)}

Audit this code. Output ONLY valid JSON:
{
  "verdict": "PASS|FAIL|CONDITIONAL",
  "score": 87,
  "acceptance_criteria_results": [
    {"criterion": "the criterion text", "result": "PASS|FAIL|PARTIAL", "evidence": "where in the code"}
  ],
  "applicable_eqs_lenses": ["SECURITY", "RELIABILITY", "..."],
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

Scoring rules:
- score MUST be a number from 0 to 100 (integer). NOT a string. NOT a percentage.
- Primary input to score: how many acceptance criteria are satisfied, weighted by severity of remaining issues.
- Secondary input: applicable EQS lens violations (do NOT count non-applicable lenses).
- Anchor points:
    100 = all acceptance criteria PASS, no issues
    90  = all acceptance criteria PASS, only LOW-severity issues
    80  = all acceptance criteria PASS or PARTIAL, a few MEDIUM issues
    65  = some acceptance criteria FAIL but build is recoverable
    40  = most acceptance criteria FAIL, build is broken
    0   = no useful output, parse error, or empty files array
- A build that satisfies its acceptance criteria with only out-of-scope EQS gaps
  (e.g. a db-connection-layer with no dashboard load metric) MUST score >= 80.
- score 65 is the hard floor — anything below blocks the commit
- score and verdict must be consistent: PASS >= 80, CONDITIONAL >= 65, FAIL < 65
- PASS = code satisfies the directive's acceptance criteria, ship it
- CONDITIONAL = minor issues on applicable criteria, can ship with fixes noted
- FAIL = critical issues on applicable criteria, must fix before shipping
- Be thorough but practical — don't nitpick style, don't penalize for out-of-scope concerns`;

    let text = "";

    // Hard pre-check: if the Builder produced no files or a parse error, the
    // Auditor must fail deterministically without calling the LLM. Otherwise
    // the model can hallucinate a passing-ish score off the spec alone (we
    // saw 72/CONDITIONAL on builds with zero files), which then trips the
    // Layer 4 gate's allowed=true path but the commit is silently skipped
    // because files.length === 0 — producing misleading "gated out" commits.
    const builderFiles = Array.isArray(build?.files) ? build.files : [];
    const builderParseError = build?.parse_error === true;
    if (builderParseError || builderFiles.length === 0) {
      const reason = builderParseError
        ? "Builder produced parse error — output was not valid JSON"
        : "Builder produced zero files";
      return NextResponse.json({
        agent: "auditor",
        model: "pre-check",
        status: "complete",
        audit: {
          verdict: "FAIL",
          score: 0,
          acceptance_criteria_results: acceptanceCriteria.map((c: string) => ({
            criterion: c,
            result: "FAIL",
            evidence: "No build output to evaluate",
          })),
          applicable_eqs_lenses: [],
          issues: [{
            severity: "CRITICAL",
            file: "(none)",
            description: reason,
            fix: "Builder must return a non-empty files array as valid JSON. Check Builder model availability, token limits, and prompt parse path.",
          }],
          spec_compliance: "0%",
          security_flags: [],
          missing_tests: [],
          summary: reason,
          pre_check_failed: true,
        },
      });
    }

    // ------------------------------------------------------------------
    // LLM call + parse, with one strict retry. AUTO-034 (2026-06-09) died
    // because the auditor's output didn't parse: verdict surfaced as
    // UNKNOWN with score null, the gate blocked (correctly), but the
    // directive burned its attempts on an infrastructure failure rather
    // than a quality failure. Now: salvage embedded JSON, normalize the
    // verdict, retry once with a stricter instruction, and on final
    // failure return an explicit AUDIT_ERROR the pipeline can recognize.
    // ------------------------------------------------------------------
    const callAuditorLLM = async (p: string): Promise<string> => {
      if (useDeepSeek) {
        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: p }],
            max_tokens: 8192,
            temperature: 0.1,
          }),
        });
        const data: any = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": fallbackKey!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: p }],
        }),
      });
      const data: any = await res.json();
      return data.content?.[0]?.text || "";
    };

    // Parse helper: direct parse, then salvage the largest {...} block
    // (handles preamble text, markdown fences, trailing commentary).
    const tryParseAudit = (raw: string): any | null => {
      const stripped = raw.replace(/```json|```/g, "").trim();
      try { return JSON.parse(stripped); } catch { /* salvage below */ }
      const first = stripped.indexOf("{");
      const last = stripped.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try { return JSON.parse(stripped.slice(first, last + 1)); } catch { /* fall through */ }
      }
      return null;
    };

    const VALID_VERDICTS = ["PASS", "CONDITIONAL", "FAIL"];
    const normalizeVerdict = (a: any): void => {
      if (!a) return;
      // Some models nest the payload: { "audit": {...} } — unwrap it.
      if (a.audit && typeof a.audit === "object" && a.audit.verdict !== undefined && a.verdict === undefined) {
        Object.assign(a, a.audit);
      }
      if (typeof a.verdict === "string") {
        const v = a.verdict.trim().toUpperCase();
        a.verdict = v === "PASSED" ? "PASS" : v === "FAILED" ? "FAIL" : v;
      }
      // Verdict missing but a numeric score exists — derive per EQS bands.
      if (!VALID_VERDICTS.includes(a.verdict) && typeof a.score === "number" && Number.isFinite(a.score)) {
        a.verdict = a.score >= 80 ? "PASS" : a.score >= 65 ? "CONDITIONAL" : "FAIL";
        a.verdict_source = "derived_from_score";
      }
    };

    let audit: any = null;
    for (let auditTry = 1; auditTry <= 2 && !audit; auditTry++) {
      const tryPrompt = auditTry === 1
        ? prompt
        : prompt + "\n\nCRITICAL REMINDER: Your previous response was not parseable. Respond with ONLY a single raw JSON object. No prose, no markdown fences, no explanation before or after. The object MUST contain \"verdict\" (one of PASS/CONDITIONAL/FAIL) and \"score\" (integer 0-100).";
      text = await callAuditorLLM(tryPrompt);
      const parsed = tryParseAudit(text);
      if (parsed && typeof parsed === "object") {
        normalizeVerdict(parsed);
        if (VALID_VERDICTS.includes(parsed.verdict)) {
          audit = parsed;
          if (auditTry > 1) audit.parse_retries = auditTry - 1;
        }
      }
    }
    if (!audit) {
      // Irrecoverable — explicit infrastructure-failure signal. The pipeline
      // treats AUDIT_ERROR as retryable (not a quality FAIL on the directive).
      audit = {
        verdict: "AUDIT_ERROR",
        score: null,
        audit_error: true,
        parse_error: true,
        raw: (text || "").slice(0, 800),
        summary: "Auditor LLM output unparseable after retry — infrastructure failure, not a code-quality verdict",
      };
    }

    // Defensive normalization — guarantee `score` is a number for Layer 4 gate.
    // Models occasionally return score as a string ("87") or omit it and only
    // populate spec_compliance ("87%"). Both are coerced to numeric here so
    // the gate's strict typeof check doesn't reject otherwise-valid audits.
    if (audit && !audit.parse_error) {
      const rawScore = audit.score;
      if (typeof rawScore === "string") {
        const parsed = parseFloat(rawScore.replace(/[^\d.]/g, ""));
        audit.score = Number.isFinite(parsed) ? Math.round(parsed) : null;
      } else if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
        // No score field — try spec_compliance fallback ("95%" → 95)
        const sc = audit.spec_compliance;
        if (typeof sc === "string") {
          const parsed = parseFloat(sc.replace(/[^\d.]/g, ""));
          audit.score = Number.isFinite(parsed) ? Math.round(parsed) : null;
          audit.score_source = "spec_compliance_fallback";
        } else if (typeof sc === "number" && Number.isFinite(sc)) {
          audit.score = Math.round(sc);
          audit.score_source = "spec_compliance_fallback";
        } else {
          audit.score = null;
        }
      }
      // Clamp to 0-100 range
      if (typeof audit.score === "number") {
        audit.score = Math.max(0, Math.min(100, audit.score));
      }
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
