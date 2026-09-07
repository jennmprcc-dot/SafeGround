/**
 * Browser-safe fire-and-forget anonymous event logger (owner-directed
 * 2026-09-07). Client components import THIS file (never
 * ~/lib/analytics/server.ts, which is server-only).
 *
 * Fire-and-forget: callers may `void logAnonymousEvent(...)` or not await.
 * The function itself never throws, never blocks the UI critical path, and
 * degrades silently (missing table / DB down / offline → no-op).
 *
 * PRIVACY: NEVER reads request headers, x-forwarded-for, user-agent, IP,
 * phone, coords, notes, raw search text, or any free text. The only values
 * ever sent are the event type + an optional category id/status string +
 * the anonymous install id (see ~/lib/analyticsIdentity.ts).
 */

import { recordAnalyticsEvent } from "~/lib/analytics/server";
import type { AnalyticsEventType } from "~/lib/analytics/server";
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
    // Fire-and-forget: do NOT await on the UI critical path. The server fn
    // try/catches internally (peerSupportTableReady-style), so a rejection
    // here only means transport failure — swallow it silently.
    void recordAnalyticsEvent({
      data: { eventType, category, status, installId: getAnalyticsInstallId() },
    }).catch(() => {
      /* graceful degradation — log nothing, tell the user nothing */
    });
  } catch {
    /* never throws to the caller */
  }
}
