'use client';
import { useState, useEffect } from 'react';
import { Badge } from './Badge';

interface Notification {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  detail: string;
  timestamp: string;
  read: boolean;
  action?: string;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', type: 'critical', title: 'EthosEnergy ICD Overdue', detail: 'ICD has been outstanding for 35 days. $1.73M in RFQs blocked. Escalation recommended.', timestamp: new Date().toISOString(), read: false, action: '/dashboard/risk' },
  { id: 'n2', type: 'warning', title: 'Baker Hughes Decision Deadline Approaching', detail: 'VIB_MON quote at $340K (+26.7%) requires accept/negotiate/rebid by May 1.', timestamp: new Date(Date.now() - 86400000).toISOString(), read: false, action: '/dashboard/rfq-pipeline' },
  { id: 'n3', type: 'warning', title: 'RFQ Send Date in 36 Days', detail: 'May 25, 2026 — 13 packages prepared, 10 ready, 3 blocked by ICD.', timestamp: new Date(Date.now() - 172800000).toISOString(), read: false },
  { id: 'n4', type: 'success', title: 'AI Orchestration Pipeline Deployed', detail: '5-agent automation system live at /dashboard/automation. EQS v1.0 enforcement active.', timestamp: new Date(Date.now() - 259200000).toISOString(), read: true },
  { id: 'n5', type: 'info', title: 'Platform Self-Management Activated', detail: 'VERCEL_TOKEN bootstrapped. FlowSeer can now manage its own env vars and deployments.', timestamp: new Date(Date.now() - 345600000).toISOString(), read: true },
  { id: 'n6', type: 'success', title: 'Google Gemini Analyst Connected', detail: 'GOOGLE_AI_KEY set. Gemini 2.5 Pro analyst agent now operational in automation pipeline.', timestamp: new Date(Date.now() - 432000000).toISOString(), read: true },
];

const typeColor: Record<string, string> = {
  critical: '#E83535', warning: '#F59E0B', info: '#1E6FCC', success: '#22C55E',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const unread = notifications.filter(n => !n.read).length;

  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          position: 'relative', padding: '4px 6px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 2, width: 14, height: 14, borderRadius: '50%',
            background: '#E83535', color: '#fff', fontSize: 8, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
          />
          <div style={{
            position: 'absolute', top: 32, right: 0, width: 380, maxHeight: 460,
            background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 100, overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--line)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>
                Notifications {unread > 0 && <span style={{ color: '#E83535' }}>({unread})</span>}
              </span>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--brand-blue2)',
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--line)',
                    cursor: 'pointer', background: n.read ? 'transparent' : 'rgba(30,111,204,0.03)',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                      background: n.read ? 'var(--line)' : typeColor[n.type],
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: n.read ? 'var(--t2)' : 'var(--t0)' }}>
                          {n.title}
                        </span>
                        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8.5, color: 'var(--t3)', flexShrink: 0, marginLeft: 8 }}>
                          {timeAgo(n.timestamp)}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.5 }}>
                        {n.detail}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
