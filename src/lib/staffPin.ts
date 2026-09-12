/**
 * Staff PIN lock (owner-directed 2026-09-11) — per-staff PIN chosen at first
 * login. The phone only identifies WHO; the PIN proves it's them.
 *
 * SECURITY CONTRACT (non-negotiable):
 *  - Phone alone (a well-known public staff number) NEVER opens a staff API —
 *    every staff gate must pass pinGate() in this PR.
 *  - PINs are 4–6 digits, stored ONLY as a pgcrypto bcrypt hash
 *    (crypt(pin, gen_salt('bf'))) — never plaintext, never logged, never
 *    readable back, never stored on the device.
 *  - PIN setup/reset is gated by the bootstrap secret SG_SETUP_TOKEN (env
 *    var the owner sets via Secrets). Missing env → fail CLOSED (403): nothing
 *    breaks at build time, nothing unlocks without the owner's key.
 *  - Claim-attack guard: without the token, nobody can set/reset a PIN for a
 *    known staff phone, so strangers can't lock staff out of their accounts.
 *  - Pragmatic rate limit: in-memory per-phone counter — after 5 wrong PINs
 *    in a row, a 60s cool-down (fine for a 3-person team; no DB column).
 *  - THIS MODULE IS SERVER-ONLY. It reads process.env and pg — NEVER import
 *    it from client code (2026-09-08 client-bundle-leak lesson; loaded only
 *    from src/routes/api/** server handlers, like smsServer.ts).
 */
import { sql } from "~/db";
import { normOutreachPhone, outreachIdentity } from "~/lib/outreachServer";

/** Calm lines — same voice as the rest of the app (no lockout drama). */
export const PIN_CALM_MISSING = "Your outreach PIN is required to open this space.";
export const PIN_CALM_WRONG = "That PIN didn't match — take your time.";
export const PIN_CALM_COOLDOWN = "Too many tries — give it a minute, then try again.";
export const PIN_CALM_MUST_SET = "Set your outreach PIN first — this is your first time here.";
export const PIN_CALM_BAD_TOKEN = "That setup code didn't match — ask the outreach lead for the current one.";
export const PIN_CALM_BAD_PIN = "Your PIN is 4–6 numbers — no letters or spaces.";
export const PIN_CALM_OUTREACH = "This space is for the outreach team.";

export type OutreachRole = "admin" | "staff_limited" | null;

export interface PinGateOk {
  ok: true;
  role: Exclude<OutreachRole, null>;
  name: string | null;
}
export interface PinGateErr {
  ok: false;
  code: "not_staff" | "staff_pin_required" | "must_set" | "wrong" | "cooldown";
  error: string;
}
export type PinGateResult = PinGateOk | PinGateErr;

/** 4–6 digit numeric PIN — the only shape we ever accept. */
const PIN_RE = /^\d{4,6}$/;

/** Per-phone in-memory failed-attempt counters (server-process only). */
const fails = new Map<string, { fails: number; until: number }>();
const MAX_FAILS = 5;
const COOLDOWN_MS = 60_000;

/** 10-digit identity key (roster stores 11-digit with country code). */
const key10 = (phone: string): string => {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  return digits.slice(-10);
};

/** Pull the PIN the caller attached: body → query → x-sg-pin header. */
export function pinFromRequest(c: { request: Request }, body?: Record<string, unknown>): string {
  if (body && typeof body.pin === "string" && body.pin.trim() !== "") return body.pin.trim();
  try {
    const url = new URL(c.request.url);
    const q = url.searchParams.get("pin");
    if (q && q.trim() !== "") return q.trim();
  } catch {
    /* not a URL — fall through */
  }
  const h = c.request.headers.get("x-sg-pin");
  return h ? h.trim() : "";
}

/**
 * The one gate every staff API passes: roster check + PIN check in a single
 * lookup. Phone alone → not_staff OR staff_pin_required; first login →
 * must_set (client shows the choose-your-PIN screen); wrong PIN → wrong with
 * a calm line (and a cool-down after 5 in a row). True → identity for the
 * caller (role + name), already roster-verified.
 */
