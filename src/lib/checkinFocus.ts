/**
 * Check-in push deep-link focus (backlog 84dd5b25 — owner-flagged UX gap:
 * "make the check-in location discoverable").
 *
 * When a peer taps a check-in push, the notification link carries
 * `/checkin?focus=checkin:<checkInId>`. The check-in screen reads that param,
 * scrolls the "Friends sharing with you" map into view and highlights the fresh
 * FUZZED pin (~150m) with a calm caption ("Zack checked in near here").
 *
 * Hard floors respected here:
 * - Fuzzy pin only. This module never carries, parses, or hands out any
 *   coordinate — it moves the VIEWPORT and marks ONE existing fuzzed row as
 *   focused. No new location exposure exists because nothing here touches
 *   latitude/longitude at all.
 * - No schema change, no stored PII: a route query param (and, for an app that
 *   is already open, a one-off in-memory browser event). Nothing is persisted,
 *   nothing is logged, nothing is sent anywhere.
 * - The id is the check-in ROW id (uuid) — never a name, phone or place. If the
 *   id is missing or no longer visible (paused / expired), the screen falls
 *   back to a generic caption rather than attributing the check-in to the
 *   wrong person.
 *
 * Isomorphic on purpose: `parseCheckInFocus` / `checkInFocusLink` are pure so
 * the server (the push fan-out) and the client build the exact same link. The
 * `window`-touching helpers are guarded and no-op outside the browser.
 */

/** In-app hand-off event: the open app focuses a check-in without a reload. */
export const CHECKIN_FOCUS_EVENT = "sg:checkin-focus";

/** The `focus` query-param value starts with this word. */
export const CHECKIN_FOCUS_PREFIX = "checkin";

/** A check-in row id — uuid-shaped, bounded. Anything else is ignored. */
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export interface CheckInFocus {
  /** The deep-link asked to focus a check-in. */
  active: boolean;
  /** The specific check-in row id, when the link carried one. */
  id: string | null;
}

/** Parse a `focus` query value. Unknown values are simply not our business. */
export function parseCheckInFocus(raw: unknown): CheckInFocus {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const s = typeof value === "string" ? value.trim().slice(0, 96) : "";
  if (!s || !s.toLowerCase().startsWith(CHECKIN_FOCUS_PREFIX)) return { active: false, id: null };
  const rest = s.slice(CHECKIN_FOCUS_PREFIX.length);
  if (rest !== "" && rest[0] !== ":") return { active: false, id: null };
  const id = rest.slice(1).trim();
  return { active: true, id: ID_RE.test(id) ? id : null };
}

/** `/checkin?focus=checkin[:<id>]` — the one link shape the push + UI share. */
export function checkInFocusLink(id?: string | null): string {
  const clean = typeof id === "string" ? id.trim() : "";
  return `/checkin?focus=${CHECKIN_FOCUS_PREFIX}${ID_RE.test(clean) ? `:${clean}` : ""}`;
}

/** The check-in id inside an app path/URL, or null when it isn't a check-in
 * focus link at all. Used by the service-worker hand-off in the app. */
export function checkInIdFromLink(link: string | null | undefined): string | null {
  const raw = typeof link === "string" ? link : "";
  if (!raw) return null;
  const q = raw.indexOf("?");
  if (q < 0) return null;
  try {
    const params = new URLSearchParams(raw.slice(q + 1));
    return parseCheckInFocus(params.get("focus")).id;
  } catch {
    return null;
  }
}

/** True when a link is a check-in focus link (with or without an id). */
export function isCheckInFocusLink(link: string | null | undefined): boolean {
  const raw = typeof link === "string" ? link : "";
  const q = raw.indexOf("?");
  if (q < 0) return false;
  try {
    return parseCheckInFocus(new URLSearchParams(raw.slice(q + 1)).get("focus")).active;
  } catch {
    return false;
  }
}

/** First name only, matching the push copy (`pushBodyFor`) — never a surname. */
export function firstNameOf(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase() === "neighbor" ? "" : first;
}

/**
 * Ask the LIVE check-in screen to focus a check-in (app already open — an FCM
 * foreground push or a notification the browser delivered without a reload).
 * Fire-and-forget; a screen that isn't mounted just ignores it.
 */
export function requestCheckInFocus(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(CHECKIN_FOCUS_EVENT, { detail: { id } }));
  } catch {
    /* ancient browser without CustomEvent — the query param still covers it */
  }
}
