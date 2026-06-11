/**
 * FlowSeer Alert Notifier — SMS via Twilio.
 *
 * Purpose: close the "silent failure" gap. The autonomous build loop and the
 * Deploy Sentinel can detect trouble, but until now they only wrote it to log
 * files nobody reads. This module actually reaches a human (Greg) by text.
 *
 * Design principles:
 *   - SAFE NO-OP when unconfigured. If the Twilio env vars are missing, every
 *     call returns { sent:false, reason:"not_configured" } and NEVER throws.
 *     This means it can ship dormant and activate the instant creds are set.
 *   - COOLDOWN DEDUPE. A persistent outage fires the cron hourly; without
 *     dedupe that would be an hourly text. Each alert `key` has a cooldown
 *     (default 6h) tracked in data/alert_state.json so you get one text, not
 *     twenty. State is read anonymously from the public repo and written back
 *     via /api/github-commit (the same path the rest of the pipeline uses).
 *   - BEST EFFORT. A failure to send an alert must never break the pipeline.
 *     Everything is wrapped; the worst case is a missed text, never a crash.
 *
 * Required env (set in Vercel, or via /api/admin):
 *   TWILIO_ACCOUNT_SID   - Twilio account SID (starts "AC...")
 *   TWILIO_AUTH_TOKEN    - Twilio auth token
 *   TWILIO_FROM          - Twilio sending number, E.164 (e.g. +15551230000)
 *   ALERT_SMS_TO         - destination cell, E.164 (e.g. +15557654321)
 */

const REPO_OWNER = "Buch5303";
const REPO_NAME = "ssc-v2";
const BRANCH = "main";
const STATE_PATH = "data/alert_state.json";

const DEFAULT_COOLDOWN_MIN = 360; // 6 hours
const MAX_SMS_LEN = 600;

export type ApiErrorKind =
  | "credit"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "other";

/**
 * Classify an upstream API error message so callers can decide whether a
 * failure is a persistent infra problem (credit/auth — page the human and
 * pause) or a transient blip (rate_limit/overloaded — back off, retry later).
 */
export function classifyApiError(msg?: string | null): ApiErrorKind {
  const m = (msg || "").toLowerCase();
  if (!m) return "other";
  if (m.includes("credit balance is too low") || m.includes("insufficient")) return "credit";
  if (
    m.includes("invalid x-api-key") ||
    m.includes("authentication") ||
    m.includes("invalid api key") ||
    m.includes("unauthorized") ||
    m.includes("permission")
  ) {
    return "auth";
  }
  if (m.includes("rate limit") || m.includes("rate_limit") || m.includes("429")) return "rate_limit";
  if (m.includes("overloaded") || m.includes("529")) return "overloaded";
  return "other";
}

interface AlertState {
  version: number;
  lastSent: Record<string, string>; // alert key -> ISO timestamp
}

async function loadState(): Promise<AlertState> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${STATE_PATH}`,
      { cache: "no-store" }
    );
    if (res.ok) {
      const parsed = (await res.json()) as AlertState;
      if (parsed && typeof parsed === "object" && parsed.lastSent) return parsed;
    }
  } catch {
    /* fall through to default */
  }
  return { version: 1, lastSent: {} };
}

async function saveState(state: AlertState, baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/github-commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": (process.env.CRON_SECRET || "").trim() },
      body: JSON.stringify({
        files: [{ path: STATE_PATH, content: JSON.stringify(state, null, 2) + "\n" }],
        message: "[alert] update notifier cooldown state",
      }),
    });
  } catch {
    /* best effort — a missed state write only risks one duplicate text */
  }
}

async function sendSms(body: string): Promise<{ sent: boolean; reason?: string }> {
  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = (process.env.TWILIO_FROM || "").trim();
  const to = (process.env.ALERT_SMS_TO || "").trim();

  if (!sid || !token || !from || !to) {
    return { sent: false, reason: "not_configured" };
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const form = new URLSearchParams({ To: to, From: from, Body: body.slice(0, MAX_SMS_LEN) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (res.ok) return { sent: true };
    const errBody = await res.text().catch(() => "");
    return { sent: false, reason: `twilio ${res.status}: ${errBody.slice(0, 160)}` };
  } catch (e: any) {
    return { sent: false, reason: e?.message || "twilio exception" };
  }
}

export interface SendAlertOptions {
  /** Base URL of the deployment, needed to persist cooldown state. */
  baseUrl?: string;
  /** Minutes before the same key can fire again. 0 disables dedupe. */
  cooldownMinutes?: number;
}

/**
 * Send an SMS alert, subject to per-key cooldown.
 *
 * @param key      Stable identifier for the alert type (e.g. "infra_credit").
 *                 Cooldown is tracked per key.
 * @param message  Human-readable body. Prefixed with "FlowSeer ALERT:".
 */
export async function sendAlert(
  key: string,
  message: string,
  opts: SendAlertOptions = {}
): Promise<{ sent: boolean; reason?: string }> {
  const cooldownMin = opts.cooldownMinutes ?? DEFAULT_COOLDOWN_MIN;

  try {
    // Cheap config gate first — if Twilio isn't set up, skip everything
    // (including the state read/write) so dormant deployments stay quiet.
    if (
      !(process.env.TWILIO_ACCOUNT_SID || "").trim() ||
      !(process.env.ALERT_SMS_TO || "").trim()
    ) {
      return { sent: false, reason: "not_configured" };
    }

    let state: AlertState | null = null;
    if (cooldownMin > 0) {
      state = await loadState();
      const last = state.lastSent[key];
      if (last) {
        const elapsedMin = (Date.now() - Date.parse(last)) / 60000;
        if (!Number.isNaN(elapsedMin) && elapsedMin < cooldownMin) {
          return { sent: false, reason: `cooldown (${Math.round(cooldownMin - elapsedMin)}m left)` };
        }
      }
    }

    const result = await sendSms(`FlowSeer ALERT: ${message}`);

    if (result.sent && cooldownMin > 0 && opts.baseUrl) {
      state = state || (await loadState());
      state.lastSent[key] = new Date().toISOString();
      await saveState(state, opts.baseUrl);
    }
    return result;
  } catch (e: any) {
    return { sent: false, reason: e?.message || "sendAlert exception" };
  }
}
