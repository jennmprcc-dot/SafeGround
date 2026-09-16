/**
 * Pass 2 — Donation Dispatch: shared SERVER helpers (owner-directed 2026-09-12).
 *
 * SAFETY CONTRACT (non-negotiable, mirrors peer-support + outreach):
 *  - Public submit paths never read the queue; staff queue paths never read
 *    without a roster gate. Gate = outreach_roster (active) role admin OR
 *    staff_limited — both may view + claim/complete (staff_limited consistent
 *    with the existing plan). No delete path exists.
 *  - The caller's phone is captured server-side (body.staffPhone / ?phone= /
 *    x-sg-phone) and normalized; claimed_by_phone is ALWAYS set from that gated
 *    caller — never from a body field or client trust.
 *  - Push fan-out goes ONLY to active roster admins' registered FCM tokens
 *    (the two admin phones in PEER_SUPPORT_ADMIN_PHONES — Jenn + Bambi), with
 *    ZERO phone digits in title/body. Never 911, never SMS (SMS is a later
 *    wave — not in this PR), never the submitter themself.
 *  - Analytics: zero-PII through the existing boundary (category/status only —
 *    never phone, address, or photo). Logging never fails a submit.
 *  - Gates degrade gracefully (try/catch → no role) — a missing roster table
 *    never crashes anything, it renders the calm 403.
 *
 * This module is server-only (imports ~/db, pushServer). Client code imports
 * ~/lib/donation.ts (pure constants) — never this file.
 */
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { outreachIdentity } from "~/lib/outreachServer";
import {
  PEER_SUPPORT_ADMIN_PHONES,
  phoneKey,
  sendFcmMessage,
  tokensForPhone,
} from "~/lib/pushServer";
import { gateSms, sendSms } from "~/lib/smsServer";
import {
  DONATION_DAY_LABEL,
  DONATION_PING_COPY,
  DONATION_PUSH_LINKS,
  DONATION_REQUESTER_LINK,
  isDonationCategory,
  isOfferPath,
  isPickupOrDelivery,
} from "~/lib/donation";

export type DonationTableName = "donation_offers" | "donation_requests";

/** Calm 403 copy — same voice as the peer-support queue. */
export const DONATION_CALM_403 = "This space is for the outreach team.";

export const DONATION_MISSING_TABLE_MSG = (
  table: DonationTableName,
): string =>
  `The donation ${table === "donation_offers" ? "offers" : "requests"} queue isn't live yet — the next database update adds it. Please reach out to the MPRCC team directly for now.`;

