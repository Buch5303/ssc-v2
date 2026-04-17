"use client";
import { useState, useRef } from "react";

type AgentStatus = "idle" | "running" | "complete" | "error" | "skipped";

interface AgentState {
  status: AgentStatus;
  model: string;
  result: any;
  elapsed: number;
  error?: string;
}

const AGENTS = [
  { key: "architect", label: "Architect", model: "Claude Opus", icon: "📐", desc: "Decomposes directive into build spec" },
  { key: "researcher", label: "Researcher", model: "Perplexity Sonar", icon: "🔍", desc: "Gathers web intelligence" },
  { key: "analyst", label: "Analyst", model: "Gemini 2.5 Pro", icon: "🔬", desc: "Full-repo analysis & conflict check" },
  { key: "builder", label: "Builder", model: "Claude Sonnet", icon: "🔧", desc: "Writes production code" },
  { key: "auditor", label: "Auditor", model: "DeepSeek V3", icon: "🛡️", desc: "Logic review & security audit" },
] as const;

const SAMPLE_DIRECTIVES = [
  "Add a real-time W251 BOP pricing comparison chart to the Cost Intel dashboard page that shows our estimates vs market data for all 40 packages",
  "Build a supplier risk scoring panel on the Supplier Network page — flag any supplier with single-source dependency or no backup",
  "Create an ICD status tracker on the Overview page showing EthosEnergy document status with days-since-request counter",
  "Add email notification system — when an RFQ response is logged, auto-email the program manager with a summary",
  "Build a contact enrichment panel that shows verification status for all 231 contacts with one-click re-verify button",
];

const initialAgents: Record<string, AgentState> = Object.fromEntries(
  AGENTS.map((a) => [a.key, { status: "idle" as AgentStatus, model: a.model, result: null, elapsed: 0 }])
);

