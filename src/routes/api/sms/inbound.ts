/**
 * POST /api/sms/inbound — Twilio inbound-SMS webhook (Reply STOP handling).
 *
 * Owner setup: in the Twilio console, set the phone number's Messaging webhook
 * to the LIVE base + this path, e.g.
 *   https://<live-host>/api/sms/inbound
 * (HTTP POST, default Twilio form encoding). Twilio posts form fields including
 * From + Body; when Body matches STOP / STOPALL / UNSUBSCRIBE / UNSUB / CANCEL
 * / QUIT (case-insensitive), that phone is marked unsubscribed in the consent
 * storage so the send route skips them. Always returns a 2xx (empty TwiML)
 * so Twilio never retries — STOP handling must never 500.
 */
import { createFileRoute } from "@tanstack/react-router";

const STOP_RE = /^\s*(stop|stopall|unsubscribe|unsub|cancel|quit)\b/i;

async function inbound(c: { request: Request }) {
  try {
    const ct = c.request.headers.get("content-type") ?? "";
    let from = "";
    let bodyText = "";
    if (ct.includes("application/json")) {
      const j = (await c.request.json().catch(() => null)) as { From?: unknown; Body?: unknown } | null;
      from = String(j?.From ?? "");
      bodyText = String(j?.Body ?? "");
    } else {
      const form = await c.request.formData();
      from = String(form.get("From") ?? "");
      bodyText = String(form.get("Body") ?? "");
    }
    if (from && STOP_RE.test(bodyText)) {
      // Lazy import keeps smsServer (process.env secrets) server-only.
      const { markSmsUnsubscribed } = await import("~/lib/smsServer");
      await markSmsUnsubscribed(from);
    }
  } catch {
    /* STOP handling must never 500 — Twilio retries on non-2xx. */
  }
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export const Route = createFileRoute("/api/sms/inbound")({
  server: {
    handlers: {
      POST: inbound,
    },
  },
});
