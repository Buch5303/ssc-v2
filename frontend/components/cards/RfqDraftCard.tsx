'use client';
/**
 * RfqDraftCard — EQS v1.0
 * Surfaces drafted RFQ contact intelligence in /dashboard/rfq-pipeline.
 * DataState-aware. Token-only styling. Zero raw Recharts. Zero inline hex.
 * Answers: "What outreach draft is ready, for whom, and what is it worth?"
 */
import type { RfqQueueItem } from '../../lib/api/wave9';
import { OutputBadge } from '../badges/OutputBadge';

interface RfqDraftCardProps {
  items: RfqQueueItem[];
}

function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

const SENIORITY_LABEL: Record<string, string> = {
  c_suite: 'C-SUITE',
  vp:      'VP',
  director:'DIR',
};

export function RfqDraftCard({ items }: RfqDraftCardProps) {
  const drafted = items.filter(i => i.rfq_status === 'draft' || i.rfq_status === 'sent');

  if (drafted.length === 0) return null;

  return (
    <div style={{
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--purple-border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--purple-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'rgba(139,92,246,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: 'var(--purple)', flexShrink: 0,
            boxShadow: '0 0 6px var(--purple)',
          }} />
          <span style={{
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--purple)',
          }}>
            Drafted RFQ Outreach
          </span>
          <span style={{
            fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
            backgroundColor: 'var(--purple-dim)', border: '1px solid var(--purple-border)',
            color: 'var(--purple)',
          }}>
            {drafted.length} DRAFT{drafted.length > 1 ? 'S' : ''} READY
          </span>
        </div>
        <OutputBadge outputType="generated" freshness="live" />
      </div>

      {/* Draft rows */}
      {drafted.map(item => {
        const totalValue = fmtK(item.category_mid_usd);
        const senLabel   = SENIORITY_LABEL[item.seniority] ?? item.seniority.toUpperCase();
        const isDraft    = item.rfq_status === 'draft';

        return (
          <div key={item.id} style={{
            padding: '14px 20px',
            borderBottom: '1px solid rgba(139,92,246,0.08)',
          }}>
            {/* Contact line */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
                    backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)', color: 'var(--cyan)',
                  }}>
                    {senLabel}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.contact_name}
                  </span>
                </div>
                <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 2 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--cyan)' }}>
                  {item.supplier_name.split('/')[0].trim()} · {item.bop_category.replace(/_/g, ' ')}
                </div>
              </div>

              {/* Value + status */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontSize: 16, fontFamily: 'monospace', fontWeight: 700,
                  color: 'var(--purple)', lineHeight: 1, marginBottom: 4,
                }}>
                  {totalValue}
                </div>
                <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  mid estimate · not RFQ
                </div>
                <span style={{
                  fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
                  backgroundColor: isDraft ? 'var(--amber-dim)' : 'var(--green-dim)',
                  border: `1px solid ${isDraft ? 'var(--amber-border)' : 'var(--green-border)'}`,
                  color: isDraft ? 'var(--amber)' : 'var(--green)',
                }}>
                  {isDraft ? 'DRAFT READY' : 'SENT'}
                </span>
              </div>
            </div>

            {/* Action + email */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: 6,
              backgroundColor: 'rgba(139,92,246,0.04)', border: '1px solid var(--purple-border)',
            }}>
              <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                ✉ {item.email}
              </div>
              {item.outreach_id && (
                <code style={{
                  fontSize: 7, fontFamily: 'monospace',
                  color: 'var(--purple)', backgroundColor: 'var(--purple-dim)',
                  border: '1px solid var(--purple-border)', padding: '3px 8px', borderRadius: 3,
                }}>
                  POST /api/wave9/outreach/{item.outreach_id}/send
                </code>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
