'use client';
import { useHealthCheck } from '../../lib/hooks/useLiveData';
import { useEffect, useState } from 'react';
import { NotificationBell } from '../ui/NotificationBell';

export function TopBar() {
  const { data: health } = useHealthCheck();
  const [ts, setTs] = useState('');

  useEffect(() => {
    const fmt = () => {
      const now = new Date();
      setTs(
        now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' · ' +
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      );
    };
    fmt();
    const id = setInterval(fmt, 60_000);
    return () => clearInterval(id);
  }, []);

  const isHealthy = health?.status === 'healthy';
  const bop       = health?.bop_total
    ? `$${(Number(health.bop_total) / 1_000_000).toFixed(2)}M`
    : '—';

  return (
    <div style={{
      height: 36,
      background: 'var(--bg1)',
      borderBottom: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
    }}>
      {/* Left: program ID */}
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)', letterSpacing: '1px' }}>
        TG20/W251 · CLIENT: BORDERPLEX · BOP {bop}
      </div>

      {/* Right: health + timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: isHealthy ? 'var(--t2)' : 'var(--red)',
            boxShadow: isHealthy ? 'none' : '0 0 4px var(--red)',
          }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)', letterSpacing: '0.8px' }}>
            {isHealthy ? '25/25 HEALTHY' : 'DEGRADED'}
          </span>
        </div>
        <NotificationBell />
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--t3)' }}>
          {ts}
        </span>
      </div>
    </div>
  );
}
