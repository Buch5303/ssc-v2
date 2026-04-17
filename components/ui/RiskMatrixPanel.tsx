'use client';
import { useState } from 'react';
import { Badge } from './Badge';
import { Panel } from './Panel';

interface RiskCategory {
  category: string;
  risk_score: number;
  risk_factors: string[];
  mitigation: string;
  single_source: boolean;
  lead_time_weeks: number;
  value_usd: number;
}

interface TopRisk {
  rank: number;
  risk: string;
  probability: string;
  impact_usd: number;
  mitigation: string;
}

interface ScheduleRisk {
  item: string;
  lead_time_weeks: number;
  critical_path: boolean;
  slip_impact: string;
}

interface RiskAnalysis {
  overall_risk_score: number;
  risk_grade: string;
  risk_categories: RiskCategory[];
  top_risks: TopRisk[];
  concentration_risk: {
    single_source_count: number;
    single_source_value: number;
    top_supplier_exposure_pct: number;
  };
  schedule_risks: ScheduleRisk[];
}

const gradeColor: Record<string, string> = {
  LOW: '#22C55E', MODERATE: '#84CC16', ELEVATED: '#F59E0B', HIGH: '#EF4444', CRITICAL: '#DC2626',
};

function RiskBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? '#EF4444' : score >= 60 ? '#F59E0B' : score >= 40 ? '#EAB308' : '#22C55E';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--t2)', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color, width: 28, textAlign: 'right' as const }}>{score}</span>
    </div>
  );
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function RiskMatrixPanel() {
  const [analysis, setAnalysis] = useState<RiskAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const generate = async () => {
    setLoading(true);
    setError(null);
    const start = Date.now();
    try {
      const res = await fetch('/api/risk-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setElapsed((Date.now() - start) / 1000);
      if (data.error) { setError(data.error); return; }
      if (data.analysis?.parse_error) { setError('AI returned unparseable response'); return; }
      setAnalysis(data.analysis);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title="Supply Chain Risk Matrix"
      meta={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {analysis && (
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
              fontFamily: 'IBM Plex Mono, monospace', color: '#fff',
              background: gradeColor[analysis.risk_grade] || '#525252',
            }}>
              {analysis.risk_grade} · {analysis.overall_risk_score}/100
            </span>
          )}
          <button onClick={generate} disabled={loading} style={{
            padding: '4px 12px', fontSize: 10, fontWeight: 600,
            background: loading ? '#333' : '#1E6FCC', color: '#fff',
            border: 'none', borderRadius: 4, cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {loading ? 'Analyzing...' : analysis ? '↻ Refresh' : '▶ Analyze Risks'}
          </button>
          {elapsed > 0 && <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{elapsed.toFixed(1)}s</span>}
        </div>
      }
    >
      {!analysis && !loading && !error && (
        <div style={{ padding: '20px 0', textAlign: 'center' as const, color: 'var(--t3)', fontSize: 12 }}>
          Click <strong>Analyze Risks</strong> for AI-powered supply chain risk assessment
        </div>
      )}

      {loading && (
        <div style={{ padding: '24px 0', textAlign: 'center' as const }}>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>Scanning 40 packages across 19 categories...</div>
          <div style={{ width: 200, height: 2, margin: '0 auto', borderRadius: 1, background: 'linear-gradient(90deg, transparent, #F59E0B, transparent)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
          <style>{`@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
        </div>
      )}

      {error && <div style={{ padding: '12px 0', color: '#EF4444', fontSize: 12 }}>{error}</div>}

      {analysis && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
          {/* Risk Score Bars */}
          {analysis.risk_categories?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>Category Risk Scores</div>
              {analysis.risk_categories.slice(0, 10).map((cat, i) => (
                <RiskBar key={i} score={cat.risk_score} label={cat.category} />
              ))}
            </div>
          )}

          {/* Top Risks */}
          {analysis.top_risks?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>Top Risks</div>
              {analysis.top_risks.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < analysis.top_risks.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', background: r.probability === 'HIGH' ? '#EF4444' : r.probability === 'MEDIUM' ? '#F59E0B' : '#22C55E', color: '#fff', flexShrink: 0 }}>{r.rank}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>{r.risk}</div>
                    <div style={{ fontSize: 10, color: '#1E6FCC', marginTop: 2 }}>→ {r.mitigation}</div>
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--red)', flexShrink: 0 }}>{fmtK(r.impact_usd)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Concentration Risk */}
          {analysis.concentration_risk && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--bg1)', border: '1px solid var(--line)', textAlign: 'center' as const }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: analysis.concentration_risk.single_source_count > 3 ? 'var(--red)' : 'var(--t0)' }}>{analysis.concentration_risk.single_source_count}</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>Single Source</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--bg1)', border: '1px solid var(--line)', textAlign: 'center' as const }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--t0)' }}>{fmtK(analysis.concentration_risk.single_source_value)}</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>At-Risk Value</div>
              </div>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--bg1)', border: '1px solid var(--line)', textAlign: 'center' as const }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: analysis.concentration_risk.top_supplier_exposure_pct > 30 ? '#F59E0B' : 'var(--t0)' }}>{analysis.concentration_risk.top_supplier_exposure_pct}%</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>Top Supplier %</div>
              </div>
            </div>
          )}

          {/* Schedule Risks */}
          {analysis.schedule_risks?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>Schedule Risk Items</div>
              {analysis.schedule_risks.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11 }}>
                  {s.critical_path && <Badge variant="critical">CRIT PATH</Badge>}
                  <span style={{ color: 'var(--t0)', fontWeight: 500 }}>{s.item}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: s.lead_time_weeks > 40 ? 'var(--red)' : 'var(--t2)' }}>{s.lead_time_weeks}wk</span>
                  <span style={{ fontSize: 10, color: 'var(--t3)', flex: 1 }}>{s.slip_impact}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
