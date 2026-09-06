/**
 * SafeGround server functions (TanStack Start `createServerFn`) — the live
 * data layer. Routes call these instead of importing demo arrays.
 *
 * Data source: the live Supabase Postgres via `sql()` (src/db.ts) — reads run
 * with RLS enforced by the database (resources/sweeps are public-read per
 * R-P6; user data is never touched in this wave). `supabase_url` +
 * `supabase_anon_key` are for the browser-side Data API and are intentionally
 * not used here.
 *
 * Calm degradation: if the database is unreachable (missing/misconfigured
 * credential, network), every fn falls back to the typed demo content and tags
 * it `source: "demo"` so the UI can keep its honest "Demo data" label instead
 * of showing an error wall. When the DB answers, `source: "db"` and rows come
 * from live tables.
 *
 * All returned values are serializable primitives (timestamps coerced to ISO
 * strings) — React cannot render Date objects across the server/client bound.
 */
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { DEMO_RESOURCES, DEMO_SWEEPS } from "~/lib/data";
import type { CategoryId } from "~/lib/data";

/* ── Public row shapes (serializable) ──────────────────────────── */

export type DataSource = "db" | "demo";

export interface ResourceRow {
  id: string;
  name: string;
  category: CategoryId;
  address: string | null;
  hours: string | null;
  phone: string | null;
  note: string | null;
  /** ISO date (YYYY-MM-DD) or null — "Not confirmed yet" when absent. */
  verifiedAt: string | null;
  lat: number;
  lng: number;
  /** Derived server-side from the hours text (schema has no open_now column). */
  openNow: boolean;
}

export interface SweepRow {
  id: string;
  /** Display state derived from severity + event window (schema enums). */
  status: "active" | "planned" | "resolved";
  verified: boolean;
  /** Short window line, e.g. "Happening now" / "Planned · Fri 8am". */
  window: string;
  note: string | null;
  lat: number;
  lng: number;
  reportedMinutesAgo: number;
}

export interface ListResult<T> {
  rows: T[];
  source: DataSource;
}

/* ── Hours parsing: derive "open now" honestly ────────────────────
 * The schema stores hours as free text. This conservative parser recognizes
 * the shapes outreach uses ("Daily 8am–4pm", "Mon–Sat 9am–8pm", "24h outdoor",
 * "Open nightly 6pm–8am", "Tue & Fri 3–7pm", "Wed only, walk-ins 9am–3pm").
 * Unrecognized text → false (never claims open without evidence). */
export function isOpenNow(hours: string | null, now: Date = new Date()): boolean {
  if (!hours) return false;
  const h = hours.toLowerCase();
  if (/24\s*h|always/.test(h)) return true;
  if (/nightly/.test(h)) return true;
  // First time range in the text: "8am–4pm" (en dash, hyphen, or "to").
  const range = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:–|-|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/.exec(h);
  if (!range) return false;
  const to24 = (num: string, mm: string | undefined, ap: string) => {
    let v = parseInt(num, 10) % 12;
    if (ap === "pm") v += 12;
    return v + (mm ? parseInt(mm, 10) / 60 : 0);
  };
  const start = to24(range[1], range[2], range[3]);
  const end = to24(range[4], range[5], range[6]);
  const nowH = now.getHours() + now.getMinutes() / 60;
  const overnight = end <= start;
  const inHours = overnight ? nowH >= start || nowH < end : nowH >= start && nowH < end;
  if (!inHours) return false;
  // Day filter: "daily" → any day; "mon–fri"/"mon–sat" → span; named days → set.
  if (/daily|every day/.test(h)) return true;
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const today = days[now.getDay()];
  const span = /\b(sun|mon|tue|wed|thu|fri|sat)\s*(?:–|-|—|to)\s*(sun|mon|tue|wed|thu|fri|sat)\b/.exec(h);
  if (span) {
    const a = days.indexOf(span[1]);
    const b = days.indexOf(span[2]);
    const t = now.getDay();
    return a <= b ? t >= a && t <= b : t >= a || t <= b;
  }
  const named = h.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/g);
  if (named) {
    const set = new Set(named.map((d) => (d === "tues" ? "tue" : d.startsWith("thur") ? "thu" : d)));
    return set.has(today);
  }
  // Time range but no day info: treat as every day.
  return true;
}

/* ── Row mappers (DB → UI shape) ────────────────────────────────── */

interface DbResourceRow {
  id: string;
  name: string;
  category: string;
  address: string | null;
  hours: string | null;
  phone: string | null;
  note: string | null;
  verified_at: string | Date | null;
  lat: number | null;
  lng: number | null;
}

function mapResource(r: DbResourceRow): ResourceRow {
  return {
    id: r.id,
    name: r.name,
    category: r.category as CategoryId,
    address: r.address,
    hours: r.hours,
    phone: r.phone,
    note: r.note,
    verifiedAt: r.verified_at ? String(r.verified_at).slice(0, 10) : null,
    lat: r.lat ?? 0,
    lng: r.lng ?? 0,
    openNow: isOpenNow(r.hours),
  };
}

