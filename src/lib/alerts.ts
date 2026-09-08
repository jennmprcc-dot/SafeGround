/**
 * SafeGround — emergency-alert client types + helpers (Wave 2a).
 * Shared between the server fns (src/lib/server.ts) and the route UI.
 * All shapes here are serializable primitives (React-safe).
 *
 * The privacy contract is in the DB (RLS + RPCs); these types reflect it:
 * an alert row served through `listAlertsFor`/`getMyActiveAlert` NEVER carries
 * exact coordinates unless the viewer IS the notified audience (notified
 * friends/peers) or the sender themselves. The UI additionally refuses to
 * render exact coords unless `canSeeExact === true` — a double guard.
 */

/** Quick action kinds — copy verbatim from WAVE2_UX_SPEC §Emergency send flow. */
export type AlertKind = "unsafe_place" | "police_nearby" | "help_needed";

/** Sender-chosen location sharing — NEVER pre-selected (schema rejects NULL). */
export type AlertLocation = "none" | "fuzzed" | "exact";

export type AlertAudienceGroup = "friends" | "peers" | "hometeam";

export type AlertSource = "db" | "demo";

/** Friendly labels, calm — no banned words. */
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  unsafe_place: "Unsafe place",
  police_nearby: "Police nearby",
  help_needed: "Help needed (not police)",
};

export const ALERT_KIND_BLURB: Record<AlertKind, string> = {
  unsafe_place: "A place feels unsafe right now",
  police_nearby: "Police are nearby",
  help_needed: "Would like a hand — not police",
};

export const ALERT_LOCATION_LABEL: Record<AlertLocation, string> = {
  none: "No location",
  fuzzed: "Approximate area (~150m)",
  exact: "Exact spot",
};

/** One alert as it reaches a viewer. exactLat/exactLng are only ever set for
 * the sender or the notified audience — the server fn strips them otherwise. */
export interface AlertRow {
  id: string;
  kind: AlertKind;
  note: string | null;
  /** Sender's chosen location level. */
  location: AlertLocation;
  /** Fuzzed ~150m point (only when location is fuzzed or exact). */
  fuzzLat: number | null;
  fuzzLng: number | null;
  /** Exact point — present ONLY when the viewer may see it (sender or notified). */
  exactLat: number | null;
  exactLng: number | null;
  /** The viewer may lawfully see the exact point (sender, or notified audience). */
  canSeeExact: boolean;
  audience: AlertAudienceGroup[];
  /** Display name of the sender (urgency is calm — no title-casing theatrics). */
  senderName: string;
  /** Raw normalized phone — needed for matching "is this mine? / who's helping?" */
  senderPhone: string;
  /** "I'm on it" — the first helper's normalized phone (or null). */
  claimedBy: string | null;
  /** Friendly name of the current helper (resolved from roster/HomeTeam). */
  claimedByName: string | null;
  claimedAt: string | null; // ISO
  /** Resolution state. */
  resolved: boolean;
  resolvedAt: string | null; // ISO
  resolvedByRole: "sender" | "staff" | null;
  /** Outcome note — sender's own words or staff record. */
  outcomeNote: string | null;
  /** 24h expiry (ISO) — "expires when the alert closes" is shown from this. */
  expiresAt: string;
  createdAt: string; // ISO
  /** true when this row came from the calm demo fallback, not the live DB. */
  source: AlertSource;
}

/** Resolution outcome line for resolved cards, e.g. "✓ a neighbor — all clear 11:05pm · a helper · 1h20m · note". */
export function outcomeLine(a: AlertRow): string {
  const bits: string[] = [];
  bits.push(`${a.senderName.split(" ")[0] ?? "Sender"} — all clear`);
  if (a.resolvedAt) {
    bits.push(
      new Date(a.resolvedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    );
  }
  if (a.claimedByName) bits.push(`${a.claimedByName.split(" ")[0]} helped`);
  if (a.createdAt && a.resolvedAt) {
    const mins = Math.max(1, Math.round((new Date(a.resolvedAt).getTime() - new Date(a.createdAt).getTime()) / 60_000));
    bits.push(mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h${mins % 60 ? `${mins % 60}m` : ""}`);
  }
  if (a.outcomeNote) bits.push(a.outcomeNote);
  return bits.join(" · ");
}

/** "How long" copy for consent guidance (24h expiry, sender-cleared primary). */
export const ALERT_LIFE_COPY = "Until you tap “I'm OK — all clear”, max 24h";