/** Graceful table check — true when the given table exists. Never throws. */
export async function donationTableReady(table: DonationTableName): Promise<boolean> {
  try {
    const rows = (await sql()`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${table}
      limit 1`) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Is this phone an ACTIVE outreach-roster member (admin OR staff_limited)?
 * Server-side gate — never client trust. Degrades gracefully → false. */
export async function isDonationStaff(phone: string): Promise<boolean> {
  const p = normPhone(phone);
  if (!p) return false;
  try {
    return (await outreachIdentity(p)).role !== null;
  } catch {
    return false;
  }
}

/* ── Submit validators (pure — no DB) ────────────────────────────────
 * Each returns { ok: true, data } or { ok: false, error } with a calm,
 * human-readable string the UI can show under the offending field. */

export interface ValidatedOffer {
  path: string;
  itemDescription: string;
  category: string;
  conditionNote: string | null;
  quantity: string | null;
  contactPhone: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressZip: string | null;
  approachNotes: string | null;
  pickupTimeWindow: string | null;
  photoB64: string | null;
}

const str = (raw: unknown, max: number): string =>
  String(raw ?? "").trim().slice(0, max);

export function validateOfferInput(body: Record<string, unknown>):
  | { ok: true; data: ValidatedOffer }
  | { ok: false; error: string; field?: string } {
  const path = str(body.path, 20).toLowerCase();
  if (!isOfferPath(path)) {
    return { ok: false, error: "Choose how you'd like to give: porch drop, scheduled pickup, or the MPRCC porch.", field: "path" };
  }
  const contactPhone = normPhone(body.contactPhone);
  if (contactPhone.length < 10) {
    return { ok: false, error: "A phone number is needed so the outreach team can reach you.", field: "contactPhone" };
  }
  const itemDescription = str(body.itemDescription, 300);
  if (!itemDescription) {
    return { ok: false, error: "What are you offering? A short description helps us match it.", field: "itemDescription" };
  }
  const category = str(body.category, 80);
  if (!isDonationCategory(category)) {
    return { ok: false, error: "Pick a category from the Always Accepting list.", field: "category" };
  }
  const conditionNote = str(body.conditionNote, 200) || null;
  const quantity = str(body.quantity, 60) || null;

  // Per-path required fields.
  let addressStreet: string | null = null;
  let addressCity: string | null = null;
  let addressZip: string | null = null;
  let approachNotes: string | null = null;
  let pickupTimeWindow: string | null = null;
  if (path === "porch_drop" || path === "scheduled_pickup") {
    addressStreet = str(body.addressStreet, 120);
    addressCity = str(body.addressCity, 60);
    addressZip = str(body.addressZip, 12);
    if (!addressStreet || !addressCity || !addressZip) {
      return { ok: false, error: "An address is needed so we know where the items are.", field: "addressStreet" };
    }
    if (path === "porch_drop") {
      approachNotes = str(body.approachNotes, 300) || null;
    } else {
      pickupTimeWindow = str(body.pickupTimeWindow, 120);
      if (!pickupTimeWindow) {
        return { ok: false, error: `When should the outreach team pick up? (e.g. ${"Mon Sep 21, 10am–2pm"})`, field: "pickupTimeWindow" };
      }
    }
  }
  // mprcc_porch: no address needed — the porch info is a constant (MPRCC_PORCH).
  const photoB64 = str(body.photoB64, 400_000) || null;
  if (photoB64 && path !== "porch_drop") {
    return { ok: false, error: "Photos are only for porch drop offers.", field: "photoB64" };
  }
  return {
    ok: true,
    data: {
      path,
      itemDescription,
      category,
      conditionNote,
      quantity,
      contactPhone,
      addressStreet,
      addressCity,
      addressZip,
      approachNotes,
      pickupTimeWindow,
      photoB64,
    },
  };
}

export interface ValidatedRequest {
  item: string;
  category: string;
  quantity: string | null;
  notes: string | null;
  size: string | null;
  pickupOrDelivery: string;
  contactPhone: string;
}

export function validateRequestInput(body: Record<string, unknown>):
  | { ok: true; data: ValidatedRequest }
  | { ok: false; error: string; field?: string } {
  const contactPhone = normPhone(body.contactPhone);
  if (contactPhone.length < 10) {
    return { ok: false, error: "A phone number is needed so the outreach team can reach you.", field: "contactPhone" };
  }
  const item = str(body.item, 200);
  if (!item) {
    return { ok: false, error: "What do you need? A short description helps us match it.", field: "item" };
  }
  const category = str(body.category, 80);
  if (!isDonationCategory(category)) {
    return { ok: false, error: "Pick a category from the Always Accepting list.", field: "category" };
  }
  const pickupOrDelivery = str(body.pickupOrDelivery, 12);
  if (!isPickupOrDelivery(pickupOrDelivery)) {
    return { ok: false, error: "Choose pickup, delivery, or either.", field: "pickupOrDelivery" };
  }
  return {
    ok: true,
    data: {
      item,
      category,
      quantity: str(body.quantity, 60) || null,
      notes: str(body.notes, 500) || null,
      size: str(body.size, 60) || null,
      pickupOrDelivery,
      contactPhone,
    },
  };
}

/* ── Push fan-out: ONLY active roster admins' FCM tokens ────────────
 * Same shape as peerSupportServer.fanOutToAdmins: iterate the two admin
 * phones, look up their registered tokens, send. The submitter is NEVER a
 * target; title/body carry ZERO phone digits. Best-effort per token — a push
 * failure never fails the submit. */
export async function fanOutDonationAdmins(
  kind: "offer" | "request",
  category: string,
  snippet: string,
): Promise<{ notifiedPhones: number; tokensSent: number }> {
  const title = kind === "offer" ? "New donation offer" : "New item request";
  const short = snippet.length > 70 ? `${snippet.slice(0, 67)}…` : snippet;
  const body = `${category} — ${short}`.slice(0, 120);
  const link =
    kind === "offer" ? DONATION_PUSH_LINKS.offers : DONATION_PUSH_LINKS.requests;
  let notifiedPhones = 0;
  let tokensSent = 0;
  for (const adminPhone of PEER_SUPPORT_ADMIN_PHONES) {
    let tokens: string[] = [];
    try {
      tokens = await tokensForPhone(adminPhone);
    } catch {
      continue; // push_tokens missing/unreachable — the row still persists
    }
    if (tokens.length === 0) continue;
    notifiedPhones += 1;
    for (const token of tokens) {
      try {
        const r = await sendFcmMessage({ token, title, body, link });
        if (r.status === "sent") tokensSent += 1;
      } catch {
        /* best-effort per token — never fails the submit */
      }
    }
  }
  return { notifiedPhones, tokensSent };
}

/* ── Requester ping (owner-directed 2026-09-16) ─────────────────────
 * Staff claim → "In route" → outcome. At each step the SUBMITTER (the row's
 * contact_phone) gets one calm heads-up:
 *   - PUSH to every device token they registered (tokensForPhone — the same
 *     fan-out the check-in peer pushes use; maybeRegisterPush on the device is
 *     what PUT those tokens there). Zero phone digits in title/body.
 *   - SMS ONLY through gateSms (sms_consent + not unsubscribed + business
 *     hours/after-hours consent). NEVER emergency:true — this is coordination,
 *     not a 911 path. No consent → no text, silently.
 * Best-effort everywhere: a store outage or a failed token never fails the
 * staff action that already landed. A 60s per-(row, kind) cooldown stops a
 * double-tap or a retry from texting twice, while still letting claim and
 * In route (different kinds) each send their own message.
 * --------------------------------------------------------------------- */

export type DonationPingKind = "claim" | "in_route" | "reschedule" | "not_in_supplies";

/** Push bodies are clipped — a notification is not a letter. The owner's "not
 *  in supplies right now" copy is the longest of the set (it explains WHY the
 *  wait is normal), so it gets a longer allowance and still never arrives as a
 *  half-chopped sentence. SMS always carries the full body. */
const PUSH_BODY_CAP: Record<DonationPingKind, number> = {
  claim: 140,
  in_route: 140,
  reschedule: 140,
  not_in_supplies: 200,
};

export interface DonationPingResult {
  kind: DonationPingKind;
  /** Device tokens we found for the submitter's phone (consent = their Allow). */
  pushTargets: number;
  /** Tokens FCM accepted. */
  pushSent: number;
  /** True when a text actually left for Twilio. */
  smsSent: boolean;
  /** Why no text: no_consent | after_hours | configuration | cooldown |
   *  invalid_phone | send_failed. Null when a text was sent (or attempted ok). */
  smsReason: string | null;
}

const DONATION_PING_COOLDOWN_MS = 60_000;
const recentPings = new Map<string, number>();

/** First name of the staff member who acted — roster display name first, then
 * the HomeTeam display name. NEVER invented, and NEVER a string that carries
 * digits (a roster row whose display name is a phone number must not leak into
 * a message body): those resolve to null → the calm "Someone from MPRCC…". */
export async function staffFirstName(phone: string): Promise<string | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  let raw: string | null = null;
  try {
    const rows = (await sql()`
      select display_name from public.outreach_roster
      where substring(phone from length(phone) - 9) = ${key} and active
      limit 1`) as unknown as Array<{ display_name: string }>;
    raw = rows[0]?.display_name ?? null;
  } catch {
    /* roster unreachable → try the hometeam name below */
  }
  if (!raw) {
    try {
      const rows = (await sql()`
        select display_name from public.hometeam_members
        where substring(phone from length(phone) - 9) = ${key} and status = 'active'
        limit 1`) as unknown as Array<{ display_name: string }>;
      raw = rows[0]?.display_name ?? null;
    } catch {
      /* no name anywhere → fallback copy */
    }
  }
  if (!raw) return null;
  const first = String(raw).trim().split(/\s+/)[0]?.replace(/^["'“‘]+|["'”’]+$/g, "") ?? "";
  if (!first || first.length > 24 || /[0-9]/.test(first)) return null;
  return first;
}

/** Next appropriate outreach day (Marin-local): tomorrow when it's Mon–Fri,
 * otherwise the next Monday. Returns the EN label + the ES day index so the
 * reschedule line stays gentle and true. */
export function nextOutreachDay(now: Date = new Date()): { tomorrow: boolean; weekdayIndex: number } {
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const offset of [1, 2, 3]) {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
    }).format(new Date(now.getTime() + offset * 86_400_000));
    const idx = short.indexOf(wd);
    if (idx >= 1 && idx <= 5) return { tomorrow: offset === 1, weekdayIndex: idx };
  }
  return { tomorrow: true, weekdayIndex: 1 };
}

