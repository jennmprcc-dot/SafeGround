/**
 * Pass 3 — Volunteer flow: shared SERVER helpers (owner-directed 2026-09-12,
 * Part B). Mirrors donationServer.ts: submit is open (anonymous app), queue
 * reads + mark-contacted are roster-gated (admin OR staff_limited via
 * outreachIdentity), push fan-out goes ONLY to active roster admins with ZERO
 * contact digits in the message, analytics is zero-PII on submit only.
 *
 * Server-only module (imports ~/db + pushServer). Client code imports the
 * route constants from ~/lib/volunteer.ts (or inline paths) — never this.
 */
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { outreachIdentity } from "~/lib/outreachServer";
import {
  PEER_SUPPORT_ADMIN_PHONES,
  sendFcmMessage,
  tokensForPhone,
} from "~/lib/pushServer";

export const VOLUNTEER_CALM_403 = "This space is for the outreach team.";

/** Graceful table check — true when volunteer_signups exists. Never throws. */
export async function volunteerTableReady(): Promise<boolean> {
  try {
    const rows = (await sql()`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'volunteer_signups'
      limit 1`) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Is this phone an ACTIVE outreach-roster member (admin OR staff_limited)?
 * Server-side gate — never client trust. Degrades gracefully → false. */
export async function isVolunteerStaff(phone: string): Promise<boolean> {
  const p = normPhone(phone);
  if (!p) return false;
  try {
    return (await outreachIdentity(p)).role !== null;
  } catch {
    return false;
  }
}

/** Staff queue gate helper — calm 403 when the caller isn't on the roster. */
export async function volunteerGateOr403(
  caller: string,
): Promise<Response | null> {
  if (!(await isVolunteerStaff(caller))) {
    return Response.json({ ok: false, error: VOLUNTEER_CALM_403 }, { status: 403 });
  }
  return null;
}

const str = (raw: unknown, max: number): string =>
  String(raw ?? "").trim().slice(0, max);

/** Contact must be a phone (≥10 digits after normalization) OR an email
 * (contains "@" + at least one dot after it). Either way it reaches staff. */
export function looksLikeContact(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (v.includes("@")) {
    const at = v.indexOf("@");
    return at > 0 && v.indexOf(".", at) > at + 1 && v.length <= 120;
  }
  return normPhone(v).length >= 10;
}

export interface ValidatedVolunteer {
  name: string | null;
  contact: string;
  interestNote: string | null;
}

export function validateVolunteerInput(body: Record<string, unknown>):
  | { ok: true; data: ValidatedVolunteer }
  | { ok: false; error: string; field?: string } {
  const contact = str(body.contact, 120);
  if (!looksLikeContact(contact)) {
    return {
      ok: false,
      error: "A phone number or email is needed so the team can reach you.",
      field: "contact",
    };
  }
  return {
    ok: true,
    data: {
      name: str(body.name, 80) || null,
      contact,
      interestNote: str(body.interestNote, 500) || null,
    },
  };
}

/* ── Push fan-out: ONLY active roster admins' FCM tokens ────────────
 * Same shape as fanOutDonationAdmins; the submitter is never a target and
 * title/body carry ZERO contact digits (never the phone/email). Best-effort
 * per token — a push failure never fails the submit. */
export async function fanOutVolunteerAdmins(
  nameOrVolunteer: string,
  snippet: string,
): Promise<{ notifiedPhones: number; tokensSent: number }> {
  const title = "New volunteer interest";
  const short = snippet.length > 70 ? `${snippet.slice(0, 67)}…` : snippet;
  const body = `${nameOrVolunteer}${short ? ` — ${short}` : ""}`.slice(0, 120);
  const link = "/outreach?tab=volunteers";
  let notifiedPhones = 0;
  let tokensSent = 0;
  for (const adminPhone of PEER_SUPPORT_ADMIN_PHONES) {
    let tokens: string[] = [];
    try {
      tokens = await tokensForPhone(adminPhone);
    } catch {
      continue;
    }
    if (tokens.length === 0) continue;
    notifiedPhones += 1;
    for (const token of tokens) {
      try {
        const r = await sendFcmMessage({ token, title, body, link });
        if (r.status === "sent") tokensSent += 1;
      } catch {
        /* best-effort per token */
      }
    }
  }
  return { notifiedPhones, tokensSent };
}

/* ── Queue row shape (snake_case → camelCase JSON) ───────────────── */
export interface VolunteerRow {
  id: string;
  name: string | null;
  contact: string;
  interestNote: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function mapVolunteerRow(r: Record<string, unknown>): VolunteerRow {
  return {
    id: String(r.id),
    name: r.name == null ? null : String(r.name),
    contact: String(r.contact),
    interestNote: r.interest_note == null ? null : String(r.interest_note),
    status: String(r.status),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}