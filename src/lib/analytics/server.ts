/**
 * Server-side anonymous analytics insert (owner-directed 2026-09-07).
 *
 * The ONLY writer to public.analytics_events. Called fire-and-forget from
 * `logAnonymousEvent` (~/lib/analytics/logger.ts) — it never throws: a
 * missing table, a down DB, or bad input all return { ok: false } silently so
 * analytics can NEVER break a neighbor's workflow.
 *
 * PRIVACY (hard rules, reviewed):
 *  - Writes exactly four columns: event_type, category, status, install_id.
 *  - NEVER reads request headers, x-forwarded-for, user-agent, IP, phone,
 *    coords, notes, or any free text. The validator drops everything else.
 *  - install_id is the client-supplied opaque random UUID (see
 *    ~/lib/analyticsIdentity.ts) — validated as uuid-shaped here, stored as
 *    NULL when absent/invalid. No FK, no join, no lookup.
 */

import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import type { AnalyticsEventType } from "~/lib/analytics/types";

export type { AnalyticsEventType };

const EVENT_TYPES: ReadonlySet<string> = new Set([
  "resource_search",
  "peer_support_request",
  "sweep_alert_view",
  "check_in",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalyticsEventInput {
  eventType: string;
  category: string | null;
  status: string | null;
  installId: string | null;
}

/** Graceful table check — true when analytics_events exists. Never throws. */
export async function analyticsTableReady(): Promise<boolean> {
  try {
    const rows = (await sql()`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'analytics_events'
      limit 1`) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Plain server-side insert (for API routes — no server-fn machinery).
 * Never throws; returns false when the event was not recorded.
 */
export async function insertAnalyticsEvent(
  eventType: string,
  opts?: { category?: string | null; status?: string | null; installId?: string | null },
): Promise<boolean> {
  try {
    if (!EVENT_TYPES.has(eventType)) return false;
    if (!(await analyticsTableReady())) return false;
    const category =
      typeof opts?.category === "string" && opts.category.length > 0
        ? opts.category.slice(0, 40)
        : null;
    const status =
      typeof opts?.status === "string" && opts.status.length > 0
        ? opts.status.slice(0, 20)
        : null;
    const installId =
      typeof opts?.installId === "string" && UUID_RE.test(opts.installId)
        ? opts.installId
        : null;
    await sql()`
      insert into public.analytics_events (event_type, category, status, install_id)
      values (${eventType}, ${category}, ${status}, ${installId})`;
    return true;
  } catch {
    return false;
  }
}

export const recordAnalyticsEvent = createServerFn({ method: "POST" })
  .validator((input: unknown): AnalyticsEventInput => {
    const v = (input ?? {}) as {
      eventType?: unknown;
      category?: unknown;
      status?: unknown;
      installId?: unknown;
    };
    const category =
      typeof v.category === "string" && v.category.length > 0
        ? v.category.slice(0, 40)
        : null;
    const status =
      typeof v.status === "string" && v.status.length > 0
        ? v.status.slice(0, 20)
        : null;
    const installId =
      typeof v.installId === "string" && UUID_RE.test(v.installId)
        ? v.installId
        : null;
    return {
      eventType: typeof v.eventType === "string" ? v.eventType : "",
      category,
      status,
      installId,
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ok = await insertAnalyticsEvent(data.eventType, {
      category: data.category,
      status: data.status,
      installId: data.installId,
    });
    return { ok };
  });
