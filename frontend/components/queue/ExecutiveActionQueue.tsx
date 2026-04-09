'use client';
/**
 * ExecutiveActionQueue — EQS v1.0 / Directive 21C
 * Surfaces ranked, plain-English executive next actions based on live platform state.
 * Answers: "What matters now, why it matters, and what to do next."
 * DataState-aware. Token-only styling. Zero ambiguity.
 */
import type { RfqQueueResponse } from '../../lib/api/wave9';

interface ExecutiveActionQueueProps {
  rfqQueue: RfqQueueResponse | undefined;
  analysesRun: number;
  totalContacts: number;
  withEmail: number;
  uiState?: string;
}

interface Action {
  rank: number;
  priority: 'NOW' | 'NEXT' | 'WHEN READY';
  priorityColor: string;
  priorityBg: string;
  priorityBorder: string;
  title: string;
  why: string;
  doThis: string;
  endpoint?: string;
}

export function ExecutiveActionQueue({
  rfqQueue,
  analysesRun,
  totalContacts,
  withEmail,
  uiState = 'operational',
}: ExecutiveActionQueueProps) {

  const drafted  = rfqQueue?.drafted ?? 0;
  const notStarted = rfqQueue?.not_started ?? 0;
  const nextContact = rfqQueue?.next;

  const actions: Action[] = [];

  // Action 1: Send drafted RFQ if one exists
  if (drafted > 0) {
    actions.push({
      rank: 1,
      priority: 'NOW',
      priorityColor: 'var(--green)',
      priorityBg: 'var(--green-dim)',
      priorityBorder: 'var(--green-border)',
      title: 'Send the Lorenzo Simonelli RFQ',
      why: `A Claude-drafted RFQ is ready for Baker Hughes CEO Lorenzo Simonelli ($340K Vibration Monitoring). Every day the draft sits unsent is pipeline delay.`,
      doThis: 'Execute the send endpoint to initiate outreach. Review draft excerpt above before sending.',
      endpoint: 'POST /api/wave9/outreach/1/send',
    });
  }

  // Action 2: Draft next contact
  if (nextContact) {
    actions.push({
      rank: drafted > 0 ? 2 : 1,
      priority: drafted > 0 ? 'NEXT' : 'NOW',
      priorityColor: drafted > 0 ? 'var(--cyan)' : 'var(--green)',
      priorityBg: drafted > 0 ? 'var(--cyan-dim)' : 'var(--green-dim)',
      priorityBorder: drafted > 0 ? 'var(--cyan-border)' : 'var(--green-border)',
      title: `Draft RFQ — ${nextContact.contact_name}, ${nextContact.supplier_name.split('/')[0].trim()}`,
      why: `${nextContact.contact_name} (${nextContact.title}) is the highest-value uncontacted target at $${(nextContact.category_mid_usd / 1000).toFixed(0)}K. ${notStarted} targets still in queue.`,
      doThis: `Fire the draft endpoint. Claude will generate a project-specific RFQ in under 30 seconds.`,
      endpoint: `POST /api/wave9/contacts/${nextContact.id}/rfq`,
    });
  }

  // Action 3: Apollo upgrade if email coverage is low
  const emailPct = totalContacts > 0 ? Math.round((withEmail / totalContacts) * 100) : 0;
  if (emailPct < 50) {
    actions.push({
      rank: actions.length + 1,
      priority: 'WHEN READY',
      priorityColor: 'var(--amber)',
      priorityBg: 'var(--amber-dim)',
      priorityBorder: 'var(--amber-border)',
      title: 'Upgrade Apollo to verify all 231 contacts',
      why: `Only ${emailPct}% of contacts have verified emails. Apollo Basic ($49/mo) pushes that to ~95%, unlocking the full outreach pipeline across all BOP categories.`,
      doThis: 'Upgrade Apollo account → run POST /api/wave9/enrich-contacts → all contacts enriched.',
    });
  }

  // Action 4: Remaining analyses if < full coverage
  const TOTAL_CATEGORIES = 19;
  const remainingAnalyses = TOTAL_CATEGORIES - Math.min(analysesRun, TOTAL_CATEGORIES);
  if (remainingAnalyses > 0 && analysesRun < TOTAL_CATEGORIES) {
    actions.push({
      rank: actions.length + 1,
      priority: 'WHEN READY',
      priorityColor: 'var(--purple)',
      priorityBg: 'var(--purple-dim)',
      priorityBorder: 'var(--purple-border)',
      title: `Run remaining BOP analyses (${remainingAnalyses} categories uncovered)`,
      why: `${analysesRun} supplier comparisons complete. Remaining categories have no AI sourcing intelligence — decisions without analysis carry higher procurement risk.`,
      doThis: 'Run GET /api/claude/run-compare-suppliers?category=X for each uncovered BOP category.',
    });
  }

  if (uiState === 'loading') {
    return (
      <div style={{
        backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 20,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
          Loading action queue…
        </div>
      </div>
    );
  }

  if (actions.length === 0) return null;

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
          Executive Action Queue
        </span>
        <span style={{
          fontSize: 7, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 3,
          backgroundColor: 'var(--cyan-dim)', border: '1px solid var(--cyan-border)', color: 'var(--cyan)',
        }}>
          {actions.length} ACTION{actions.length > 1 ? 'S' : ''} RANKED
        </span>
      </div>

      {/* Action rows */}
      {actions.map((action, i) => (
        <div key={action.rank} style={{
          padding: '16px 20px',
          borderBottom: i < actions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
          display: 'flex', gap: 16, alignItems: 'flex-start',
        }}>
          {/* Rank + priority */}
          <div style={{ flexShrink: 0, textAlign: 'center', width: 52 }}>
            <div style={{
              fontSize: 18, fontFamily: 'monospace', fontWeight: 700,
              color: 'var(--text-tertiary)', lineHeight: 1, marginBottom: 4,
            }}>
              {action.rank < 10 ? `0${action.rank}` : action.rank}
            </div>
            <span style={{
              fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3,
              backgroundColor: action.priorityBg,
              border: `1px solid ${action.priorityBorder}`,
              color: action.priorityColor,
              whiteSpace: 'nowrap',
            }}>
              {action.priority}
            </span>
          </div>

          {/* Action detail */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
              color: 'var(--text-primary)', marginBottom: 5,
            }}>
              {action.title}
            </div>
            <div style={{
              fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
              lineHeight: 1.6, marginBottom: 6,
            }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Why: </span>{action.why}
            </div>
            <div style={{
              fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)',
              lineHeight: 1.6, marginBottom: action.endpoint ? 8 : 0,
            }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Do: </span>{action.doThis}
            </div>
            {action.endpoint && (
              <code style={{
                fontSize: 8, fontFamily: 'monospace',
                color: action.priorityColor,
                backgroundColor: action.priorityBg,
                border: `1px solid ${action.priorityBorder}`,
                padding: '4px 10px', borderRadius: 4, display: 'inline-block',
              }}>
                {action.endpoint}
              </code>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
