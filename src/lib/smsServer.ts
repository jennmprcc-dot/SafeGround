/**
 * Server-only SMS helpers (Twilio REST via plain fetch — no SDK, no platform
 * plan upgrade). NEVER import this module from client code: it reads secrets
 * from process.env (2026-09-08 client-bundle-leak lesson) and is loaded only
 * from src/routes/api/** server handlers.
 *
 * Owner-approved 2026-09-08. Floor rules, enforced server-side:
 *  - Opt-in only: sms_consent must be true AND sms_unsubscribed false.
 *  - Business hours (America/Los_Angeles, Mon–Fri 8:00–18:00) for group /
 *    coordination sends UNLESS the recipient consents_to_after_hours —
 *    EXCEPT true emergency dispatch (emergency=true), which sends regardless.
 *  - Reply STOP always honored (see src/routes/api/sms/inbound.ts).
 *  - Analytics: aggregate counters only, zero PII — this module never logs
 *    phone numbers anywhere.
 */
import { sql } from "~/db";

/** Calm line shown when SMS isn't wired — no stack, no leak. */
export const SMS_NOT_CONFIGURED = "Texting isn't set up yet — the notice still went out by app notification.";

export interface SmsConfig {
  sid: string;
  token: string;
  from: string;
}
export function smsConfig(): SmsConfig | null {
  const sid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from = (process.env.TWILIO_FROM_NUMBER ?? "").trim();
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

/** Marin-local business hours: Mon–Fri 8am–6pm. */
export function inBusinessHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hr = parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1", 10);
  const weekday = wd !== "Sat" && wd !== "Sun";
  return weekday && hr >= 8 && hr < 18;
}

export const digitsOnly = (raw: unknown): string => String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 15);
/**
 * E.164 for US numbers, hardened against pre-URL-encoded input (defense in
 * depth: a pasted `%2B1415…` value reached Twilio as a literal and was
 * rejected with 21211 — that class of malformed `To` must never be sent).
 *  - Trims, decodes a leading %2B (possibly repeated, e.g. %252B), trims again.
 *  - 10 digits → +1… ; 11 digits starting with 1 → +… ; anything else → "".
 * Callers treat "" as invalid and must NOT call Twilio.
 */
