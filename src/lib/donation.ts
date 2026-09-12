/**
 * Pass 2 — Donation Dispatch: shared constants + copy (owner-directed
 * 2026-09-12). CLIENT-SAFE module (zero Node-only imports) — the UI PR imports
 * these exports directly: ALWAYS_ACCEPTING, SIZE_PROMPTS, MPRCC_PORCH,
 * DONATION_API, etc. Keep every string the owner specified verbatim here so
 * the backend and the forms can never drift.
 *
 * The owner's Always Accepting list (verbatim), with the two exceptions copy:
 *  - socks + undergarments are NEW ONLY
 *  - bras gently-used are OK
 * The size prompt is type-aware via SIZE_PROMPTS.
 */

/** Always Accepting category list — the ONLY source of truth for both queues.
 * Category strings are stored in the DB exactly as listed here (UI PR: render
 * these as chips/select; submitting a string outside this list is rejected). */
export const ALWAYS_ACCEPTING = [
  "tents",
  "sleeping bags",
  "blankets",
  "jackets/warm layers",
  "pants",
  "tops",
  "shoes",
  "bras",
  "socks and undergarments",
  "hygiene products (unopened)",
  "shelf-stable food",
  "other",
] as const;

export type DonationCategory = (typeof ALWAYS_ACCEPTING)[number];

export const isDonationCategory = (raw: unknown): raw is DonationCategory =>
  (ALWAYS_ACCEPTING as readonly string[]).includes(String(raw ?? ""));

/** The owner-specified exceptions copy. NEW ONLY applies to… */
export const NEW_ONLY_CATEGORIES = ["socks and undergarments"] as const;
/** The owner-specified exceptions copy. Gently used OK for… */
export const GENTLY_USED_OK_CATEGORIES = ["bras"] as const;
export const NEW_ONLY_COPY = "socks and undergarments are new only";
export const BRAS_COPY = "bras gently used are OK";

/** Type-aware size prompts (owner-specified, verbatim). Keyed by category. */
export const SIZE_PROMPTS: Readonly<Record<string, string>> = {
  pants: "waist & inseam (e.g. 34×30)",
  tops: "size (e.g. L)",
  shoes: "US size (e.g. 9.5)",
  bras: "band & cup (e.g. 36C)",
};

export const sizePromptFor = (category: string): string | null =>
  SIZE_PROMPTS[category] ?? null;

/** Offer delivery paths (stored as enum text in donation_offers.path). */
export const OFFER_PATHS = ["porch_drop", "scheduled_pickup", "mprcc_porch"] as const;
export type OfferPath = (typeof OFFER_PATHS)[number];
export const isOfferPath = (raw: unknown): raw is OfferPath =>
  (OFFER_PATHS as readonly string[]).includes(String(raw ?? ""));

/** Pickup window placeholder guidance (owner-specified, verbatim). */
export const PICKUP_TIME_PLACEHOLDER = "e.g. Mon Sep 21, 10am–2pm";

/** Porch-drop staff identification note (owner-specified, verbatim). */
export const PORCH_DROP_STAFF_NOTE =
  "MPRCC staff will identify with badge/name.";

/** MPRCC porch drop info (owner-specified, verbatim). */
export const MPRCC_PORCH = {
  address: "631 A Wilson Ave, Novato, CA 94947",
  hours: "Mon–Fri 10am–8pm, Sat–Sun 10am–5pm",
  dropInstruction:
    "the house on the right with the ramp — not the house in back",
} as const;

/** Queue status lifecycle: open → claimed → completed. */
export const DONATION_STATUS = {
  OPEN: "open",
  CLAIMED: "claimed",
  COMPLETED: "completed",
} as const;
export type DonationStatus = (typeof DONATION_STATUS)[keyof typeof DONATION_STATUS];
export const DONATION_STATUSES: readonly DonationStatus[] = [
  DONATION_STATUS.OPEN,
  DONATION_STATUS.CLAIMED,
  DONATION_STATUS.COMPLETED,
];

/** Request pickup/delivery preference. */
export const PICKUP_OR_DELIVERY = ["pickup", "delivery", "either"] as const;
export type PickupOrDelivery = (typeof PICKUP_OR_DELIVERY)[number];
export const isPickupOrDelivery = (raw: unknown): raw is PickupOrDelivery =>
  (PICKUP_OR_DELIVERY as readonly string[]).includes(String(raw ?? ""));

/** Photo expectations for the UI PR: the client must compress photos to a JPEG
 * at or under this many BYTES before base64-encoding. Base64 adds ~33%, so the
 * stored photo_b64 string is capped at 400,000 chars (≈300KB binary). */
export const PHOTO_CAP_BYTES = 300_000;
export const PHOTO_B64_CAP_CHARS = 400_000;

/** Server API contract (documented in the Pass 2 PR body) — the UI PR should
 * import these paths instead of hardcoding strings. */
export const DONATION_API = {
  /** POST {path, itemDescription, category, conditionNote?, quantity?,
   *  contactPhone, addressStreet?, addressCity?, addressZip?, approachNotes?,
   *  pickupTimeWindow?, photoB64?} → {ok, offer} | 400/503 */
  submitOffer: "/api/donations/offers/submit",
  /** POST {item, category, quantity?, notes?, size?, pickupOrDelivery,
   *  contactPhone} → {ok, request} | 400/503 */
  submitRequest: "/api/donations/requests/submit",
  /** GET ?phone=…[&status=open|all] (roster-gated) → {ok, offers} | 403 */
  offersQueue: "/api/donations/offers",
  /** GET ?phone=…[&status=open|all] (roster-gated) → {ok, requests} | 403 */
  requestsQueue: "/api/donations/requests",
  /** POST {queue: "offers"|"requests", id, staffPhone} (roster-gated) → {ok} */
  claim: "/api/donations/claim",
  /** POST {queue: "offers"|"requests", id, staffPhone, outcomeNote?}
   *  (roster-gated) → {ok} */
  complete: "/api/donations/complete",
} as const;

/** Push deep-link the queue pages should exist at after the UI PR (kept here so
 * pushServer fan-out and the UI can't drift). */
export const DONATION_PUSH_LINKS = {
  offers: "/outreach?tab=donations&queue=offers",
  requests: "/outreach?tab=donations&queue=requests",
} as const;