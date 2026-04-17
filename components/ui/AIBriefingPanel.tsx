'use client';
import { useState } from 'react';
import { Badge }  from './Badge';
import { Panel }  from './Panel';

interface Action {
  priority: number;
  action: string;
  owner: string;
  deadline: string;
  risk_if_missed: string;
  value_at_risk: string;
}

interface Insight {
  category: string;
  insight: string;
  confidence: string;
  recommendation: string;
}

interface Briefing {
  executive_summary: string;
  program_health: string;
  critical_actions: Action[];
  insights: Insight[];
  '30_day_forecast': string;
  generated_at: string;
}

const healthColor: Record<string, string> = {
  GREEN: '#22C55E', AMBER: '#F59E0B', RED: '#EF4444',
};

const catIcon: Record<string, string> = {
  COST: '💰', SCHEDULE: '📅', RISK: '⚠️', OPPORTUNITY: '🎯',
};

export function AIBriefingPanel() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const generate = async () => {
    setLoading(true);
    setError(null);
    const start = Date.now();
    try {
      const res = await fetch('/api/ai-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setElapsed((Date.now() - start) / 1000);
      if (data.error) { setError(data.error); return; }
      if (data.briefing?.parse_error) { setError('AI returned unparseable response'); return; }
      setBriefing(data.briefing);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title="AI Executive Intelligence"
      meta={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {briefing && (
            <span
              style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
                color: '#fff', background: healthColor[briefing.program_health] || '#525252',
              }}
            >
              {briefing.program_health}
            </span>
          )}
          <button
            onClick={generate}
            disabled={loading}
            style={{
              padding: '4px 12px', fontSize: 10, fontWeight: 600,
              background: loading ? '#333' : '#1E6FCC', color: '#fff',
              border: 'none', borderRadius: 4, cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'IBM Plex Mono, monospace',
            }}
          >
            {loading ? 'Generating...' : briefing ? '↻ Refresh' : '▶ Generate Briefing'}
          </button>
          {elapsed > 0 && (
            <span style={{ fontSize: 9, color: 'var(--t3)', fontFamily: 'IBM Plex Mono, monospace' }}>
              {elapsed.toFixed(1)}s
            </span>
          )}
        </div>
      }
    >
      {!briefing && !loading && !error && (
        <div style={{ padding: '20px 0', textAlign: 'center' as const, color: 'var(--t3)', fontSize: 12 }}>
          Click <strong>Generate Briefing</strong> for an AI-powered executive intelligence summary
        </div>
      )}

      {loading && (
        <div style={{ padding: '24px 0', textAlign: 'center' as const }}>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
            AI analyzing program data...
          </div>
          <div style={{
            width: 200, height: 2, margin: '0 auto', borderRadius: 1,
            background: 'linear-gradient(90deg, transparent, #1E6FCC, transparent)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }} />
          <style>{`@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 0', color: '#EF4444', fontSize: 12 }}>{error}</div>
      )}

      {briefing && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16 }}>
          {/* Executive Summary */}
          <div style={{
            padding: 14, borderRadius: 6,
            background: 'rgba(30,111,204,0.06)', border: '1px solid rgba(30,111,204,0.15)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>
              Executive Summary
            </div>
            <div style={{ fontSize: 13, color: 'var(--t0)', lineHeight: 1.6 }}>
              {briefing.executive_summary}
            </div>
          </div>

          {/* Critical Actions */}
          {briefing.critical_actions?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>
                Critical Actions
              </div>
              {briefing.critical_actions.map((a, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr auto',
                  gap: 10, padding: '8px 0',
                  borderBottom: i < briefing.critical_actions.length - 1 ? '1px solid var(--line)' : 'none',
                  alignItems: 'start',
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
                    background: i === 0 ? '#EF4444' : i === 1 ? '#F59E0B' : '#525252', color: '#fff',
                  }}>
                    {a.priority}
                  </span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>{a.action}</div>
                    <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 2 }}>
                      Owner: {a.owner} · Deadline: {a.deadline}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>
                      If missed: {a.risk_if_missed}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--red)' }}>
                    {a.value_at_risk}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Insights */}
          {briefing.insights?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>
                Intelligence Insights
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {briefing.insights.map((ins, i) => (
                  <div key={i} style={{
                    padding: 10, borderRadius: 6,
                    background: 'var(--bg1)', border: '1px solid var(--line)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span>{catIcon[ins.category] || '📊'}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const }}>{ins.category}</span>
                      <Badge variant={ins.confidence === 'HIGH' ? 'verified' : ins.confidence === 'MEDIUM' ? 'estimated' : 'silent'}>
                        {ins.confidence}
                      </Badge>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t1)', lineHeight: 1.5 }}>{ins.insight}</div>
                    <div style={{ fontSize: 10, color: 'var(--brand-blue2)', marginTop: 4 }}>→ {ins.recommendation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 30 Day Forecast */}
          {briefing['30_day_forecast'] && (
            <div style={{
              padding: 12, borderRadius: 6,
              background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.12)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 }}>
                30-Day Forecast
              </div>
              <div style={{ fontSize: 12, color: 'var(--t1)', lineHeight: 1.6 }}>
                {briefing['30_day_forecast']}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
