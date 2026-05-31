import { NextResponse } from "next/server";
import { sendAlert } from "@/lib/notify";

/**
 * Alert wiring verification endpoint.
 *
 *   GET /api/alert-test            -> reports which alert env vars are present
 *                                     (masked) WITHOUT sending anything.
 *   GET /api/alert-test?send=true  -> fires one real test SMS (cooldown
 *                                     bypassed) so you can confirm delivery.
 *
 * Safe to hit anytime. Never exposes secret values — only whether they exist.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const doSend = url.searchParams.get("send") === "true";

  const config = {
    TWILIO_ACCOUNT_SID: !!(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    TWILIO_AUTH_TOKEN: !!(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    TWILIO_FROM: !!(process.env.TWILIO_FROM || "").trim(),
    ALERT_SMS_TO: !!(process.env.ALERT_SMS_TO || "").trim(),
  };
  const fullyConfigured = Object.values(config).every(Boolean);

  if (!doSend) {
    return NextResponse.json({
      configured: fullyConfigured,
      env_present: config,
      hint: fullyConfigured
        ? "All four set. Hit ?send=true to fire a test text."
        : "Set the missing vars in Vercel (or via /api/admin), then re-check.",
    });
  }

  if (!fullyConfigured) {
    return NextResponse.json(
      { sent: false, reason: "not_configured", env_present: config },
      { status: 400 }
    );
  }

  const result = await sendAlert(
    "test",
    "Test alert — your FlowSeer SMS alerting is wired up correctly. You'll get a text like this when a build breaks or the queue stalls.",
    { cooldownMinutes: 0 }
  );

  return NextResponse.json({ ...result, env_present: config });
}
