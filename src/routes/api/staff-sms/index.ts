/**
 * Admin API for the staff SMS dispatch list (owner-directed 2026-09-10).
 *
 * GET  /api/staff-sms?phone=…      — list recipients. Admin-only. Returns NAME
 *                                    + MASKED phone (last 4 digits ONLY — a full
 *                                    phone never leaves the server for this
 *                                    payload) + consent/STOP/active flags.
 * POST /api/staff-sms              — add/replace { phone, name, smsConsent?,
 *                                    afterHours? } (upsert by last-10 digits,
 *                                    idempotent; defaults consent true), or
 *                                    disable { phone, active: false } (soft
 *                                    remove — the row stays for STOP integrity).
 *                                    Admin-only.
 *
 * Gates (all server-side, never client trust):
 *  - Caller must be an ACTIVE outreach_roster admin (outreachIdentity).
 *    staff_limited (Tracey) + non-roster → 403 with the calm line.
 *  - Phone normalized to an 11-digit E.164-ish digit string (10-digit input
 *    gets the leading 1) — the same stored form as outreach_roster.
 *  - sms_unsubscribed (Reply STOP) is NEVER cleared by the upsert: STOP always
 *    wins. A stopped recipient stays stopped until consent comes from their own
 *    side; the admin UI shows the STOP chip instead.
 *  - Never logs phone numbers; the list payload only ever carries the last 4
 *    digits as a masked display form.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  OUTREACH_CALM_LINE,
  callerFrom,
  outreachIdentity,
} from "~/lib/directoryServer";

/** E.164-ish digit string, 11-digit with country code (1…): 10-digit input
 * gets the leading 1; 11 digits starting with 1 pass through. Empty on
 * anything else (callers treat "" as invalid). */
function normalizeStaffPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 15);
  if (digits.length === 10) return "1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return "";
}

/** Mask a stored phone to a display form showing only the last 4 digits. */
function maskPhone(phone: string): string {
  const tail = phone.slice(-4);
  return `•••• ${tail}`;
}

interface RecipientRow {
  id: string;
  name: string;
  phone: string;
  sms_consent: boolean;
  consents_to_after_hours: boolean;
  sms_unsubscribed: boolean;
  active: boolean;
}

function toRecipientPayload(r: RecipientRow) {
  return {
    id: r.id,
    name: r.name,
    phoneTail: r.phone.slice(-4),
    maskedPhone: maskPhone(r.phone),
    smsConsent: Boolean(r.sms_consent),
    afterHours: Boolean(r.consents_to_after_hours),
    smsUnsubscribed: Boolean(r.sms_unsubscribed),
    active: Boolean(r.active),
  };
}

async function listRecipients(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = callerFrom(c.request, {
    phone: url.searchParams.get("phone"),
  });
  const me = await outreachIdentity(caller);
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  try {
    const rows = (await sql()`
      select id, name, phone,
             sms_consent, consents_to_after_hours, sms_unsubscribed, active
      from public.staff_sms_recipients
      order by active desc, name`) as unknown as RecipientRow[];
    return Response.json({
      ok: true,
      recipients: rows.map(toRecipientPayload),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the dispatch list — try again in a moment." },
      { status: 503 },
    );
  }
}

async function upsertRecipient(c: { request: Request }) {
  let body: {
    phone?: unknown;
    name?: unknown;
    smsConsent?: unknown;
    afterHours?: unknown;
    active?: unknown;
    id?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body with phone + name." },
      { status: 400 },
    );
  }
  // Caller identity NEVER comes from the body (body.phone is the recipient):
  // it travels via ?phone= or the x-sg-phone header, same as the directory
  // routes. Otherwise the admin gate would read the recipient's number.
  const url = new URL(c.request.url);
  const caller = callerFrom(c.request, { phone: url.searchParams.get("phone") });
  const me = await outreachIdentity(caller);
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  // Disable path (spec: "DELETE or {active:false}"): soft remove by row id —
  // the list payload never carries full phones, so the UI disables by id; the
  // row is kept (STOP integrity, history).
  if (body.active === false) {
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
    if (!id) {
      return Response.json(
        { ok: false, error: "Which person should we remove? The list is the source." },
        { status: 400 },
      );
    }
    try {
      await sql()`
        update public.staff_sms_recipients
        set active = false, updated_at = now()
        where id = ${id}::uuid`;
      return Response.json({ ok: true, disabled: true });
    } catch {
      return Response.json(
        { ok: false, error: "That didn't go through — nothing changed." },
        { status: 503 },
      );
    }
  }
  const phone = normalizeStaffPhone(body.phone);
  if (!phone) {
    return Response.json(
      { ok: false, error: "That number looks incomplete — a US number needs 10–11 digits, no rush." },
      { status: 400 },
    );
  }
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (name.length < 1) {
    return Response.json(
      { ok: false, error: "Give the peer supporter a name so the list stays clear (1–40 characters)." },
      { status: 400 },
    );
  }
  // Add/replace path: upsert by last-10 digits, idempotent. Defaults: consent
  // true + after-hours true (staff are on call). sms_unsubscribed is NEVER
  // touched — a Reply STOP stays in force until the recipient's own side
  // changes it (STOP always wins).
  const smsConsent = body.smsConsent !== false;
  const afterHours = body.afterHours !== false;
  try {
    const key10 = phone.slice(-10);
    const existing = (await sql()`
      select id from public.staff_sms_recipients
      where substring(phone from length(phone) - 9) = ${key10}
      limit 1`) as unknown as Array<{ id: string }>;
    let row: { id: string; phone: string };
    if (existing[0]) {
      const updated = (await sql()`
        update public.staff_sms_recipients
        set name = ${name},
            sms_consent = ${smsConsent},
            consents_to_after_hours = ${afterHours},
            active = true,
            updated_at = now()
        where id = ${existing[0].id}
        returning id, phone`) as unknown as Array<{ id: string; phone: string }>;
      row = updated[0];
    } else {
      const inserted = (await sql()`
        insert into public.staff_sms_recipients
          (phone, name, sms_consent, consents_to_after_hours, active)
        values (${phone}, ${name}, ${smsConsent}, ${afterHours}, true)
        returning id, phone`) as unknown as Array<{ id: string; phone: string }>;
      row = inserted[0];
    }
    if (!row) {
      return Response.json(
        { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
        { status: 503 },
      );
    }
    const fresh = (await sql()`
      select id, name, phone,
             sms_consent, consents_to_after_hours, sms_unsubscribed, active
      from public.staff_sms_recipients where id = ${row.id}
      limit 1`) as unknown as RecipientRow[];
    return Response.json({
      ok: true,
      saved: true,
      recipient: fresh[0] ? toRecipientPayload(fresh[0]) : null,
    });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/staff-sms/")({
  server: {
    handlers: {
      GET: listRecipients,
      POST: upsertRecipient,
    },
  },
});