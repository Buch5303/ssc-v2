'use client';
import { useState, useEffect } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Panel } from '../../../components/ui/Panel';
import { TierLabel } from '../../../components/ui/TierLabel';

interface HealthData {
  status: string;
  platform: string;
  program: string;
  client: string;
  bop_total: number;
  checks: Record<string, boolean>;
}

interface AdminData {
  status: string;
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/health').then(r => r.json()).catch(() => null),
      fetch('/api/admin').then(r => r.json()).catch(() => null),
    ]).then(([h, a]) => {
      setHealth(h);
      setAdmin(a);
      setLoading(false);
    });
  }, []);

  const checks = health?.checks || {};
  const allPassing = Object.values(checks).every(Boolean);

  return (
    <div className="p-6 max-w-[1400px]">
      <TierLabel>System Settings & Infrastructure Status</TierLabel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Platform Health */}
        <Panel title="Platform Health" meta={<Badge variant={allPassing ? 'verified' : 'critical'}>{allPassing ? 'Healthy' : 'Degraded'}</Badge>}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)' }}>Loading...</div>
          ) : (
            <>
              {[
                { l: 'Platform', v: health?.platform || '—' },
                { l: 'Program', v: health?.program || '—' },
                { l: 'Client', v: health?.client || '—' },
                { l: 'BOP Total', v: health?.bop_total ? `$${(health.bop_total / 1_000_000).toFixed(2)}M` : '—' },
                { l: 'Status', v: health?.status || '—', a: health?.status === 'healthy' ? 'ok' : 'c' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 11, color: 'var(--t2)' }}>{s.l}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: (s as any).a === 'ok' ? '#22C55E' : (s as any).a === 'c' ? '#E83535' : 'var(--t0)', fontWeight: 500 }}>{s.v}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Subsystem Checks</div>
              {Object.entries(checks).map(([key, ok], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 10, color: 'var(--t2)' }}>{key.replace(/_/g, ' ')}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: ok ? '#22C55E' : '#E83535', fontWeight: 600 }}>{ok ? 'PASS' : 'FAIL'}</span>
                </div>
              ))}
            </>
          )}
        </Panel>

        {/* Self-Management */}
        <Panel title="Self-Management API" meta={<Badge variant={admin?.status?.includes('ACTIVE') ? 'verified' : 'warning'}>{admin?.status?.includes('ACTIVE') ? 'Active' : 'Setup Needed'}</Badge>}>
          <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 12 }}>
            {admin?.status?.includes('ACTIVE')
              ? 'FlowSeer manages its own infrastructure via the Vercel REST API. Environment variables, deployments, and configuration changes are handled autonomously through /api/admin. No human admin console access required.'
              : 'Self-management requires a bootstrapped VERCEL_TOKEN. Contact the administrator to complete setup.'}
          </div>
          {[
            { l: 'Endpoint', v: '/api/admin' },
            { l: 'Status', v: admin?.status?.includes('ACTIVE') ? 'ACTIVE' : 'SETUP NEEDED', a: admin?.status?.includes('ACTIVE') ? 'ok' : 'w' },
            { l: 'Capabilities', v: 'set_env, list_env, redeploy, check_token' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 10, color: 'var(--t2)' }}>{s.l}</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: (s as any).a === 'ok' ? '#22C55E' : (s as any).a === 'w' ? '#F59E0B' : 'var(--t1)', fontWeight: 500 }}>{s.v}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* API Keys & Credentials */}
      <TierLabel>API Keys & Credentials</TierLabel>
      <Panel title="Service Configuration" meta={<Badge variant="estimated">5 of 7 Active</Badge>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Service', 'Key Name', 'Status', 'Powers', 'Provider'].map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 9, fontWeight: 600, color: 'var(--t3)', borderBottom: '1px solid var(--line)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {[
              { svc: 'Anthropic Claude', key: 'ANTHROPIC_API_KEY', st: 'active', powers: 'Architect, Builder, Auditor fallback, AI Briefing, Risk Analysis', provider: 'console.anthropic.com' },
              { svc: 'Google Gemini', key: 'GOOGLE_AI_KEY', st: 'active', powers: 'Analyst agent (1M-token codebase review)', provider: 'aistudio.google.com' },
              { svc: 'DeepSeek', key: 'DEEPSEEK_API_KEY', st: 'active', powers: 'Auditor agent (code review + security audit)', provider: 'platform.deepseek.com' },
              { svc: 'Vercel Management', key: 'VERCEL_TOKEN', st: 'active', powers: 'Self-management — env vars, deploys, config', provider: 'vercel.com/account/tokens' },
              { svc: 'GitHub Push', key: 'GitHub PAT', st: 'active', powers: 'Code push automation from Claude sessions', provider: 'github.com/settings/tokens' },
              { svc: 'Perplexity', key: 'PERPLEXITY_API_KEY', st: 'not_set', powers: 'Researcher agent, Threat Radar, Incentive Radar live scanning', provider: 'perplexity.ai/settings' },
              { svc: 'Mailgun / SendGrid', key: 'MAILGUN_API_KEY', st: 'not_set', powers: 'Email dispatch — RFQ sends, notifications', provider: 'mailgun.com / sendgrid.com' },
            ].map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '8px', fontSize: 11, fontWeight: 500, color: 'var(--t0)' }}>{r.svc}</td>
                <td style={{ padding: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'var(--t2)' }}>{r.key}</td>
                <td style={{ padding: '8px' }}>
                  <Badge variant={r.st === 'active' ? 'verified' : 'warning'}>{r.st === 'active' ? 'ACTIVE' : 'NOT SET'}</Badge>
                </td>
                <td style={{ padding: '8px', fontSize: 10, color: 'var(--t2)' }}>{r.powers}</td>
                <td style={{ padding: '8px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)' }}>{r.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Build Info */}
      <div className="mt-6">
        <TierLabel>Build Information</TierLabel>
        <Panel title="Platform Version & Architecture" meta={<Badge variant="silent">EQS v1.0</Badge>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              {[
                { l: 'Platform', v: 'FlowSeer v2.2.0' },
                { l: 'Framework', v: 'Next.js 14 + TypeScript + React' },
                { l: 'Styling', v: 'Tailwind CSS + CSS Variables' },
                { l: 'Deployment', v: 'Vercel Edge Network (Global CDN)' },
                { l: 'Database', v: 'Neon PostgreSQL + JSON Fallback' },
                { l: 'Auth', v: 'NextAuth.js + Password Gate' },
                { l: 'Repository', v: 'github.com/Buch5303/ssc-v2' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 10, color: 'var(--t2)' }}>{s.l}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'var(--t1)' }}>{s.v}</span>
                </div>
              ))}
            </div>
            <div>
              {[
                { l: 'Dashboard Pages', v: '11' },
                { l: 'API Endpoints', v: '19+' },
                { l: 'UI Components', v: '14' },
                { l: 'Python Tools', v: '12 (12,468 lines)' },
                { l: 'Total Codebase', v: '~18,500 lines' },
                { l: 'AI Agents', v: '5 (4 providers)' },
                { l: 'EQS Compliance', v: 'Enforced in agent prompts' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 10, color: 'var(--t2)' }}>{s.l}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'var(--t1)' }}>{s.v}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* Footer */}
      <div className="mt-10 pt-3 border-t border-[--line] flex justify-between font-mono text-[9px] text-[--t3]">
        <span>FlowSeer v2.2.0 · Trans World Power LLC · EQS v1.0</span>
        <span>Self-managing · 5-agent governance · Bidirectional surveillance</span>
      </div>
    </div>
  );
}