export default function AutomationPage() {
  const [directive, setDirective] = useState("");
  const [agents, setAgents] = useState<Record<string, AgentState>>(initialAgents);
  const [running, setRunning] = useState(false);
  const [pipelineLog, setPipelineLog] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const [finalStatus, setFinalStatus] = useState<"idle" | "success" | "failed">("idle");
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setPipelineLog((prev) => [...prev, `[${ts}] ${msg}`]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  };

  const updateAgent = (key: string, update: Partial<AgentState>) => {
    setAgents((prev) => ({ ...prev, [key]: { ...prev[key], ...update } }));
  };

  const callAgent = async (key: string, body: any): Promise<any> => {
    const start = Date.now();
    updateAgent(key, { status: "running", elapsed: 0 });
    addLog(`▶ ${key.toUpperCase()} agent starting...`);

    try {
      const res = await fetch(`/api/orchestrator/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const elapsed = (Date.now() - start) / 1000;

      if (data.error && !data.status) {
        updateAgent(key, { status: "error", elapsed, error: data.error });
        addLog(`✗ ${key.toUpperCase()} failed: ${data.error}`);
        return null;
      }

      const status = data.status === "skipped" ? "skipped" : "complete";
      updateAgent(key, { status, elapsed, result: data, model: data.model || agents[key].model });
      addLog(`✓ ${key.toUpperCase()} ${status} (${elapsed.toFixed(1)}s) — model: ${data.model || "unknown"}`);
      return data;
    } catch (e: any) {
      const elapsed = (Date.now() - start) / 1000;
      updateAgent(key, { status: "error", elapsed, error: e.message });
      addLog(`✗ ${key.toUpperCase()} error: ${e.message}`);
      return null;
    }
  };

  const runPipeline = async () => {
    if (!directive.trim()) return;
    setRunning(true);
    setFinalStatus("idle");
    setRetryCount(0);
    setPipelineLog([]);
    setAgents(initialAgents);

    addLog(`═══ PIPELINE START: "${directive.slice(0, 80)}..." ═══`);

    // Step 1: Architect
    const archResult = await callAgent("architect", { directive, context: "FlowSeer W251 BOP procurement platform. Next.js 14, Tailwind, TypeScript, Vercel." });
    if (!archResult?.spec) {
      addLog("═══ PIPELINE ABORTED: Architect failed ═══");
      setRunning(false);
      setFinalStatus("failed");
      return;
    }

    // Step 2: Researcher + Analyst in parallel
    addLog("── Running Researcher + Analyst in parallel ──");
    const [researchResult, analysisResult] = await Promise.all([
      callAgent("researcher", { queries: archResult.spec.research_queries || [], context: directive }),
      callAgent("analyst", { spec: archResult.spec }),
    ]);

    // Check analyst approval
    if (analysisResult?.analysis?.approval === "BLOCK") {
      addLog(`═══ PIPELINE BLOCKED by Analyst: ${analysisResult.analysis.notes} ═══`);
      setRunning(false);
      setFinalStatus("failed");
      return;
    }

    // Step 3: Builder
    let buildResult = await callAgent("builder", {
      spec: archResult.spec,
      research: researchResult?.results || [],
      analysis: analysisResult?.analysis || {},
    });

    if (!buildResult?.build) {
      addLog("═══ PIPELINE ABORTED: Builder failed ═══");
      setRunning(false);
      setFinalStatus("failed");
      return;
    }

    // Step 4: Auditor (with retry loop)
    let auditResult = await callAgent("auditor", {
      spec: archResult.spec,
      build: buildResult.build,
      research: researchResult?.results || [],
    });

    let attempts = 0;
    while (auditResult?.audit?.verdict === "FAIL" && attempts < 3) {
      attempts++;
      setRetryCount(attempts);
      addLog(`── RETRY ${attempts}/3: Auditor found issues, sending back to Builder ──`);

      // Rebuild with audit feedback
      buildResult = await callAgent("builder", {
        spec: archResult.spec,
        research: researchResult?.results || [],
        analysis: analysisResult?.analysis || {},
        retry_context: JSON.stringify(auditResult.audit.issues),
      });

      if (!buildResult?.build) break;

      auditResult = await callAgent("auditor", {
        spec: archResult.spec,
        build: buildResult.build,
        research: researchResult?.results || [],
      });
    }

    const verdict = auditResult?.audit?.verdict || "UNKNOWN";
    if (verdict === "PASS" || verdict === "CONDITIONAL") {
      addLog(`═══ PIPELINE COMPLETE ✓ — Verdict: ${verdict} ═══`);
      setFinalStatus("success");
    } else {
      addLog(`═══ PIPELINE FINISHED — Verdict: ${verdict} (after ${attempts} retries) ═══`);
      setFinalStatus("failed");
    }

    setRunning(false);
  };

  const statusColor = (s: AgentStatus) => {
    switch (s) {
      case "running": return "#3B82F6";
      case "complete": return "#22C55E";
      case "error": return "#EF4444";
      case "skipped": return "#A3A3A3";
      default: return "#525252";
    }
  };

  const statusLabel = (s: AgentStatus) => {
    switch (s) {
      case "running": return "RUNNING";
      case "complete": return "DONE";
      case "error": return "ERROR";
      case "skipped": return "SKIPPED";
      default: return "WAITING";
    }
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#E5E5E5", margin: 0 }}>
          FlowSeer Automation
        </h1>
        <p style={{ fontSize: 13, color: "#737373", marginTop: 4 }}>
          5-Agent autonomous build pipeline — Architect → Researcher + Analyst → Builder → Auditor
        </p>
      </div>

      {/* Directive Input */}
      <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#A3A3A3", textTransform: "uppercase" as const, letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
          Directive
        </label>
        <textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          placeholder="Describe what you want built in plain English..."
          disabled={running}
          style={{
            width: "100%", minHeight: 80, background: "#0A0A0A", border: "1px solid #333",
            borderRadius: 6, padding: 12, color: "#E5E5E5", fontSize: 14, fontFamily: "inherit",
            resize: "vertical", outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" as const }}>
          <button
            onClick={runPipeline}
            disabled={running || !directive.trim()}
            style={{
              padding: "10px 24px", background: running ? "#333" : "#1E6FCC", color: "#fff",
              border: "none", borderRadius: 6, fontWeight: 600, fontSize: 14, cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? "Running..." : "▶ Run Pipeline"}
          </button>
          <button
            onClick={() => { setAgents(initialAgents); setPipelineLog([]); setFinalStatus("idle"); setDirective(""); }}
            disabled={running}
            style={{ padding: "10px 16px", background: "#262626", color: "#A3A3A3", border: "1px solid #333", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
          >
            Clear
          </button>
        </div>

        {/* Sample Directives */}
        <div style={{ marginTop: 16 }}>
          <span style={{ fontSize: 11, color: "#525252", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Quick-load:</span>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" as const }}>
            {SAMPLE_DIRECTIVES.map((d, i) => (
              <button
                key={i}
                onClick={() => setDirective(d)}
                disabled={running}
                style={{
                  padding: "4px 10px", background: "#1A1A1A", border: "1px solid #262626",
                  borderRadius: 4, color: "#737373", fontSize: 11, cursor: "pointer",
                  maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
                }}
              >
                {d.slice(0, 40)}...
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Pipeline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {AGENTS.map((a) => {
          const state = agents[a.key];
          return (
            <div
              key={a.key}
              style={{
                background: "#141414", border: `1px solid ${state.status === "running" ? "#1E6FCC" : "#262626"}`,
                borderRadius: 8, padding: 16, position: "relative" as const,
                transition: "border-color 0.3s",
              }}
            >
              {state.status === "running" && (
                <div style={{
                  position: "absolute" as const, top: 0, left: 0, right: 0, height: 2,
                  background: "linear-gradient(90deg, #1E6FCC, #60A5FA, #1E6FCC)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1.5s infinite",
                  borderRadius: "8px 8px 0 0",
                }} />
              )}
              <div style={{ fontSize: 20, marginBottom: 4 }}>{a.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#E5E5E5" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "#525252", fontFamily: "IBM Plex Mono, monospace", marginTop: 2 }}>{state.model}</div>
              <div style={{ fontSize: 10, color: "#525252", marginTop: 4 }}>{a.desc}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(state.status) }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: statusColor(state.status), fontFamily: "IBM Plex Mono, monospace" }}>
                  {statusLabel(state.status)}
                </span>
                {state.elapsed > 0 && (
                  <span style={{ fontSize: 10, color: "#525252", fontFamily: "IBM Plex Mono, monospace" }}>
                    {state.elapsed.toFixed(1)}s
                  </span>
                )}
              </div>
              {state.error && (
                <div style={{ fontSize: 10, color: "#EF4444", marginTop: 6, wordBreak: "break-word" as const }}>{state.error}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Retry indicator */}
      {retryCount > 0 && (
        <div style={{ background: "#1C1917", border: "1px solid #422006", borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#FBBF24" }}>
          Builder ↔ Auditor retry loop: attempt {retryCount}/3
        </div>
      )}

      {/* Final Status */}
      {finalStatus !== "idle" && (
        <div style={{
          background: finalStatus === "success" ? "#052E16" : "#2A0A0A",
          border: `1px solid ${finalStatus === "success" ? "#166534" : "#7F1D1D"}`,
          borderRadius: 8, padding: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: finalStatus === "success" ? "#22C55E" : "#EF4444" }}>
            {finalStatus === "success" ? "✓ PIPELINE PASSED" : "✗ PIPELINE DID NOT PASS"}
          </div>
          {agents.auditor.result?.audit && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#A3A3A3" }}>
              Verdict: {agents.auditor.result.audit.verdict} | Spec compliance: {agents.auditor.result.audit.spec_compliance || "N/A"}
            </div>
          )}
        </div>
      )}

      {/* Pipeline Log */}
      <div style={{ background: "#0A0A0A", border: "1px solid #262626", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #262626", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#A3A3A3", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Pipeline Log</span>
          <span style={{ fontSize: 10, color: "#525252", fontFamily: "IBM Plex Mono, monospace" }}>{pipelineLog.length} entries</span>
        </div>
        <div ref={logRef} style={{ padding: 14, maxHeight: 300, overflowY: "auto" as const, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, lineHeight: 1.6 }}>
          {pipelineLog.length === 0 ? (
            <span style={{ color: "#525252" }}>Enter a directive and click Run Pipeline to start...</span>
          ) : (
            pipelineLog.map((line, i) => (
              <div key={i} style={{ color: line.includes("✓") ? "#22C55E" : line.includes("✗") ? "#EF4444" : line.includes("═══") ? "#FBBF24" : "#737373" }}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Agent Results (expandable) */}
      {AGENTS.map((a) => {
        const state = agents[a.key];
        if (!state.result) return null;
        return (
          <details key={a.key} style={{ marginTop: 12, background: "#141414", border: "1px solid #262626", borderRadius: 8 }}>
            <summary style={{ padding: "10px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#A3A3A3" }}>
              {a.icon} {a.label} Output ({state.elapsed.toFixed(1)}s)
            </summary>
            <pre style={{ padding: 14, margin: 0, fontSize: 10, color: "#737373", overflow: "auto", maxHeight: 400, fontFamily: "IBM Plex Mono, monospace" }}>
              {JSON.stringify(state.result, null, 2)}
            </pre>
          </details>
        );
      })}

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}