export function toE164(raw: string): string {
  let s = String(raw ?? "").trim();
  // Unwrap pre-URL-encoded input (e.g. "%2B1415…" or double-encoded
  // "%252B1415…") so a pasted encoded value can never reach Twilio literally.
  for (let i = 0; i < 3 && s.startsWith("%"); i++) {
    try {
      const next = decodeURIComponent(s).trim();
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  const d = s.replace(/[^0-9]/g, "").slice(0, 15);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return "";
}

export interface SmsConsent {
  sms: boolean;
  afterHours: boolean;
}
/**
 * Consent check for one phone across BOTH consent stores (HomeTeam members +
 * neighbor notice_consents). Graceful when the sms columns don't exist yet
 * (pre-migration DB → try/catch treats it as no consent and callers no-send).
 * Unsubscribed always wins over consent.
 */
export async function smsConsentFor(phoneDigits: string): Promise<SmsConsent> {
  const key = digitsOnly(phoneDigits).slice(-10);
  if (!key) return { sms: false, afterHours: false };
  return smsConsentSimple(key);
}

/** Plain two-lookup consent check. Pre-migration safe by try/catch: on a DB
 * without the sms_* columns the static query raises unknown-column, we catch,
 * and the caller gets { sms:false } → a no-send result (never a crash). */
async function smsConsentSimple(key10: string): Promise<SmsConsent> {
  let sms = false;
  let afterHours = false;
  try {
    const ht = (await sql()`
      select sms_consent as sms_ok,
             not sms_unsubscribed as not_stopped,
             consents_to_after_hours as ah
      from public.hometeam_members
      where substring(phone from length(phone) - 9) = ${key10}
        and status = 'active'
      limit 1`) as unknown as Array<{ sms_ok: boolean; not_stopped: boolean; ah: boolean }>;
    const row = ht[0];
    if (row?.sms_ok && row.not_stopped) {
      sms = true;
      afterHours = Boolean(row.ah);
    }
  } catch {
    /* pre-migration or unreachable DB → no SMS consent */
  }
  if (!sms) {
    try {
      const nc = (await sql()`
        select
          sms_consent as sms_ok,
          not sms_unsubscribed as not_stopped,
          consents_to_after_hours as ah
        from public.notice_consents
        where substring(phone from length(phone) - 9) = ${key10}
        limit 1`) as unknown as Array<{ sms_ok: boolean; not_stopped: boolean; ah: boolean }>;
      const row = nc[0];
      if (row?.sms_ok && row.not_stopped) {
        sms = true;
        afterHours = Boolean(row.ah);
      }
    } catch {
      /* pre-migration or unreachable DB → no SMS consent */
    }
  }
  return { sms, afterHours };
}

export type SmsGate =
  | { send: true }
  | { send: false; reason: "no_consent" | "after_hours" | "configuration" };

/**
 * Should this phone get this SMS now? Consent + STOP + hours in one call.
 * emergency=true bypasses the hours gate (true emergency dispatch only —
 * peer-support delegation to staff, urgent-need). Consent/STOP never bypass.
 */
export async function gateSms(
  phoneDigits: string,
  opts?: { emergency?: boolean; now?: Date },
): Promise<SmsGate> {
  if (!smsConfig()) return { send: false, reason: "configuration" };
  const consent = await smsConsentFor(phoneDigits);
  if (!consent.sms) return { send: false, reason: "no_consent" };
  if (!opts?.emergency && !consent.afterHours && !inBusinessHours(opts?.now)) {
    return { send: false, reason: "after_hours" };
  }
  return { send: true };
}

/**
 * Mark a phone unsubscribed in BOTH consent stores (idempotent, never throws).
 * Column-existence guarded: on a pre-migration DB this is a silent no-op.
 */
export async function markSmsUnsubscribed(phoneDigits: string): Promise<void> {
  const digits = digitsOnly(phoneDigits);
  if (!digits) return;
  const key = digits.slice(-10);
  try {
    await sql()`
      update public.hometeam_members set sms_unsubscribed = true
      where substring(phone from length(phone) - 9) = ${key}
        and exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='hometeam_members'
                    and column_name='sms_unsubscribed')`;
  } catch {
    /* best-effort — STOP must never 500 */
  }
  try {
    await sql()`
      update public.notice_consents set sms_unsubscribed = true
      where substring(phone from length(phone) - 9) = ${key}
        and exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='notice_consents'
                    and column_name='sms_unsubscribed')`;
  } catch {
    /* best-effort — STOP must never 500 */
  }
}

export interface SmsSendResult {
  ok: boolean;
  /** Twilio message SID when actually sent. */
  sid: string | null;
  /** Why nothing was sent (calm, no leak). */
  reason: string | null;
}

/**
 * Send one SMS via Twilio REST (plain fetch, Basic auth). Server-only.
 * Gate FIRST (consent/STOP/hours via gateSms), config second, send last.
 * Returns a no-send result instead of throwing; never logs the phone number.
 */
export async function sendSms(
  toDigits: string,
  body: string,
  opts?: { emergency?: boolean },
): Promise<SmsSendResult> {
  const text = String(body ?? "").trim().slice(0, 1500);
  if (!text) return { ok: false, sid: null, reason: "empty" };
  const gate = await gateSms(toDigits, { emergency: opts?.emergency });
  if (!gate.send) return { ok: false, sid: null, reason: gate.reason };
  const cfg = smsConfig();
  if (!cfg) return { ok: false, sid: null, reason: "configuration" };
  const to = toE164(toDigits);
  if (!to) return { ok: false, sid: null, reason: "invalid_phone" };
  try {
    const creds = Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: cfg.from, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      return { ok: false, sid: null, reason: "send_failed" };
    }
    const data = (await res.json().catch(() => null)) as { sid?: string } | null;
    return { ok: true, sid: typeof data?.sid === "string" ? data.sid : null, reason: null };
  } catch {
    return { ok: false, sid: null, reason: "send_failed" };
  }
}
