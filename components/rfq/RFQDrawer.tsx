'use client';
import { Drawer } from '../ui/Drawer';
import { Badge }  from '../ui/Badge';
import { fmtCurrency, fmtVariance } from '../../lib/api/flowseer';
import type { RFQ as RFQType } from '../../lib/types/flowseer';

const RFQ_DETAIL: Record<string, any> = {
  'RFQ-001': {
    full_title: 'Vibration Monitoring System — Baker Hughes Bently Nevada',
    spec: 'Bently Nevada 3500 Series vibration monitoring system for W251B8 gas turbine. Includes 24-channel rack, proximity probes (x8), accelerometers (x4), keyphasor, system rack, all cabling, junction boxes, and engineering documentation.',
    delivery: 'Houston, TX staging facility → Santa Teresa, NM site',
    timeline: [
      { date: 'Apr 2, 2026', event: 'RFQ sent to Baker Hughes (Lorenzo Simonelli)', actor: 'TWP' },
      { date: 'Apr 10, 2026', event: 'Baker Hughes quote received: $340,000', actor: 'Baker Hughes' },
      { date: 'Apr 15, 2026', event: 'Quote under review — decision pending', actor: 'TWP' },
    ],
    actions: ['Accept PO at $340K → issue TWP-2026-0001', 'Negotiate: target $310K (−8.8%)', 'Rebid to Emerson/Siemens (risk: 4–6 week delay)'],
    contacts: 'Lorenzo Simonelli (CEO) · Rod Christie (EVP)',
    notes: 'Only supplier that has responded. BH Bently Nevada is W-frame OEM standard. Switching cost is high. Quote is +26.7% vs $268K estimate but within market range $290K–$420K.',
  },
  'RFQ-008': {
    full_title: 'Generator + Electrical Switchgear — GE Vernova',
    spec: 'Air-cooled synchronous generator rated for W251B8 output (per ICD). Includes medium voltage switchgear, protective relays, excitation system, AVR, anti-condensation heaters, TEWAC enclosure, generator circuit breaker.',
    delivery: 'GE manufacturing facility → Santa Teresa, NM site',
    timeline: [
      { date: 'May 25, 2026', event: 'RFQ send date — FIXED', actor: 'TWP' },
      { date: 'Jul 1, 2026', event: 'Expected response (est.)', actor: 'GE Vernova' },
      { date: 'Aug 15, 2026', event: 'Award deadline for Q2 2027 First Power', actor: 'TWP' },
    ],
    actions: ['Prepare RFQ package for May 25 send', 'Ensure competitive bid with RFQ-009 (Siemens)', 'Track lead time weekly post-award'],
    contacts: 'Gas Power BD — contact via powergensales@gevernova.com',
    notes: 'CRITICAL PATH — 40–56 week lead time. If awarded Aug 15, earliest delivery Oct 2027. No slippage permitted on send date.',
  },
  'RFQ-010': {
    full_title: 'Step-up Transformer (GSU) — ABB Power Grids',
    spec: 'BLOCKED — Requires EthosEnergy ICD for: Generator output voltage, MVA rating, impedance specification, HV voltage level. Cannot finalize specification without ICD.',
    delivery: 'ABB manufacturing → Santa Teresa, NM site',
    timeline: [
      { date: 'May 1, 2026', event: 'ICD must be received from EthosEnergy', actor: 'Alberto Malandra' },
      { date: 'May 25, 2026', event: 'RFQ send date (contingent on ICD receipt)', actor: 'TWP' },
      { date: 'Jul 10, 2026', event: 'Expected response (est.)', actor: 'ABB' },
    ],
    actions: ['Escalate ICD to Alberto Malandra immediately', 'Have RFQ-010 ready to send day ICD received', 'Pre-qualify ABB transformer contact now'],
    contacts: 'NA Transformers Division — transformers-na@abb.com',
    notes: 'Blocked on ICD. $760K scope, 52–70 week lead. Competing vs Siemens Energy RFQ-011.',
  },
};

interface Props { rfq: RFQType | null; onClose: () => void; }