function mapSweep(s: {
  id: string;
  status: string;
  severity: string;
  event_at: string | Date;
  verified_at: string | Date | null;
  note: string | null;
  lat: number;
  lng: number;
  created_at: string | Date;
}, now: Date = new Date()): SweepRow {
  const eventAt = new Date(s.event_at);
  const createdAt = new Date(s.created_at);
  const hoursAhead = (eventAt.getTime() - now.getTime()) / 3_600_000;
  // Schema window semantics: active within 24h of event_at; planned when
  // event_at is future; older than 24h → expired/resolved (R-P10 spirit).
  let status: SweepRow["status"];
  if (s.severity === "resolved_recent") status = "resolved";
  else if (hoursAhead > 0) status = "planned";
  else if (hoursAhead > -24) status = "active";
  else status = "resolved";
  const window =
    status === "active"
      ? "Happening now"
      : status === "planned"
        ? `Planned · ${eventAt.toLocaleDateString("en-US", { weekday: "short" })} ${eventAt.toLocaleTimeString("en-US", { hour: "numeric" })}`
        : "Resolved";
  return {
    id: s.id,
    status,
    verified: s.status === "verified" || s.status === "resolved",
    window,
    note: s.note,
    lat: s.lat,
    lng: s.lng,
    reportedMinutesAgo: Math.max(0, Math.round((now.getTime() - createdAt.getTime()) / 60_000)),
  };
}

function demoResources(): ResourceRow[] {
  return DEMO_RESOURCES.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    address: r.address,
    hours: r.hours,
    phone: r.phone ?? null,
    note: r.note,
    verifiedAt: r.verifiedAt,
    lat: r.lat,
    lng: r.lng,
    openNow: r.openNow,
  }));
}

function demoSweeps(): SweepRow[] {
  return DEMO_SWEEPS.map((s) => ({
    id: s.id,
    status: s.status === "reported" ? "active" : s.status,
    verified: s.verified ?? false,
    window: s.window,
    note: s.note,
    lat: s.lat,
    lng: s.lng,
    reportedMinutesAgo: s.reportedMinutesAgo,
  }));
}

/* ── Server functions ───────────────────────────────────────────── */

/** Public resource list. Filters run in the DB (RLS public-read applies). */
export const listResources = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { categories?: string[]; q?: string; order?: string };
    return {
      categories: Array.isArray(v.categories) ? v.categories.filter((c) => typeof c === "string").slice(0, 8) : [],
      q: typeof v.q === "string" ? v.q.slice(0, 80) : "",
      order: v.order === "name" || v.order === "distance" ? v.order : "name",
    };
  })
  .handler(async ({ data }): Promise<ListResult<ResourceRow>> => {
    try {
      const { categories, q, order } = data;
      const like = q ? `%${q.replace(/[%_]/g, "")}%` : null;
      const rows = (await sql()`
        select id, name, category, address, hours, phone, note, verified_at, lat, lng
        from resources
        where (${categories.length} = 0 or category = any(${categories}))
          and (${like}::text is null or name ilike ${like} or address ilike ${like} or note ilike ${like})
        order by
          case when ${order} = 'distance' then 0 else 1 end,
          name asc
        limit 200`) as unknown as DbResourceRow[];
      return { rows: rows.map(mapResource), source: "db" };
    } catch {
      // Calm degradation: DB unreachable → typed demo content, clearly labeled.
      const { categories, q } = data;
      let rows = demoResources();
      if (categories.length > 0) rows = rows.filter((r) => categories.includes(r.category));
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.address ?? "").toLowerCase().includes(needle) ||
            (r.note ?? "").toLowerCase().includes(needle),
        );
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return { rows, source: "demo" };
    }
  });

/** Public sweep list, freshest first (Home heads-up + sweeps view). */
export const listSweeps = createServerFn({ method: "GET" }).handler(
  async (): Promise<ListResult<SweepRow>> => {
    try {
      const rows = (await sql()`
        select id, status, severity, event_at, verified_at, note, lat, lng, created_at
        from sweeps
        order by case severity when 'active' then 0 when 'planned' then 1 else 2 end,
                 created_at desc
        limit 100`) as unknown as Parameters<typeof mapSweep>[0][];
      return { rows: rows.map((r) => mapSweep(r)), source: "db" };
    } catch {
      const rows = demoSweeps();
      return { rows, source: "demo" };
    }
  },
);

/** Home-page aggregates in one call (sweep count + resource counts). */
export const getHomeStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    activeSweeps: number;
    resourceCount: number;
    openCount: number;
    source: DataSource;
  }> => {
    const [sweeps, resources] = await Promise.all([listSweeps(), listResources()]);
    const activeSweeps = sweeps.rows.filter((s) => s.status === "active" || s.status === "planned").length;
    return {
      activeSweeps,
      resourceCount: resources.rows.length,
      openCount: resources.rows.filter((r) => r.openNow).length,
      source: sweeps.source === "db" && resources.source === "db" ? "db" : "demo",
    };
  },
);
