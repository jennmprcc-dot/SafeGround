/**
 * POST /api/sms/send { phone, to, body, emergency? } — admin-gated outbound
 * SMS via Twilio REST (plain fetch, Basic auth). Owner-approved 2026-09-08.
 *
 * Gates (all server-side, never client trust):
 *  - Caller must be an ACTIVE outreach_roster admin (outreachIdentity).
 *    staff_limited (Tracey) + non-roster → 403 with the calm line.
 *  - Recipient must have sms_consent AND not be unsubscribed → else a
 *    no-send result (never an error wall, never a send).
 *  - Business-hours rule for coordination sends; emergency=true bypasses
 *    hours only (consent/STOP never bypass).
 *  - Missing TWILIO_* env → calm 503, no stack, no leak.
 *
 * Env vars are read ONLY here, server-side — never the client bundle.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OUTREACH_CALM_LINE, callerFrom, outreachIdentity } from "~/lib/directoryServer";

async function send(c: { request: Request }) {
  let body: { phone?: unknown; to?: unknown; body?: unknown; emergency?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with to + body." }, { status: 400 });
  }
  const caller = callerFrom(c.request, body);
  const me = await outreachIdentity(caller);
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  const text = String(body.body ?? "").trim().slice(0, 1500);
  const to = String(body.to ?? "").replace(/[^0-9]/g, "").slice(0, 15);
  if (to.length < 10 || !text) {
    return Response.json(
      { ok: false, error: "A complete number and a short message first — no rush." },
      { status: 400 },
    );
  }
  // Lazy import: smsServer reads process.env secrets — keep it out of any
  // client bundle (2026-09-08 client-bundle-leak lesson).
  const { sendSms } = await import("~/lib/smsServer");
  const r = await sendSms(to, text, { emergency: body.emergency === true });
  if (r.ok) return Response.json({ ok: true, sent: true, sid: r.sid });
  if (r.reason === "configuration") {
    return Response.json({ ok: false, sent: false, reason: "configuration" }, { status: 503 });
  }
  return Response.json({ ok: true, sent: false, reason: r.reason });
}

export const Route = createFileRoute("/api/sms/send")({
  server: {
    handlers: {
      POST: send,
    },
  },
});