export function RFQDrawer({ rfq, onClose }: Props) {
  const detail = rfq ? RFQ_DETAIL[rfq.id] : null;
  const isBlocked = rfq?.status === 'BLOCKED';
  const isResponded = rfq?.status === 'RESPONDED';

  const statusColor = isBlocked ? 'var(--red)' : isResponded ? 'var(--t0)' : 'var(--t2)';
  const statusBg    = isBlocked ? 'rgba(204,32,32,0.07)' : 'var(--bg2)';

  return (
    <Drawer open={!!rfq} onClose={onClose} title={rfq?.id ?? ''} subtitle={`RFQ Detail — ${rfq?.category ?? ''}`}>
      {rfq && (
        <div className="flex flex-col gap-5">

          {/* Status Banner */}
          <div className="px-4 py-3 border-l-2 font-mono text-[10px]" style={{
            background: statusBg,
            borderLeftColor: statusColor,
            color: statusColor,
            border: `1px solid ${statusColor}30`,
            borderLeft: `2px solid ${statusColor}`,
          }}>
            {rfq.status} — {rfq.company} — {fmtCurrency(rfq.est_value_usd)}
            {rfq.quoted_price && ` → Quoted: ${fmtCurrency(rfq.quoted_price)} (${fmtVariance(rfq.variance_pct)})`}
          </div>

          {/* Core Data */}
          <Sec title="Package Summary">
            <Row k="Package ID" v={rfq.id} mono />
            <Row k="Supplier" v={rfq.company} />
            <Row k="Contact" v={rfq.contact} />
            <Row k="Category" v={rfq.category} />
            <Row k="Est. Value" v={fmtCurrency(rfq.est_value_usd)} mono />
            {rfq.quoted_price && <Row k="Quoted Price" v={`${fmtCurrency(rfq.quoted_price)} (${fmtVariance(rfq.variance_pct)})`} mono />}
            {rfq.notes && <Row k="Notes" v={rfq.notes} />}
          </Sec>

          {/* Spec */}
          {detail?.spec && (
            <Sec title="Technical Specification">
              <p className="text-[11px] leading-[1.7]" style={{ color: 'var(--t1)' }}>{detail.spec}</p>
            </Sec>
          )}

          {/* Timeline */}
          {detail?.timeline && (
            <Sec title="Timeline">
              {detail.timeline.map((t: any, i: number) => (
                <div key={i} className="flex gap-3 py-2 border-b border-[--line] last:border-b-0">
                  <div className="font-mono text-[10px] w-[90px] flex-shrink-0" style={{ color: 'var(--t3)' }}>{t.date}</div>
                  <div className="flex-1 text-[11px]" style={{ color: 'var(--t0)' }}>{t.event}</div>
                  <div className="font-mono text-[9px] flex-shrink-0" style={{ color: 'var(--t2)' }}>{t.actor}</div>
                </div>
              ))}
            </Sec>
          )}

          {/* Actions */}
          {detail?.actions && (
            <Sec title="Required Actions">
              {detail.actions.map((a: string, i: number) => (
                <div key={i} className="py-2 border-b border-[--line] last:border-b-0 font-mono text-[10px]" style={{ color: 'var(--amb)' }}>
                  → {a}
                </div>
              ))}
            </Sec>
          )}

          {detail?.notes && (
            <Sec title="Program Notes">
              <p className="text-[11px] leading-[1.7]" style={{ color: 'var(--t1)' }}>{detail.notes}</p>
            </Sec>
          )}

        </div>
      )}
    </Drawer>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <div>
    <div className="font-mono text-[9px] tracking-[2px] uppercase mb-3 pb-2 border-b border-[--line]" style={{ color: 'var(--t3)' }}>{title}</div>
    {children}
  </div>;
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between items-baseline py-[7px] border-b border-[--line] last:border-b-0">
    <span className="text-[11px]" style={{ color: 'var(--t2)' }}>{k}</span>
    <span className={mono ? 'font-mono text-[11px]' : 'text-[11px] font-medium'} style={{ color: 'var(--t0)' }}>{v}</span>
  </div>;
}