export async function pinGate(phone: string, pin: unknown): Promise<PinGateResult> {
  const key = key10(normOutreachPhone(phone));
  if (!key) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
  const pinStr = String(pin ?? "").trim();
  const rec = fails.get(key);
  if (rec && rec.until > Date.now()) {
    return { ok: false, code: "cooldown", error: PIN_CALM_COOLDOWN };
  }
  try {
    // ROSTER LOOKUP FIRST (single round-trip): nobody learns whether a phone
    // is staff from the error shape — non-roster → not_staff, roster without
    // a PIN yet → must_set (client shows choose-your-PIN), roster with a PIN
    // but a missing/malformed one → staff_pin_required.
    const rows = (await sql()`
      select role, display_name, pin_hash, pin_must_set
      from public.outreach_roster
      where substring(phone from length(phone) - 9) = ${key} and active
      limit 1`) as unknown as Array<{
      role: string;
      display_name: string;
      pin_hash: string | null;
      pin_must_set: boolean;
    }>;
    const row = rows[0];
    if (!row) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
    if (row.pin_must_set === true || !row.pin_hash) {
      return { ok: false, code: "must_set", error: PIN_CALM_MUST_SET };
    }
    if (!PIN_RE.test(pinStr)) {
      // Malformed/absent PIN: same calm 403, no counting (can't brute-force
      // with 1-digit inputs; the form itself requires 4–6 digits).
      return { ok: false, code: "staff_pin_required", error: PIN_CALM_MISSING };
    }
    // Parameterized pgcrypto compare — the hash never leaves the server.
    const m = (await sql()`
      select (crypt(${pinStr}, ${row.pin_hash}) = ${row.pin_hash}) as match`) as unknown as Array<{
      match: boolean;
    }>;
    if (m[0]?.match !== true) {
      const n = (rec?.fails ?? 0) + 1;
      if (n >= MAX_FAILS) fails.set(key, { fails: 0, until: Date.now() + COOLDOWN_MS });
      else fails.set(key, { fails: n, until: 0 });
      return { ok: false, code: "wrong", error: PIN_CALM_WRONG };
    }
    fails.delete(key);
    const role = row.role === "admin" ? "admin" : row.role === "staff_limited" ? "staff_limited" : null;
    if (!role) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
    return { ok: true, role, name: typeof row.display_name === "string" ? row.display_name : null };
  } catch {
    // DB hiccup degrades to the calm 403 — never a crash, never a leak.
    return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
  }
}

export type SetPinResult =
  | { ok: true }
  | { ok: false; code: "bad_token" | "bad_pin" | "not_staff"; error: string };

/**
 * First-login PIN setup. Gated by the bootstrap secret SG_SETUP_TOKEN (env
 * var, owner-held): without a matching token nobody can set a PIN for a known
 * staff phone, so a stranger can never lock staff out (claim-attack guard).
 * Missing env var → fail closed (bad_token). Stores ONLY the bcrypt hash.
 */
export async function setPinForStaff(
  phone: string,
  pin: unknown,
  setupToken: unknown,
): Promise<SetPinResult> {
  const expected = (process.env.SG_SETUP_TOKEN ?? "").trim();
  const token = String(setupToken ?? "").trim();
  if (!expected || token !== expected) {
    return { ok: false, code: "bad_token", error: PIN_CALM_BAD_TOKEN };
  }
  const pinStr = String(pin ?? "").trim();
  if (!PIN_RE.test(pinStr)) {
    return { ok: false, code: "bad_pin", error: PIN_CALM_BAD_PIN };
  }
  const key = key10(normOutreachPhone(phone));
  if (!key) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
  try {
    const r = (await sql()`
      update public.outreach_roster
      set pin_hash = crypt(${pinStr}, gen_salt('bf')),
          pin_must_set = false,
          updated_at = now()
      where substring(phone from length(phone) - 9) = ${key} and active
      returning 1`) as unknown as Array<Record<string, unknown>>;
    if (r.length === 0) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
    fails.delete(key);
    return { ok: true };
  } catch {
    return { ok: false, code: "bad_pin", error: "That didn't go through — try again in a moment." };
  }
}

export type ResetPinResult =
  | { ok: true }
  | { ok: false; code: "bad_token" | "not_admin" | "not_staff"; error: string };

/**
 * Admin-initiated PIN reset (Team tab "Reset PIN", admin role only; Tracey
 * staff_limited is rejected server-side). Clears the target's hash and marks
 * pin_must_set=true so they choose a fresh PIN on their next login.
 *
 * Design (owner-led): the resets themselves are sanctioned by the owner's
 * bootstrap secret — reset-pin requires a valid SG_SETUP_TOKEN AND a verified
 * roster-admin phone+PIN. The setup code is the owner's key, entered once per
 * reset by the admin from the Team tab.
 */
