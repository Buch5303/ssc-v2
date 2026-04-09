'use client';
/**
 * AnalysisDetailCard — EQS v1.0 / Directive 21B
 * Executive-facing detail surface for a completed Claude supplier analysis.
 * Answers: "Who won, who is backup, what are the red flags, and is this RFQ-ready?"
 * DataState-aware. Token-only styling. Zero raw Recharts. Self-describing labels.
 */
import { useState } from 'react';
import { OutputBadge } from '../badges/OutputBadge';

interface AnalysisResult {
  id: number;
  analysis_type: string;
  subject_name: string;
  model: string;
  model_cost_usd: string;
  created_at: string;
  preview: string;
}

interface AnalysisDetailCardProps {
  result: AnalysisResult;
  targetValueUsd?: number; // from pricing summary if available
}

function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

function fmtDate(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ts; }
}

function extractCategory(subjectName: string): string {
  return subjectName
    .replace('Supplier Comparison — ', '')
    .replace('Supplier Comparison: ', '')
    .replace(/_/g, ' ');
}

function extractWinner(preview: string): string | null {
  const patterns = [
    /WINNER[:\s*\n]+\*?\*?([A-Z][^\n*]+)/i,
    /RANK 1[:\s*\n]+\*?\*?([A-Z][^\n*()]+)/i,
    /1st[:\s|*]+\*?\*?([A-Z][^\n*|]+)/i,
  ];
  for (const p of patterns) {
    const m = preview.match(p);
    if (m) return m[1].trim().replace(/\*\*/g, '').split('—')[0].trim();
  }
  return null;
}

function extractBackup(preview: string): string | null {
  const patterns = [
    /BACKUP[:\s*\n]+\*?\*?([A-Z][^\n*]+)/i,
    /RANK 2[:\s*\n]+\*?\*?([A-Z][^\n*()]+)/i,
    /2nd[:\s|*]+\*?\*?([A-Z][^\n*|]+)/i,
  ];
  for (const p of patterns) {
    const m = preview.match(p);
    if (m) return m[1].trim().replace(/\*\*/g, '').split('—')[0].trim();
  }
  return null;
}

function hasRedFlag(preview: string): boolean {
  return /AVOID|CRITICAL|red flag/i.test(preview);
}

export function AnalysisDetailCard({ result, targetValueUsd }: AnalysisDetailCardProps) {
  const [expanded, setExpanded] = useState(false);

  const category  = extractCategory(result.subject_name);
  const winner    = extractWinner(result.preview);
  const backup    = extractBackup(result.preview);
  const flagged   = hasRedFlag(result.preview);
  const cost      = parseFloat(result.model_cost_usd);
  const isComp    = result.analysis_type === 'supplier_comparison';

  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)',
      border: `1px solid ${flagged ? 'var(--amber-border)' : 'var(--border)'}`,
      borderRadius: 8, overflow: 'hidden',
    }}>

      {/* ── Collapsed header ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', padding: '14px 20px', cursor: 'pointer',
          backgroundColor: expanded ? 'var(--bg-elevated)' : 'transparent',
          border: 'none', textAlign: 'left', display: 'flex',
          alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Category + badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
              backgroundColor: 'var(--purple-dim)', border: '1px solid var(--purple-border)',
              color: 'var(--purple)',
            }}>
              AI ANALYSIS
            </span>
            {flagged && (
              <span style={{
                fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
                backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
                color: 'var(--amber)',
              }}>
                ⚠ FLAG
              </span>
            )}
            <span style={{
              fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)',
            }}>
              {category}
            </span>
          </div>

          {/* Winner + backup inline */}
          {isComp && (winner || backup) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {winner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--green)', fontWeight: 700 }}>
                    #1
                  </span>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--green)' }}>
                    {winner}
                  </span>
                </div>
              )}
              {backup && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', fontWeight: 700 }}>
                    #2
                  </span>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    {backup}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side: value + timestamp + expand */}
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {targetValueUsd && (
            <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--cyan)' }}>
              {fmtK(targetValueUsd)}
            </span>
          )}
          <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
            {fmtDate(result.created_at)}
          </span>
          <span style={{
            fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
            backgroundColor: 'var(--green-dim)', border: '1px solid var(--green-border)',
            color: 'var(--green)',
          }}>
            RFQ-READY
          </span>
          <span style={{
            fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease', display: 'inline-block', marginTop: 2,
          }}>
            ▾
          </span>
        </div>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Meta row */}
          <div style={{
            display: 'flex', gap: 20, flexWrap: 'wrap',
            padding: '10px 14px', backgroundColor: 'var(--bg-elevated)',
            borderRadius: 6, border: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 2, textTransform: 'uppercase' }}>Model</div>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{result.model}</div>
            </div>
            <div>
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 2, textTransform: 'uppercase' }}>Cost</div>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>${cost.toFixed(4)}</div>
            </div>
            <div>
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 2, textTransform: 'uppercase' }}>Completed</div>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmtDate(result.created_at)}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <OutputBadge outputType="generated" freshness="live" />
            </div>
          </div>

          {/* Winner / Backup / Flags summary */}
          {isComp && (
            <div style={{
              display: 'grid', gridTemplateColumns: winner && backup ? '1fr 1fr' : '1fr',
              gap: 10,
            }}>
              {winner && (
                <div style={{
                  padding: '12px 14px', backgroundColor: 'var(--green-dim)',
                  border: '1px solid var(--green-border)', borderRadius: 6,
                }}>
                  <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--green)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Recommended Supplier
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--green)' }}>
                    {winner}
                  </div>
                  <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Approach first · Lock pricing early
                  </div>
                </div>
              )}
              {backup && (
                <div style={{
                  padding: '12px 14px', backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 6,
                }}>
                  <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Backup / Leverage
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {backup}
                  </div>
                  <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Use to pressure primary on price
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Analysis excerpt */}
          <div>
            <div style={{
              fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 6,
            }}>
              Intelligence Excerpt
            </div>
            <div style={{
              padding: '12px 14px', backgroundColor: 'rgba(139,92,246,0.04)',
              border: '1px solid var(--purple-border)', borderRadius: 6,
              fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
              lineHeight: 1.8, maxHeight: 180, overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {result.preview.replace(/\*\*/g, '').replace(/^#+\s/gm, '▸ ').replace(/^---$/gm, '').trim()}
            </div>
          </div>

          {/* Red flag callout */}
          {flagged && (
            <div style={{
              padding: '10px 14px', backgroundColor: 'var(--amber-dim)',
              border: '1px solid var(--amber-border)', borderRadius: 6,
            }}>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--amber)', fontWeight: 700 }}>
                ⚠ AVOID FLAG DETECTED
              </span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-secondary)', marginLeft: 8 }}>
                One or more suppliers in this category are flagged. Review full analysis before RFQ.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
