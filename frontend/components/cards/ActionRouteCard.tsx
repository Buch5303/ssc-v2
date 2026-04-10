'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExecutionContextStore } from '../../lib/context/ExecutionContextStore';
/**
 * ActionRouteCard — EQS v1.0 / Directive 24A
 * Reusable executive action-routing surface.
 * Answers: What should happen next? Can it execute now? If not, what is blocking it?
 * Token-only styling. DataState-aware. Zero training required.
 * Not a debug panel — reads as an executive routing instruction.
 */
import { ReadinessSignal, type ReadinessState } from '../badges/ReadinessSignal';
import { OutputBadge } from '../badges/OutputBadge';

export interface ActionRoute {
  title: string;
  whyItMatters: string;
  readiness: ReadinessState;
  blocker?: string;            // plain-English blocker if not executable
  executionPath: string;       // human-readable next step
  endpoint?: string;           // API endpoint if directly executable
  outputType?: 'estimated' | 'verified' | 'generated' | 'seeded' | 'live';
  href?: string;               // internal nav target (page + hash anchor)
}

interface ActionRouteCardProps {
  routes: ActionRoute[];
  uiState?: string;
  compact?: boolean;           // single-route inline mode
}

export function ActionRouteCard({ routes, uiState = 'operational', compact = false }: ActionRouteCardProps) {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  function navigate(href: string | undefined) {
    if (!href) return;
    // Parse page + anchor from href and persist context before navigating
    try {
      const [pagePart, anchor] = href.split('#');
      const page = pagePart.replace('/dashboard/', '').replace('/', '') || 'overview';
      if (anchor) {
        ExecutionContextStore.save({ page, section: anchor });
      }
    } catch { /* noop — persistence is non-critical */ }
    router.push(href);
  }
  if (uiState === 'loading') {
    return (
      <div style={{
        backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 16,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
          Loading action routes…
        </div>
      </div>
    );
  }

  if (uiState === 'error') {
    return (
      <div style={{
        backgroundColor: 'var(--red-dim)', border: '1px solid var(--red-border)',
        borderRadius: 8, padding: 16,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--red)' }}>
          ACTION ROUTING UNAVAILABLE — Platform state error
        </div>
      </div>
    );
  }

  if (routes.length === 0) return null;

  // Compact single-route mode — inline strip
  if (compact && routes.length === 1) {
    const r = routes[0];
    const isBlocked = r.readiness === 'BLOCKED' || r.readiness === 'AWAITING ENRICHMENT';
    return (
      <div
        onClick={() => navigate(r.href)}
        onMouseEnter={() => setHoveredIndex(0)}
        onMouseLeave={() => setHoveredIndex(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderRadius: 6,
          backgroundColor: isBlocked ? 'var(--amber-dim)' : 'var(--cyan-dim)',
          border: `1px solid ${isBlocked ? 'var(--amber-border)' : 'var(--cyan-border)'}`,
          cursor: r.href ? 'pointer' : 'default',
          transition: 'opacity 0.15s ease, background-color 0.15s ease',
          opacity: hoveredIndex === 0 && r.href ? 0.85 : 1,
        }}>
        <ReadinessSignal state={r.readiness} compact />
        <span style={{
          fontSize: 9, fontFamily: 'monospace', fontWeight: 600,
          color: 'var(--text-primary)', flex: 1,
        }}>
          {r.title}
        </span>
        {r.blocker && (
          <span style={{
            fontSize: 8, fontFamily: 'monospace', color: 'var(--amber)',
            backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
            padding: '2px 8px', borderRadius: 3,
          }}>
            BLOCKED: {r.blocker}
          </span>
        )}
        {r.endpoint && !isBlocked && (
          <code style={{
            fontSize: 7, fontFamily: 'monospace', color: 'var(--cyan)',
            backgroundColor: 'rgba(6,182,212,0.06)', border: '1px solid var(--cyan-border)',
            padding: '3px 8px', borderRadius: 3, flexShrink: 0,
          }}>
            {r.endpoint}
          </code>
        )}
      </div>
    );
  }

  // Full card mode — ranked list
  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)',
        }}>
          Action Routes
        </span>
        <span style={{
          fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
          backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)',
          color: 'var(--cyan)',
        }}>
          {routes.length} ROUTE{routes.length > 1 ? 'S' : ''} RANKED
        </span>
      </div>

      {/* Route rows */}
      {routes.map((r, i) => {
        const isBlocked = r.readiness === 'BLOCKED' || r.readiness === 'AWAITING ENRICHMENT';
        const borderColor = isBlocked ? 'var(--amber-border)' : 'rgba(255,255,255,0.03)';
        return (
          <div key={i} style={{
            padding: '12px 20px',
            borderBottom: i < routes.length - 1 ? `1px solid ${borderColor}` : 'none',
            backgroundColor: isBlocked ? 'rgba(245,158,11,0.02)' : 'transparent',
          }}>
            {/* Title + readiness */}
            <div style={{
              display: 'flex', alignItems: 'flex-start',
              justifyContent: 'space-between', gap: 12, marginBottom: 8,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}>
                    {r.title}
                  </span>
                </div>
                <div style={{
                  fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                }}>
                  {r.whyItMatters}
                </div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <ReadinessSignal state={r.readiness} compact />
                {r.outputType && <OutputBadge outputType={r.outputType} freshness="live" />}
              </div>
            </div>

            {/* Blocker */}
            {r.blocker && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', borderRadius: 5, marginBottom: 8,
                backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
              }}>
                <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--amber)', fontWeight: 700, flexShrink: 0 }}>
                  BLOCKER
                </span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--amber)' }}>
                  {r.blocker}
                </span>
              </div>
            )}

            {/* Execution path + endpoint */}
            <div
              onClick={() => navigate(r.href)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '8px 12px', borderRadius: 5,
              backgroundColor: hoveredIndex === i && r.href
                ? (isBlocked ? 'rgba(245,158,11,0.10)' : 'rgba(6,182,212,0.10)')
                : (isBlocked ? 'rgba(245,158,11,0.04)' : 'rgba(6,182,212,0.04)'),
              border: `1px solid ${isBlocked ? 'var(--amber-border)' : 'var(--cyan-border)'}`,
              cursor: r.href ? 'pointer' : 'default',
              transition: 'background-color 0.15s ease',
            }}>
              <span style={{
                fontSize: 9, fontFamily: 'monospace', fontWeight: 600,
                color: isBlocked ? 'var(--amber)' : 'var(--cyan)',
              }}>
                → {r.executionPath}
              </span>
              {r.endpoint && (
                <code style={{
                  fontSize: 7, fontFamily: 'monospace', flexShrink: 0,
                  color: isBlocked ? 'var(--amber)' : 'var(--cyan)',
                  backgroundColor: isBlocked ? 'var(--amber-dim)' : 'var(--cyan-dim)',
                  border: `1px solid ${isBlocked ? 'var(--amber-border)' : 'var(--cyan-border)'}`,
                  padding: '3px 8px', borderRadius: 3,
                }}>
                  {r.endpoint}
                </code>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