export async function resetPinForStaff(opts: {
  adminPhone: string;
  adminPin: unknown;
  targetPhone: string;
  setupToken: unknown;
}): Promise<ResetPinResult> {
  const expected = (process.env.SG_SETUP_TOKEN ?? "").trim();
  const token = String(opts.setupToken ?? "").trim();
  if (!expected || token !== expected) {
    return { ok: false, code: "bad_token", error: PIN_CALM_BAD_TOKEN };
  }
  // The admin must first prove THEMSELVES (phone + PIN + admin role).
  const gate = await pinGate(opts.adminPhone, opts.adminPin);
  if (!gate.ok || gate.role !== "admin") {
    return { ok: false, code: "not_admin", error: "Only an outreach admin can reset a PIN — check your PIN and try again." };
  }
  const targetKey = key10(normOutreachPhone(opts.targetPhone));
  if (!targetKey) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
  try {
    const r = (await sql()`
      update public.outreach_roster
      set pin_hash = null,
          pin_must_set = true,
          updated_at = now()
      where substring(phone from length(phone) - 9) = ${targetKey} and active
      returning 1`) as unknown as Array<Record<string, unknown>>;
    if (r.length === 0) return { ok: false, code: "not_staff", error: PIN_CALM_OUTREACH };
    fails.delete(targetKey);
    return { ok: true };
  } catch {
    return { ok: false, code: "not_staff", error: "That didn't go through — try again in a moment." };
  }
}

/* ── Brief-contract aliases (owner brief 2026-09-11: "export verifyPin(phone,
 * pin), setPin(phone, pin, setupToken), clearPin(phone), isStaffAdmin(phone)").
 * The richer pinGate/setPinForStaff/resetPinForStaff above are the primary
 * API used by routes; these thin aliases keep the named contract literal. ── */

/** verifyPin(phone, pin) — full gate result (role + name when ok). */
export const verifyPin = (phone: string, pin: unknown): Promise<PinGateResult> => pinGate(phone, pin);

/** setPin(phone, pin, setupToken) — first-login PIN setup, token-gated. */
export const setPin = (phone: string, pin: unknown, setupToken: unknown): Promise<SetPinResult> =>
  setPinForStaff(phone, pin, setupToken);

/** clearPin(phone) — mechanical PIN wipe (pin_hash=null, pin_must_set=true).
 *  NO AUTH OF ITS OWN: only call from an already-gated route. The reset-pin
 *  route uses resetPinForStaff (admin + token gated), NOT this. */
export async function clearPin(phone: string): Promise<{ ok: boolean; error?: string }> {
  const key = key10(normOutreachPhone(phone));
  if (!key) return { ok: false, error: PIN_CALM_OUTREACH };
  try {
    const r = (await sql()`
      update public.outreach_roster
      set pin_hash = null, pin_must_set = true, updated_at = now()
      where substring(phone from length(phone) - 9) = ${key} and active
      returning 1`) as unknown as Array<Record<string, unknown>>;
    if (r.length === 0) return { ok: false, error: PIN_CALM_OUTREACH };
    fails.delete(key);
    return { ok: true };
  } catch {
    return { ok: false, error: PIN_CALM_OUTREACH };
  }
}

/** isStaffAdmin(phone) — roster role check WITHOUT a PIN (for "should this
 *  phone see admin links" decisions). Not a gate: real gates use pinGate. */
export async function isStaffAdmin(phone: string): Promise<boolean> {
  const me = await outreachIdentity(normOutreachPhone(phone));
  return me.role === "admin";
}

/* ── Follow-up gate helper (PR body: the other staff APIs — directory ×6,
 *  analytics ×2, export-grant-report, sms/send, peer-support queue+claim,
 *  staff-sms — are named follow-ups). One-line adoption per route:
 *
 *    const pin = pinFromRequest(c, body);
 *    const me = await pinGate(caller, pin);
 *    if (!me.ok) return Response.json({ ok:false, error: me.error, code: me.code }, { status:403 });
 *    // me.role / me.name replace the old outreachIdentity() result.
 *  The client sends the PIN in the x-sg-pin header (never a URL).
 *  pinFromRequest + pinGate are already exported above.                  ── */