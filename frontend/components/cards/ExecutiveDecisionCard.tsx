'use client';
/**
 * ExecutiveDecisionCard — EQS v1.0 / Directive 22C
 * Compact decision surface for high-value procurement items.
 * Answers: item name / current state / why it matters / recommended next move.
 * Not a dump card. An executive decision surface.
 * Token-only. DataState-aware. Zero training required.
 */
import { ReadinessSignal, type ReadinessState } from '../badges/ReadinessSignal';
import { OutputBadge } from '../badges/OutputBadge';

export interface DecisionItem {
  id: string | number;
  name: string;
  category: string;
  valueUsd: number;
  readiness: ReadinessState;
  whyItMatters: string;
  recommendedMove: string;
  endpoint?: string;
  outputType?: 'estimated' | 'verified' | 'generated' | 'seeded' | 'live';
  timestamp?: string;
}

interface ExecutiveDecisionCardProps {
  items: DecisionItem[];
  title: string;
  uiState?: string;
}

function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

export function ExecutiveDecisionCard({ items, title, uiState = 'operational' }: ExecutiveDecisionCardProps) {
  if (uiState === 'loading') {
    return (
      <div style={{
        backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 20,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
          Loading decision surface…
        </div>
      </div>
    );
  }

  if (uiState === 'empty' || items.length === 0) {
    return (
      <div style={{
        backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
          No decision items available
        </div>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Items will appear once analyses and RFQ drafts are completed
        </div>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)',
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
          backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)',
          color: 'var(--cyan)',
        }}>
          {items.length} ITEM{items.length > 1 ? 'S' : ''}
        </span>
      </div>

      {/* Decision rows */}
      {items.map((item, i) => (
        <div key={item.id} style={{
          padding: '16px 20px',
          borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
        }}>
          {/* Top row: name + value + readiness */}
          <div style={{
            display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 12, marginBottom: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                color: 'var(--text-primary)', marginBottom: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.name}
              </div>
              <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                {item.category.replace(/_/g, ' ')}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{
                fontSize: 16, fontFamily: 'monospace', fontWeight: 700,
                color: 'var(--cyan)', lineHeight: 1, marginBottom: 6,
              }}>
                {fmtK(item.valueUsd)}
              </div>
              <ReadinessSignal state={item.readiness} compact />
            </div>
          </div>

          {/* Why + Move */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: item.endpoint ? 10 : 0,
          }}>
            <div style={{
              padding: '10px 12px', borderRadius: 5,
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
            }}>
              <div style={{
                fontSize: 7, fontFamily: 'monospace', textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4,
              }}>
                Why it matters
              </div>
              <div style={{
                fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}>
                {item.whyItMatters}
              </div>
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 5,
              backgroundColor: 'rgba(6,182,212,0.04)', border: '1px solid var(--cyan-border)',
            }}>
              <div style={{
                fontSize: 7, fontFamily: 'monospace', textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--cyan)', marginBottom: 4,
              }}>
                Recommended move
              </div>
              <div style={{
                fontSize: 9, fontFamily: 'monospace', color: 'var(--text-primary)',
                lineHeight: 1.6, fontWeight: 600,
              }}>
                {item.recommendedMove}
              </div>
            </div>
          </div>

          {/* Endpoint + badge */}
          {(item.endpoint || item.outputType) && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              {item.endpoint && (
                <code style={{
                  fontSize: 7, fontFamily: 'monospace',
                  color: 'var(--cyan)', backgroundColor: 'var(--cyan-dim)',
                  border: '1px solid var(--cyan-border)',
                  padding: '3px 8px', borderRadius: 3,
                }}>
                  {item.endpoint}
                </code>
              )}
              {item.outputType && (
                <OutputBadge outputType={item.outputType} freshness="live" />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
