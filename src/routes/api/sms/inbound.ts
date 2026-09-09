/**
 * POST /api/sms/inbound — Twilio inbound-SMS webhook (Reply STOP handling +
 * HELP auto-reply).
 *
 * Owner setup: in the Twilio console, set the phone number's Messaging webhook
 * to the LIVE base + this path, e.g.
 *   https://<live-host>/api/sms/inbound
 * (HTTP POST, default Twilio form encoding). Twilio posts form fields including
 * From + Body; when Body matches STOP / STOPALL / UNSUBSCRIBE / UNSUB / CANCEL
 * / QUIT (case-insensitive), that phone is marked unsubscribed in the consent
 * storage so the send route skips them. When Body is exactly HELP
 * (case-insensitive, trimmed), TwiML auto-replies with the MPRCC help message
 * (word-for-word the Help Message Sample from the owner's Twilio toll-free
 * verification form). Always returns a 2xx (TwiML) so Twilio never retries —
 * STOP/HELP handling must never 500.
 */
import { createFileRoute } from "@tanstack/react-router";

const STOP_RE = /^\s*(stop|stopall|unsubscribe|unsub|cancel|quit)\b/i;

const HELP_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  "<Response><Message>Reply HELP for assistance. An MPRCC peer support member " +
  "will respond during outreach hours (8am\u20136pm Mon-Fri). Texting is not a " +
  "substitute for calling 911 in an emergency.</Message></Response>";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

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
    if (bodyText.trim().toLowerCase() === "help") {
      return new Response(HELP_TWIML, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
  } catch {
    /* STOP/HELP handling must never 500 — Twilio retries on non-2xx. */
  }
  return new Response(EMPTY_TWIML, {
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
