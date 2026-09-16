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

/** Queue status lifecycle: open → claimed → in_route → completed.
 * (in_route added 2026-09-16: staff claim, then mark the item on the way —
 * the queue keeps 'claimed' + 'in_route' rows active until a Delivered
 * outcome clears them. "Peer not at spot" returns the row to 'claimed'.) */
export const DONATION_STATUS = {
  OPEN: "open",
  CLAIMED: "claimed",
  IN_ROUTE: "in_route",
  COMPLETED: "completed",
} as const;
export type DonationStatus = (typeof DONATION_STATUS)[keyof typeof DONATION_STATUS];
export const DONATION_STATUSES: readonly DonationStatus[] = [
  DONATION_STATUS.OPEN,
  DONATION_STATUS.CLAIMED,
  DONATION_STATUS.IN_ROUTE,
  DONATION_STATUS.COMPLETED,
];
/** Statuses a row is still ACTIVE in (the queue's default Open filter). */
export const DONATION_ACTIVE_STATUSES: readonly string[] = [
  DONATION_STATUS.OPEN,
  DONATION_STATUS.CLAIMED,
  DONATION_STATUS.IN_ROUTE,
];
/** Outcome recorded when staff close a row (owner-directed 2026-09-16). */
export const DONATION_OUTCOME = {
  DELIVERED: "delivered",
  PEER_NOT_AT_SPOT: "peer_not_at_spot",
} as const;
export type DonationOutcome = (typeof DONATION_OUTCOME)[keyof typeof DONATION_OUTCOME];
export const isDonationOutcome = (raw: unknown): raw is DonationOutcome =>
  raw === DONATION_OUTCOME.DELIVERED || raw === DONATION_OUTCOME.PEER_NOT_AT_SPOT;

/* ── Requester ping copy (owner-directed 2026-09-16) ───────────────────
 * The exact owner template for a claim is "Jenn is bringing your tent."
 * ({name} resolved at claim time from the roster, {item} from the row).
 * EN + ES pairs live here (pure data, client-safe) so the wording can't drift
 * between the push body, the SMS body, and any UI preview. The SMS/push sender
 * uses EN — no per-phone language preference is stored server-side yet, the
 * same convention as every other server-sent body in this app. ZERO phone
 * digits ever appear in any of these strings. */
export const DONATION_PING_COPY = {
  /** Staff claimed a Need ("I'm on it"). */
  claim: {
    en: "{name} is bringing your {item}.",
    es: "{name} te está llevando tu {item}.",
  },
  /** Claim fallback when the claiming staff name can't be resolved. */
  claimFallback: {
    en: "Someone from MPRCC is bringing your {item}.",
    es: "Alguien de MPRCC te está llevando tu {item}.",
  },
  /** Staff claimed an Offer (they're coming to pick the donation up). */
  claimOffer: {
    en: "{name} is coming to pick up your {item}.",
    es: "{name} va a recoger tu {item}.",
  },
  claimOfferFallback: {
    en: "Someone from MPRCC is coming to pick up your {item}.",
    es: "Alguien de MPRCC va a recoger tu {item}.",
  },
  /** Staff marked it In route (out for delivery). */
  inRoute: {
    en: "MPRCC staff is on the way with your {item}.",
    es: "El equipo de MPRCC va en camino con tu {item}.",
  },
  /** In route for an Offer — staff are on their way to collect the donation. */
  inRouteOffer: {
    en: "MPRCC staff is on the way for your {item}.",
    es: "El equipo de MPRCC va en camino por tu {item}.",
  },
  /** Calm reschedule after "Peer not at spot" — the item is held for a retry. */
  reschedule: {
    en: "We stopped by but didn't catch you. We'll try again {day} — your {item} is being held for you.",
    es: "Pasamos pero no te encontramos. Lo intentaremos otra vez {day} — guardamos tu {item} para ti.",
  },
  /** Reschedule for an Offer — we'll come back for the donation. */
  rescheduleOffer: {
    en: "We came by but didn't catch you. We'll try again {day} for your {item}.",
    es: "Pasamos pero no te encontramos. Lo intentaremos otra vez {day} por tu {item}.",
  },
  /** Push notification titles (one line, no phone digits, no urgency tricks). */
  title: {
    claim: { en: "SafeGround — your request is being handled", es: "SafeGround — tu pedido está en marcha" },
    claimOffer: { en: "SafeGround — your donation pickup", es: "SafeGround — la recogida de tu donación" },
    inRoute: { en: "SafeGround — on the way", es: "SafeGround — en camino" },
    reschedule: { en: "SafeGround — we'll try again", es: "SafeGround — lo intentaremos otra vez" },
  },
} as const;
/** "Tomorrow" / weekday label for the reschedule line (EN; ES day names below). */
export const DONATION_DAY_LABEL = {
  en: { tomorrow: "tomorrow", days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
  es: { tomorrow: "mañana", days: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] },
} as const;
/** Where the requester's push should land — their OWN My Requests page. */
export const DONATION_REQUESTER_LINK = "/requests";

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
  /** POST {queue: "offers"|"requests", id, staffPhone} (roster-gated)
   *  → {ok, claimed, ping?}; pings the requester when the claim lands. */
  claim: "/api/donations/claim",
  /** POST {queue: "offers"|"requests", id, staffPhone} (roster-gated)
   *  claimed → in_route; pings the requester "on the way". */
  inRoute: "/api/donations/in-route",
  /** POST {queue: "offers"|"requests", id, staffPhone, outcomeNote?,
   *  outcome?: "delivered"|"peer_not_at_spot"} (roster-gated) → {ok, completed,
   *  held, ping?}. delivered → completed + cleared; peer_not_at_spot → the row
   *  returns to 'claimed' and STAYS ACTIVE with a calm reschedule ping. */
  complete: "/api/donations/complete",
} as const;

/** Push deep-link the queue pages should exist at after the UI PR (kept here so
 * pushServer fan-out and the UI can't drift). */
export const DONATION_PUSH_LINKS = {
  offers: "/outreach?tab=donations&queue=offers",
  requests: "/outreach?tab=donations&queue=requests",
} as const;