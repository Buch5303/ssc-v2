'use client';
/**
 * RfqDetailPanel — EQS v1.0 / Directive 21A
 * Inline expandable detail surface for a drafted RFQ contact.
 * Answers: "What does the draft say, and what is the exact send action?"
 * DataState-aware. Token-only styling. Executive-command register.
 */
import { useState } from 'react';
import type { RfqQueueItem } from '../../lib/api/wave9';
import { OutputBadge } from '../badges/OutputBadge';

interface RfqDetailPanelProps {
  item: RfqQueueItem;
  draftPreview?: string; // Claude analysis preview text for this contact
}

function fmtK(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

function fmtTs(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ts; }
}

const FIELD: React.CSSProperties = {
  fontSize: 8, fontFamily: 'monospace',
  color: 'var(--text-tertiary)', marginBottom: 2,
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const VALUE: React.CSSProperties = {
  fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
  color: 'var(--text-primary)', marginBottom: 10,
};

export function RfqDetailPanel({ item, draftPreview }: RfqDetailPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const isDraft = item.rfq_status === 'draft';

  return (
    <div style={{
      border: '1px solid var(--purple-border)',
      borderRadius: 8, overflow: 'hidden',
      backgroundColor: 'var(--bg-panel)',
    }}>

      {/* ── Collapsed header — always visible ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', padding: '14px 20px', cursor: 'pointer',
          backgroundColor: expanded ? 'rgba(139,92,246,0.08)' : 'transparent',
          border: 'none', textAlign: 'left', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 12,
          borderBottom: expanded ? '1px solid var(--purple-border)' : 'none',
          transition: 'background-color 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            backgroundColor: 'var(--purple)',
            boxShadow: expanded ? '0 0 8px var(--purple)' : 'none',
            transition: 'box-shadow 0.15s ease',
          }} />
          <span style={{
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
            color: 'var(--text-primary)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.contact_name}
          </span>
          <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)', flexShrink: 0 }}>
            {item.supplier_name.split('/')[0].trim()} · {item.bop_category.replace(/_/g, ' ')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--purple)',
          }}>
            {fmtK(item.category_mid_usd)}
          </span>
          <span style={{
            fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
            backgroundColor: isDraft ? 'var(--amber-dim)' : 'var(--green-dim)',
            border: `1px solid ${isDraft ? 'var(--amber-border)' : 'var(--green-border)'}`,
            color: isDraft ? 'var(--amber)' : 'var(--green)',
          }}>
            {isDraft ? 'DRAFT READY' : 'SENT'}
          </span>
          <span style={{
            fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease', display: 'inline-block',
          }}>
            ▾
          </span>
        </div>
      </button>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div style={{ padding: '20px' }}>

          {/* Contact + value grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16,
            padding: '14px 16px', backgroundColor: 'var(--bg-elevated)', borderRadius: 6,
            border: '1px solid var(--border)',
          }}>
            <div>
              <div style={FIELD}>Contact</div>
              <div style={VALUE}>{item.contact_name}</div>
              <div style={FIELD}>Title</div>
              <div style={{ ...VALUE, fontSize: 9 }}>{item.title}</div>
            </div>
            <div>
              <div style={FIELD}>Organisation</div>
              <div style={VALUE}>{item.supplier_name.split('/')[0].trim()}</div>
              <div style={FIELD}>BOP Category</div>
              <div style={VALUE}>{item.bop_category.replace(/_/g, ' ')}</div>
            </div>
            <div>
              <div style={FIELD}>Target Value (Mid)</div>
              <div style={{ fontSize: 20, fontFamily: 'monospace', fontWeight: 700, color: 'var(--purple)', lineHeight: 1, marginBottom: 8 }}>
                {fmtK(item.category_mid_usd)}
              </div>
              <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                Indicative · ±15% · not RFQ
              </div>
            </div>
          </div>

          {/* Draft excerpt */}
          {draftPreview ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'var(--purple)', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>Draft Content</span>
                <OutputBadge outputType="generated" freshness="live" />
              </div>
              <div style={{
                padding: '14px 16px', backgroundColor: 'rgba(139,92,246,0.04)',
                border: '1px solid var(--purple-border)', borderRadius: 6,
                fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
                lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto',
              }}>
                {draftPreview.replace(/\*\*/g, '').replace(/^#+\s/gm, '').trim()}
              </div>
              <div style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 4 }}>
                AI-drafted · Full content stored in DB · Excerpt shown
              </div>
            </div>
          ) : (
            <div style={{
              marginBottom: 16, padding: '14px 16px',
              backgroundColor: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
              borderRadius: 6,
            }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--amber)' }}>
                DRAFT QUEUED — Content generating. Refresh to load draft excerpt.
              </span>
            </div>
          )}

          {/* Send action */}
          <div style={{
            padding: '12px 16px', backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--purple-border)', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: 2 }}>
                Send to: <span style={{ color: 'var(--cyan)' }}>{item.email}</span>
              </div>
              <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                outreach_id: {item.outreach_id} · status: {item.rfq_status.replace(/_/g, ' ').toUpperCase()}
              </div>
            </div>
            {item.outreach_id && (
              <code style={{
                fontSize: 8, fontFamily: 'monospace',
                color: 'var(--purple)', backgroundColor: 'var(--purple-dim)',
                border: '1px solid var(--purple-border)', padding: '6px 12px', borderRadius: 4,
              }}>
                POST /api/wave9/outreach/{item.outreach_id}/send
              </code>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