/** The calm reschedule day word — "tomorrow" or the weekday name. */
export function rescheduleDayLabel(
  day: { tomorrow: boolean; weekdayIndex: number },
  lang: "en" | "es" = "en",
): string {
  const words = DONATION_DAY_LABEL[lang];
  return day.tomorrow ? words.tomorrow : words.days[day.weekdayIndex];
}

const fillPing = (tpl: string, vars: Record<string, string>): string =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");

const clipPing = (raw: string, max: number): string => {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Tell the submitter what's happening with their own row. Called by
 * /api/donations/claim (claim), /api/donations/in-route (in_route),
 * /api/donations/complete (reschedule) and /api/donations/not-in-supplies
 * (not_in_supplies). Returns counts/reasons only — never
 * throws, never logs, never echoes a phone number.
 */
export async function pingDonationSubmitter(opts: {
  table: DonationTableName;
  id: string;
  kind: DonationPingKind;
  /** The row's item text (requester's own words) — the {item} substitution. */
  itemLabel: string;
  /** The row's contact_phone. Server-side only; never in a payload. */
  contactPhone: string;
  /** Claiming staff first name (claim only). Null → "Someone from MPRCC…". */
  staffName?: string | null;
  /** Offers are pickups (staff comes TO them) — wording flips accordingly. */
  offer?: boolean;
  /** EN day word for the reschedule line. */
  dayLabel?: string | null;
}): Promise<DonationPingResult> {
  const out: DonationPingResult = {
    kind: opts.kind,
    pushTargets: 0,
    pushSent: 0,
    smsSent: false,
    smsReason: null,
  };
  const item = clipPing(opts.itemLabel, 60) || "item";
  const name = opts.staffName ? clipPing(opts.staffName, 24) : "";
  const copy = DONATION_PING_COPY;
  let title: string;
  let body: string;
  /** Set only when the push body must differ from the text body (the OS clips
   *  a notification; the text message always carries the full copy). */
  let pushBody: string | null = null;
  if (opts.kind === "claim") {
    title = opts.offer ? copy.title.claimOffer.en : copy.title.claim.en;
    body = opts.offer
      ? fillPing(name ? copy.claimOffer.en : copy.claimOfferFallback.en, { name, item })
      : fillPing(name ? copy.claim.en : copy.claimFallback.en, { name, item });
  } else if (opts.kind === "in_route") {
    title = copy.title.inRoute.en;
    body = fillPing(opts.offer ? copy.inRouteOffer.en : copy.inRoute.en, { item });
  } else if (opts.kind === "not_in_supplies") {
    // Owner copy, verbatim in the text. The push uses the same message with
    // its middle explanation left out (both sentences verbatim from it) so the
    // notification stays readable.
    title = copy.title.notInSupplies.en;
    body = fillPing(copy.notInSupplies.en, { item });
    pushBody = fillPing(copy.notInSuppliesPush.en, { item });
  } else {
    title = copy.title.reschedule.en;
    body = fillPing(opts.offer ? copy.rescheduleOffer.en : copy.reschedule.en, {
      item,
      day: opts.dayLabel ?? "soon",
    });
  }
  // Defensive: nothing user-visible may carry a phone-length digit run.
  let pushOut = pushBody ?? body;
  if (/\d{7,}/.test(`${title} ${body} ${pushOut}`)) {
    body = body.replace(/[0-9]{7,}/g, "…");
    pushOut = pushOut.replace(/[0-9]{7,}/g, "…");
    pushBody = pushOut;
  }

  /* 1. Push — every device token this phone registered (empty for anyone who
   *    never tapped Allow: zero tokens, zero pushes, nothing to clean up). */
  try {
    const tokens = await tokensForPhone(opts.contactPhone);
    out.pushTargets = tokens.length;
    for (const token of tokens.slice(0, 20)) {
      try {
        const r = await sendFcmMessage({
          token,
          title,
          body: clipPing(pushBody ?? body, PUSH_BODY_CAP[opts.kind]),
          link: DONATION_REQUESTER_LINK,
        });
        if (r.status === "sent") out.pushSent += 1;
      } catch {
        /* best-effort per token */
      }
    }
  } catch {
    /* push store unreachable — the SMS path below still gets its chance */
  }

  /* 2. SMS — consent + STOP + business hours, via gateSms. Never emergency. */
  const cooldownKey = `${opts.table}:${opts.id}:${opts.kind}`;
  const now = Date.now();
  const last = recentPings.get(cooldownKey) ?? 0;
  if (now - last < DONATION_PING_COOLDOWN_MS) {
    out.smsReason = "cooldown";
    return out;
  }
  try {
    const gate = await gateSms(opts.contactPhone);
    if (!gate.send) {
      out.smsReason = gate.reason;
      return out;
    }
    const text = `${body} (MPRCC SafeGround. Reply STOP to stop texts.)`;
    const sent = await sendSms(opts.contactPhone, text);
    out.smsSent = sent.ok;
    out.smsReason = sent.ok ? null : sent.reason;
    if (sent.ok) recentPings.set(cooldownKey, now);
  } catch {
    out.smsReason = "send_failed";
  }
  return out;
}

/* ── Queue row shapes (snake_case columns → camelCase JSON) ───────── */
export interface DonationOfferRow {
  id: string;
  path: string;
  itemDescription: string;
  category: string;
  conditionNote: string | null;
  quantity: string | null;
  contactPhone: string;
  address: { street: string | null; city: string | null; zip: string | null };
  approachNotes: string | null;
  pickupTimeWindow: string | null;
  photoB64: string | null;
  status: string;
  claimedBy: string | null;
  claimedAt: string | null;
  /** In route — set when staff mark the item on its way (2026-09-16). */
  routeStartedAt: string | null;
  completedAt: string | null;
  /** delivered | peer_not_at_spot | null (no outcome recorded yet). */
  outcome: string | null;
  outcomeAt: string | null;
  outcomeByPhone: string | null;
  /** Delivery attempts recorded (each outcome bumps this). */
  attempts: number;
  outcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapOfferRow(r: Record<string, unknown>): DonationOfferRow {
  return {
    id: String(r.id),
    path: String(r.path),
    itemDescription: String(r.item_description),
    category: String(r.category),
    conditionNote: r.condition_note == null ? null : String(r.condition_note),
    quantity: r.quantity == null ? null : String(r.quantity),
    contactPhone: String(r.contact_phone),
    address: {
      street: r.address_street == null ? null : String(r.address_street),
      city: r.address_city == null ? null : String(r.address_city),
      zip: r.address_zip == null ? null : String(r.address_zip),
    },
    approachNotes: r.approach_notes == null ? null : String(r.approach_notes),
    pickupTimeWindow: r.pickup_time_window == null ? null : String(r.pickup_time_window),
    photoB64: r.photo_b64 == null ? null : String(r.photo_b64),
    status: String(r.status),
    claimedBy: r.claimed_by_phone == null ? null : String(r.claimed_by_phone),
    claimedAt: r.claimed_at == null ? null : String(r.claimed_at),
    routeStartedAt: r.route_started_at == null ? null : String(r.route_started_at),
    completedAt: r.completed_at == null ? null : String(r.completed_at),
    outcome: r.outcome == null ? null : String(r.outcome),
    outcomeAt: r.outcome_at == null ? null : String(r.outcome_at),
    outcomeByPhone: r.outcome_by_phone == null ? null : String(r.outcome_by_phone),
    attempts: Number(r.attempts ?? 0),
    outcomeNote: r.outcome_note == null ? null : String(r.outcome_note),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export interface DonationRequestRow {
  id: string;
  item: string;
  category: string;
  quantity: string | null;
  notes: string | null;
  size: string | null;
  pickupOrDelivery: string;
  contactPhone: string;
  status: string;
  claimedBy: string | null;
  claimedAt: string | null;
  /** In route — set when staff mark the item on its way (2026-09-16). */
  routeStartedAt: string | null;
  completedAt: string | null;
  /** delivered | peer_not_at_spot | null (no outcome recorded yet). */
  outcome: string | null;
  outcomeAt: string | null;
  outcomeByPhone: string | null;
  /** Delivery attempts recorded (each outcome bumps this). */
  attempts: number;
  outcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapRequestRow(r: Record<string, unknown>): DonationRequestRow {
  return {
    id: String(r.id),
    item: String(r.item),
    category: String(r.category),
    quantity: r.quantity == null ? null : String(r.quantity),
    notes: r.notes == null ? null : String(r.notes),
    size: r.size == null ? null : String(r.size),
    pickupOrDelivery: String(r.pickup_or_delivery),
    contactPhone: String(r.contact_phone),
    status: String(r.status),
    claimedBy: r.claimed_by_phone == null ? null : String(r.claimed_by_phone),
    claimedAt: r.claimed_at == null ? null : String(r.claimed_at),
    routeStartedAt: r.route_started_at == null ? null : String(r.route_started_at),
    completedAt: r.completed_at == null ? null : String(r.completed_at),
    outcome: r.outcome == null ? null : String(r.outcome),
    outcomeAt: r.outcome_at == null ? null : String(r.outcome_at),
    outcomeByPhone: r.outcome_by_phone == null ? null : String(r.outcome_by_phone),
    attempts: Number(r.attempts ?? 0),
    outcomeNote: r.outcome_note == null ? null : String(r.outcome_note),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Staff queue gate helper: caller phone → role check + calm 403 response.
 * Shared by all four queue/claim/complete routes. */
export async function staffGateOr403(
  caller: string,
): Promise<Response | null> {
  if (!(await isDonationStaff(caller))) {
    return Response.json({ ok: false, error: DONATION_CALM_403 }, { status: 403 });
  }
  return null;
}

/** Which table does a queue discriminator point at? */
export const queueTable = (
  queue: string,
): { table: DonationTableName; kind: "offer" | "request" } | null =>
  queue === "offers"
    ? { table: "donation_offers", kind: "offer" }
    : queue === "requests"
      ? { table: "donation_requests", kind: "request" }
      : null;