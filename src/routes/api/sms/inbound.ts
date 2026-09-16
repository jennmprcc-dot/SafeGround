/**
 * POST /api/sms/inbound — Twilio inbound-SMS webhook (Reply STOP handling +
 * HELP auto-reply + peer-text reply routing).
 *
 * Owner setup: in the Twilio console, set the phone number's Messaging webhook
 * to the LIVE base + this path, e.g.
 *   https://<live-host>/api/sms/inbound
 * (HTTP POST, default Twilio form encoding). Twilio posts form fields including
 * From + Body; when Body matches STOP / STOPALL / UNSUBSCRIBE / UNSUB / CANCEL
 * / QUIT (case-insensitive), that phone is marked unsubscribed in the consent
 * storage so the send route skips them — and the message is NEVER routed as a
 * peer reply. When Body is exactly HELP (case-insensitive, trimmed), TwiML
 * auto-replies with the MPRCC help message (word-for-word the Help Message
 * Sample from the owner's Twilio toll-free verification form).
 *
 * REPLY ROUTING (goal 2026-09-16, spec §A9.4): any other non-empty message
 * from a phone that received a peer text in the last 7 days is appended to
 * that thread as a one-to-one reply to the ORIGINAL SENDER ONLY — never a
 * group re-broadcast. The sender gets a push + (gated by the sender's own SMS
 * consent + business hours) an SMS echo. STOP/HELP are handled first and never
 * routed. Always returns a 2xx (TwiML) so Twilio never retries.
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
      // STOP is an unsubscribe, never a reply — return before reply routing.
      return new Response(EMPTY_TWIML, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    if (bodyText.trim().toLowerCase() === "help") {
      return new Response(HELP_TWIML, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    // Peer-text reply routing: any other non-empty message from a phone that
    // received a peer text in the last 7 days echoes to the ORIGINAL SENDER
    // ONLY (never a group broadcast). Best-effort; Twilio always gets 2xx.
    if (from && bodyText.trim()) {
      try {
        const { routePeerReply } = await import("~/lib/peerMessageServer");
        await routePeerReply(from, bodyText);
      } catch {
        /* reply routing must never 500 — Twilio retries on non-2xx */
      }
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
