/**
 * Browser-safe fire-and-forget anonymous event logger (owner-directed
 * 2026-09-07). Client components import THIS file (never
 * ~/lib/analytics/server.ts, which is server-only).
 *
 * Fire-and-forget: callers may `void logAnonymousEvent(...)` or not await.
 * The function itself never throws, never blocks the UI critical path, and
 * degrades silently (missing table / DB down / offline → no-op).
 *
 * TRANSPORT: plain `fetch` POST to `/api/analytics/log` — the server route
 * records the row via insertAnalyticsEvent. This file (and its imports:
 * ~/lib/analytics/types.ts + ~/lib/analyticsIdentity.ts) are pure
 * browser-safe modules, so no Node-only code (pg/Buffer) can ever enter the
 * client bundle through this path. Do NOT import the server-fn from
 * ~/lib/analytics/server.ts here — a static import of that module would
 * bundle `pg` into the client chunk and crash the page with
 * "Buffer is not defined" (P0 2026-09-08: /sweeps, /help, /checkin).
 *
 * PRIVACY: NEVER reads request headers, x-forwarded-for, user-agent, IP,
 * phone, coords, notes, raw search text, or any free text. The only values
 * ever sent are the event type + an optional category id/status string +
 * the anonymous install id (see ~/lib/analyticsIdentity.ts).
 */

import type { AnalyticsEventType } from "~/lib/analytics/types";
import { getAnalyticsInstallId } from "~/lib/analyticsIdentity";

export type { AnalyticsEventType };

export function logAnonymousEvent(
  eventType: AnalyticsEventType,
  opts?: { category?: string | null; status?: string | null },
): void {
  try {
    const category =
      typeof opts?.category === "string" && opts.category.length > 0
        ? opts.category
        : null;
    const status =
      typeof opts?.status === "string" && opts.status.length > 0
        ? opts.status
        : null;
    // Fire-and-forget: do NOT await on the UI critical path. The server
    // route try/catches internally (insertAnalyticsEvent), so a rejection
    // here only means transport failure — swallow it silently.
    void fetch("/api/analytics/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType,
        category,
        status,
        installId: getAnalyticsInstallId(),
      }),
    }).catch(() => {
      /* graceful degradation — log nothing, tell the user nothing */
    });
  } catch {
    /* never throws to the caller */
  }
}
