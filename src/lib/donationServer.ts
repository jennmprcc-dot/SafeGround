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
  sendFcmMessage,
  tokensForPhone,
} from "~/lib/pushServer";
import {
  DONATION_PUSH_LINKS,
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
  completedAt: string | null;
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
    completedAt: r.completed_at == null ? null : String(r.completed_at),
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
  completedAt: string | null;
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
    completedAt: r.completed_at == null ? null : String(r.completed_at),
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