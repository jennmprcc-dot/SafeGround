/**
 * Grant-ready monthly impact-report CSV export (owner-directed 2026-09-07).
 *
 * GET /api/admin/export-grant-report?month=YYYY-MM (default: current month)
 *   or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive `to`).
 * Admin-only (isRosterAdmin — staff_limited 403s server-side). Counts only
 * from analytics_events (+ peer_support_requests / supply_requests / sweeps
 * for the same window); NO row data, NO phones, names, IPs, coords, or notes
 * anywhere in the CSV. Never throws: DB failure → 503 JSON.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { analyticsTableReady } from "~/lib/analytics/server";
import { OUTREACH_CALM_LINE } from "~/lib/outreachServer";
import { isRosterAdmin } from "~/lib/pushServer";

const UNAVAILABLE = "Analytics are unavailable right now.";

/** "2026-09" for now, "2026-09-01".."2026-10-01" window from a YYYY-MM string. */
function monthWindow(raw: string | null): { label: string; start: string } | null {
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.exec((raw ?? "").trim());
  if (m) return { label: m[0], start: `${m[0]}-01` };
  const now = new Date();
  const label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { label, start: `${label}-01` };
}

/** Window: a from/to date range when both are valid, else the month path. */
type Win = { label: string; start: string; after: "month" | "day" };

function windowFor(url: URL): Win {
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (re.test(from) && re.test(to)) {
    return { label: `${from}-${to}`, start: from, after: "day" };
  }
  const m = monthWindow(url.searchParams.get("month"));
  return { label: m.label, start: m.start, after: "month" };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** CSV row: every cell comma-quoted for a grant reader. */
const row = (...cells: Array<string | number>): string =>
  cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",") + "\n";

async function exportReport(c: { request: Request }) {
  const caller = c.request.headers.get("x-sg-phone") ?? "";
  if (!(await isRosterAdmin(caller))) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  if (!(await analyticsTableReady())) {
    return Response.json({ ok: false, error: UNAVAILABLE }, { status: 503 });
  }
  const url = new URL(c.request.url);
  const win = windowFor(url);
  try {
    const start = win.start;
    // Postgres computes the exclusive end from the bound interval (no JS date math).
    const interval_ = win.after === "day" ? "1 day" : "1 month";
    const counts = (await sql()`
      select
        count(*) as total,
        count(*) filter (where event_type = 'peer_support_request') as peer_support,
        count(*) filter (where event_type = 'check_in') as check_ins,
        count(*) filter (where event_type = 'resource_search') as resource_searches,
        count(*) filter (where event_type = 'sweep_alert_view') as sweep_views,
        count(distinct install_id) as unduplicated
      from public.analytics_events
      where created_at >= ${start}::date
        and created_at < ${start}::date + ${interval_}::interval`) as unknown as Array<Record<string, unknown>>;
    const m = counts[0] ?? {};
    const total = num(m.total);
    const searches = num(m.resource_searches);

    const cats = (await sql()`
      select category, count(*) as count
      from public.analytics_events
      where created_at >= ${start}::date
        and created_at < ${start}::date + ${interval_}::interval
        and event_type = 'resource_search' and category is not null
      group by category
      order by count desc
      limit 10`) as unknown as Array<{ category: string; count: unknown }>;

    // Peer Outreach Connection Volume — by status, same window.
    // Guarded: peer_support_requests may not exist on every DB yet.
    let statusRows: Array<{ status: string; count: unknown }> = [];
    try {
      statusRows = (await sql()`
        select status, count(*) as count
        from public.peer_support_requests
        where created_at >= ${start}::date
          and created_at < ${start}::date + ${interval_}::interval
        group by status
        order by status`) as unknown as Array<{ status: string; count: unknown }>;
    } catch {
      statusRows = [];
    }

    const csv =
      row("SafeGround — Impact Report", win.label) +
      row() +
      row("Reporting Period", win.label) +
      row() +
      row("Section", "Unduplicated Interaction Counters") +
      row("Metric", "Count") +
      row("Total unduplicated neighbors served", num(m.unduplicated)) +
      row("Total interactions logged", total) +
      row("Peer-support requests", num(m.peer_support)) +
      row("Check-ins", num(m.check_ins)) +
      row("Resource searches", searches) +
      row("Sweep-alert views", num(m.sweep_views)) +
      row() +
      row("Section", "Service Breakdown", "(top resource categories, share of searches)") +
      row("Category", "Count", "Share %") +
      cats
        .map((r) => {
          const n = num(r.count);
          const pct = searches > 0 ? ((n / searches) * 100).toFixed(1) : "0.0";
          return row(String(r.category), n, `${pct}%`);
        })
        .join("") +
      row() +
      row("Section", "Peer Outreach Connection Volume", "(peer-support requests by status)") +
      row("Status", "Count") +
      ["open", "claimed", "done", "closed"]
        .map((s) => {
          const found = statusRows.find((r) => String(r.status) === s);
          return row(s, num(found?.count));
        })
        .join("");

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="safeground-impact-report-${win.label}.csv"`,
      },
    });
  } catch {
    return Response.json({ ok: false, error: UNAVAILABLE }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/admin/export-grant-report")({
  server: {
    handlers: {
      GET: exportReport,
    },
  },
});
