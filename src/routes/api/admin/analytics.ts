/**
 * Anonymous analytics aggregates for the admin dashboard (owner-directed 2026-09-07).
 *
 * GET /api/admin/analytics — aggregates ONLY over public.analytics_events
 * (anonymous counters: event_type + optional category/status + opaque
 * install_id). Admin-only: caller must be an ACTIVE roster admin
 * (isRosterAdmin, last-10-digit match — staff_limited like Tracey is NOT
 * admin, so they 403 here server-side). Never throws: DB failure → 503.
 *
 * PRIVACY: x-sg-phone is used ONLY for the admin gate — never logged, never
 * stored, never in the payload. No phones, names, IPs, coords, or notes
 * anywhere in this response.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { analyticsTableReady } from "~/lib/analytics/server";
import { OUTREACH_CALM_LINE } from "~/lib/outreachServer";
import { isRosterAdmin } from "~/lib/pushServer";

const UNAVAILABLE = "Analytics are unavailable right now.";

const num = (v: unknown): number => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

async function analyticsSummary(c: { request: Request }) {
  const caller = c.request.headers.get("x-sg-phone") ?? "";
  if (!(await isRosterAdmin(caller))) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  if (!(await analyticsTableReady())) {
    return Response.json({ ok: false, error: UNAVAILABLE }, { status: 503 });
  }
  try {
    const monthRows = (await sql()`
      select
        count(*) filter (where event_type = 'peer_support_request') as peer_support,
        count(*) filter (where event_type = 'check_in') as check_ins,
        count(*) filter (where event_type = 'resource_search') as resource_searches,
        count(distinct install_id) as active_users
      from public.analytics_events
      where created_at >= now() - interval '1 month'`) as unknown as Array<Record<string, unknown>>;
    const month = monthRows[0] ?? {};

    const topRows = (await sql()`
      select category, count(*) as count
      from public.analytics_events
      where created_at >= now() - interval '1 month' and category is not null
      group by category
      order by count desc
      limit 6`) as unknown as Array<{ category: string; count: unknown }>;

    const weekRows = (await sql()`
      select to_char(d.day, 'YYYY-MM-DD') as day,
        count(*) filter (where e.event_type = 'peer_support_request') as requests,
        count(*) filter (where e.event_type = 'check_in') as checkins
      from (
        select generate_series(
          date_trunc('day', now() - interval '6 days'),
          date_trunc('day', now()),
          interval '1 day'
        ) as day
      ) d
      left join public.analytics_events e on date_trunc('day', e.created_at) = d.day
      group by d.day
      order by d.day`) as unknown as Array<{ day: string; requests: unknown; checkins: unknown }>;

    const sweepRows = (await sql()`
      select count(*) as total
      from public.analytics_events
      where event_type = 'sweep_alert_view'`) as unknown as Array<Record<string, unknown>>;

    return Response.json({
      ok: true,
      data: {
        month: {
          peerSupportMonth: num(month.peer_support),
          checkInsMonth: num(month.check_ins),
          activeUsersMonth: num(month.active_users),
          resourceSearchesMonth: num(month.resource_searches),
        },
        topCategories: topRows.map((r) => ({
          category: String(r.category),
          count: num(r.count),
        })),
        weeklyActivity: weekRows.map((r) => ({
          day: String(r.day),
          requests: num(r.requests),
          checkIns: num(r.checkins),
        })),
        sweepAlertViews: num(sweepRows[0]?.total),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch {
    return Response.json({ ok: false, error: UNAVAILABLE }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/admin/analytics")({
  server: {
    handlers: {
      GET: analyticsSummary,
    },
  },
});
