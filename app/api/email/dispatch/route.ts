import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RFQ_EMAIL_TEMPLATES } from '../../../../lib/email/rfqTemplates';

async function sendViaMailgun(to: string, cc: string|undefined, subject: string, body: string) {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!key || !domain) return false;
  const form = new URLSearchParams();
  form.append('from', `FlowSeer <flowseer@${domain}>`);
  form.append('to', to);
  if (cc) form.append('cc', cc);
  form.append('subject', subject);
  form.append('text', body);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return res.ok;
}

async function sendViaSendGrid(to: string, cc: string|undefined, subject: string, body: string) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return false;
  const payload: Record<string, unknown> = {
    personalizations: [{ to: [{ email: to }], ...(cc && { cc: [{ email: cc }] }) }],
    from: { email: process.env.EMAIL_FROM || 'noreply@flowseer.internal' },
    subject, content: [{ type: 'text/plain', value: body }],
  };
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok || res.status === 202;
}

export async function POST(req: NextRequest) {
  const body    = await req.json();
  const ids     = body.rfq_ids === 'all' ? Object.keys(RFQ_EMAIL_TEMPLATES) : (body.rfq_ids as string[]);
  const dryRun  = body.dry_run ?? false;
  const hasMailgun  = Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
  const hasSendGrid = Boolean(process.env.SENDGRID_API_KEY);
  const method      = hasMailgun ? 'mailgun' : hasSendGrid ? 'sendgrid' : 'mailto_fallback';
  const results: Array<{rfq_id:string;to:string;status:string}> = [];

  for (const rfq_id of ids) {
    const tpl = RFQ_EMAIL_TEMPLATES[rfq_id];
    if (!tpl) { results.push({ rfq_id, to: '—', status: 'NOT_FOUND' }); continue; }
    if (dryRun) { results.push({ rfq_id, to: tpl.to, status: 'DRY_RUN' }); continue; }

    let sent = false;
    if (hasMailgun)       sent = await sendViaMailgun(tpl.to, tpl.cc, tpl.subject, tpl.body);
    else if (hasSendGrid) sent = await sendViaSendGrid(tpl.to, tpl.cc, tpl.subject, tpl.body);

    if (sent || method === 'mailto_fallback') {
      try {
        const rfqFile = join(process.cwd(), 'tools/rfq-generator/rfq_status.json');
        const data = JSON.parse(readFileSync(rfqFile, 'utf8'));
        const rfq  = data.rfqs.find((r: {id:string}) => r.id === rfq_id);
        if (rfq) { rfq.status = sent ? 'SENT' : 'DRAFTED'; rfq.sent_date = new Date().toISOString().split('T')[0]; }
        writeFileSync(rfqFile, JSON.stringify(data, null, 2));
      } catch { /* non-fatal */ }
      results.push({ rfq_id, to: tpl.to, status: sent ? 'SENT' : 'MAILTO_READY' });
    } else {
      results.push({ rfq_id, to: tpl.to, status: 'FAILED' });
    }
  }

  const mailto_links = method === 'mailto_fallback' ? ids.map(id => {
    const t = RFQ_EMAIL_TEMPLATES[id];
    if (!t) return null;
    return `${id}:mailto:${t.to}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
  }).filter(Boolean) : [];

  return NextResponse.json({
    success:      results.filter(r => r.status === 'FAILED').length === 0,
    dry_run:      dryRun, method,
    sent:         results.filter(r => r.status === 'SENT').length,
    results,      mailto_links,
  });
}

export async function GET() {
  return NextResponse.json({
    total: Object.keys(RFQ_EMAIL_TEMPLATES).length,
    send_date: '2026-05-25',
    days_until: Math.ceil((new Date('2026-05-25').getTime() - Date.now()) / 86_400_000),
    has_mailgun:  Boolean(process.env.MAILGUN_API_KEY),
    has_sendgrid: Boolean(process.env.SENDGRID_API_KEY),
    method: process.env.MAILGUN_API_KEY ? 'mailgun' : process.env.SENDGRID_API_KEY ? 'sendgrid' : 'mailto_fallback',
    templates: Object.entries(RFQ_EMAIL_TEMPLATES).map(([id, t]) => ({ rfq_id: id, to: t.to, company: t.company, category: t.category, value: t.value })),
  });
}
