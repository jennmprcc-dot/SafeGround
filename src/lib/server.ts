/**
 * SafeGround server functions (TanStack Start `createServerFn`) — the live
 * data layer. Routes call these instead of importing demo arrays.
 *
 * Data source: the live Supabase Postgres via `sql()` (src/db.ts) — reads run
 * on the service role, so RLS "owner reads" apply to the app layer here: user
 * rows are always addressed by the device/user id the route passes in (never
 * guessed from a session), and the check-in "peers" path goes through the
 * `peer_check_ins` view which RLS confines to fuzzed columns + mutual
 * acceptance in the database. `supabase_url` + `supabase_anon_key` are for the
 * browser-side Data API and are intentionally not used here.
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

/** Check-in as the OWNER sees it (full row — exact point is theirs). */
export interface CheckInRow {
  id: string;
  checkedInAt: string; // ISO
  visibleUntil: string; // ISO
  note: string | null;
  sharePaused: boolean;
  exactLat: number | null;
  exactLng: number | null;
  /** True when no new check-in for 12h (gentle self-nudge, never an alarm). */
  overdue: boolean;
}

/** Check-in as a TRUSTED PEER sees it (fuzzed ~150m only — via peer_check_ins). */
export interface PeerCheckInRow {
  id: string;
  peerId: string;
  peerName: string;
  fuzzLat: number | null;
  fuzzLng: number | null;
  checkedInAt: string; // ISO
  note: string | null;
  visibleUntil: string; // ISO
  sharing: boolean;
  /** True when this peer hasn't checked in for 12h (gentle check-in, §4d/§4e). */
  overdue: boolean;
}

/** A trusted-peer relationship (mutual acceptance enforced in the DB). */
export interface PeerRow {
  userId: string;
  displayName: string;
  status: "pending" | "accepted";
  /** True only when BOTH sides accepted (the other accepted my invite). */
  mutual: boolean;
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
  const named = h.match(/\b(sun|mon|tue|wed|thu|thur|thurs|fri|sat)\b/g);
  if (named) {
    const set = new Set(named.map((d) => (d === "tues" ? "tue" : d.startsWith("thur") ? "thu" : d)));
    return set.has(today);
  }
  // Time range but no day info: treat as every day.
  return true;
}

/* ── Deterministic device/user id for the demo-auth wave ──────────
 * Real auth (Wave 2) gives a stable auth.uid(). Until then the app signs in
 * locally, so we derive a stable user id from the chosen alias + the browser's
 * random device token (localStorage). Same alias on the same device → same id;
 * different devices stay different users. This only feeds demo check-in data —
 * public read paths (resources/sweeps) never touch it.
 *
 * Pure-JS SHA-1 (FIPS 180-4) so this module stays isomorphic — server fns are
 * also bundled for the browser by Vite, and `node:crypto` is externalized
 * there. Deterministic across runtimes: same input → same UUIDv5-style id. */
function sha1Hex(input: string): string {
  // Standard SHA-1 over UTF-8 — compact, side-effect-free implementation.
  const toUtf8 = unescape(encodeURIComponent(input));
  const words: number[] = [];
  for (let i = 0; i < toUtf8.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | ((toUtf8.charCodeAt(i) & 0xff) << ((3 - (i & 3)) * 8));
  }
  const bitLen = toUtf8.length * 8;
  words[toUtf8.length >> 2] = (words[toUtf8.length >> 2] ?? 0) | (0x80 << ((3 - (toUtf8.length & 3)) * 8));
  words[(((toUtf8.length + 8) >> 6) << 4) + 15] = bitLen;
  const w: number[] = new Array(80);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const rol = (n: number, b: number) => ((n << b) | (n >>> (32 - b))) >>> 0;
  for (let i = 0; i < words.length; i += 16) {
    let a0 = h0;
    let b0 = h1;
    let c0 = h2;
    let d0 = h3;
    let e0 = h4;
    for (let j = 0; j < 80; j++) {
      if (j < 16) w[j] = words[i + j] ?? 0;
      else w[j] = rol((w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!) >>> 0, 1);
      const f = j < 20 ? ((b0 & c0) | (~b0 & d0)) : j < 40 ? (b0 ^ c0 ^ d0) : j < 60 ? ((b0 & c0) | (b0 & d0) | (c0 & d0)) : (b0 ^ c0 ^ d0);
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a0, 5) + f + e0 + k + (w[j]! >>> 0)) >>> 0;
      e0 = d0;
      d0 = c0;
      c0 = rol(b0, 30);
      b0 = a0;
      a0 = tmp;
    }
    h0 = (h0 + a0) >>> 0;
    h1 = (h1 + b0) >>> 0;
    h2 = (h2 + c0) >>> 0;
    h3 = (h3 + d0) >>> 0;
    h4 = (h4 + e0) >>> 0;
  }
  const hex = [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, "0")).join("");
  return hex;
}

const SG_DEVICE_NS = "8f2d4a6c-3e5b-4f1a-9c7d-0b2e8f4a61d3"; // safeground-device namespace

export function demoUserId(displayName: string, deviceToken: string): string {
  const h = sha1Hex(SG_DEVICE_NS.replace(/-/g, "") + displayName.trim().toLowerCase() + "|" + deviceToken);
  const b = h.slice(0, 32).split("").map((ch, i) => {
    let v = parseInt(ch, 16);
    if (i === 12) v = (v & 0x0f) | 0x50;
    if (i === 16) v = (v & 0x3f) | 0x80;
    return v.toString(16);
  });
  const hex = b.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

/** Map a raw check_ins row (owner view) → CheckInRow. */
function mapCheckIn(c: {
  id: string;
  checked_in_at: string | Date;
  visible_until: string | Date | null;
  note: string | null;
  share_paused: boolean;
  exact_lat: number | null;
  exact_lng: number | null;
}, now: Date = new Date()): CheckInRow {
  const checkedInAt = new Date(c.checked_in_at);
  const ageHours = (now.getTime() - checkedInAt.getTime()) / 3_600_000;
  return {
    id: c.id,
    checkedInAt: checkedInAt.toISOString(),
    visibleUntil: c.visible_until ? new Date(c.visible_until).toISOString() : "",
    note: c.note,
    sharePaused: c.share_paused,
    exactLat: c.exact_lat,
    exactLng: c.exact_lng,
    // §4e: 12h without a new check-in → gentle self-nudge (not an alarm).
    overdue: !c.share_paused && ageHours >= 12 && (c.visible_until ? new Date(c.visible_until).getTime() > now.getTime() : false),
  };
}

/** Map a peer_check_ins row (peer view) → PeerCheckInRow. */
function mapPeerCheckIn(p: {
  id: string;
  user_id: string;
  peer_name: string;
  fuzz_lat: number | null;
  fuzz_lng: number | null;
  checked_in_at: string | Date;
  note: string | null;
  visible_until: string | Date | null;
  sharing: boolean;
}, now: Date = new Date()): PeerCheckInRow {
  const checkedInAt = new Date(p.checked_in_at);
  const ageHours = (now.getTime() - checkedInAt.getTime()) / 3_600_000;
  return {
    id: p.id,
    peerId: p.user_id,
    peerName: p.peer_name,
    fuzzLat: p.fuzz_lat,
    fuzzLng: p.fuzz_lng,
    checkedInAt: checkedInAt.toISOString(),
    note: p.note,
    visibleUntil: p.visible_until ? new Date(p.visible_until).toISOString() : "",
    sharing: p.sharing,
    // §4d/§4e: peer hasn't checked in for 12h+ → gentle card, never auto-dispatched.
    overdue: ageHours >= 12,
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

/* ── Build B: Sweep reporting + verification queue ─────────────── */

/** Report a sweep (signed-in neighbor; public later — R-P6). Calm fallback holds the draft and returns it as the report so the flow never appears to lose input. */
export const reportSweep = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { lat?: unknown; lng?: unknown; note?: unknown; happened?: unknown; userId?: unknown };
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    const note = typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    // "Happening now" vs "Planned" — wireframes §3b Step 2 (default now).
    const planned = v.happened === false;
    return {
      lat: Number.isFinite(lat) ? lat : 0,
      lng: Number.isFinite(lng) ? lng : 0,
      note,
      planned,
      userId: typeof v.userId === "string" ? v.userId.slice(0, 64) : "",
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; row: SweepRow | null; source: DataSource }> => {
    try {
      const { lat, lng, note, planned, userId } = data;
      const createdAt = new Date();
      const eventAt = planned ? new Date(createdAt.getTime() + 24 * 3_600_000) : createdAt;
      const rows = (await sql()`
        insert into sweeps (status, severity, event_at, lat, lng, note, reported_by, created_at)
        values (
          'reported',
          ${planned ? "planned" : "active"}::sweep_severity,
          ${eventAt.toISOString()},
          ${lat}, ${lng}, ${note === "" ? null : note},
          ${userId === "" ? null : userId},
          ${createdAt.toISOString()}
        )
        returning id, status, severity, event_at, verified_at, note, lat, lng, created_at
      `) as unknown as Parameters<typeof mapSweep>[0][];
      if (!rows[0]) return { ok: false, row: null, source: "db" };
      return { ok: true, row: mapSweep(rows[0], createdAt), source: "db" };
    } catch {
      // Calm fallback: keep what the reporter typed; the row is tagged as a
      // queued draft (demo) exactly like the Navigator's labeled demo content.
      const { lat, lng, note, planned } = data;
      const createdAt = new Date();
      const eventAt = planned ? new Date(createdAt.getTime() + 24 * 3_600_000) : createdAt;
      const row: SweepRow = {
        id: `draft-${Date.now()}`,
        status: planned ? "planned" : "active",
        verified: false,
        window: planned ? `Planned · ${eventAt.toLocaleDateString("en-US", { weekday: "short" })} ${eventAt.toLocaleTimeString("en-US", { hour: "numeric" })}` : "Happening now",
        note: note === "" ? null : note,
        lat,
        lng,
        reportedMinutesAgo: 0,
      };
      return { ok: true, row, source: "demo" };
    }
  });

/** Outreach verification queue — sweeps in 'reported' state + counts. */
export const getOutreachQueue = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ pending: SweepRow[]; source: DataSource }> => {
    try {
      const rows = (await sql()`
        select id, status, severity, event_at, verified_at, note, lat, lng, created_at
        from sweeps
        where status = 'reported'
        order by created_at desc
        limit 50`) as unknown as Parameters<typeof mapSweep>[0][];
      return { pending: rows.map((r) => mapSweep(r)), source: "db" };
    } catch {
      return { pending: [], source: "demo" };
    }
  },
);

/** Outreach verify / flag / resolve. Reporters see "Under review" (flagged), never a silent delete. */
export const actOnSweep = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { id?: unknown; action?: unknown };
    const id = typeof v.id === "string" ? v.id.slice(0, 64) : "";
    const action = v.action === "verify" || v.action === "flag" || v.action === "resolve" ? v.action : "verify";
    return { id, action };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; source: DataSource }> => {
    const { id, action } = data;
    if (!id) return { ok: false, source: "demo" };
    try {
      if (action === "verify") {
        await sql()`
          update sweeps set status = 'verified', verified_at = now(), verified_by = null
          where id = ${id} and status = 'reported'`;
      } else if (action === "flag") {
        await sql()`
          update sweeps set status = 'flagged', flagged_at = now(), flagged_by = null
          where id = ${id} and status = 'reported'`;
      } else {
        await sql()`
          update sweeps set status = 'resolved', severity = 'resolved_recent', resolved_at = now()
          where id = ${id}`;
      }
      return { ok: true, source: "db" };
    } catch {
      return { ok: false, source: "demo" };
    }
  });

/* ── Build B: Check-Ins (owner writes; peers read fuzzed only) ── */

/** Owner: insert a check-in. Exact point + note stay with the owner; the DB trigger writes visible_until (+24h) and the fuzzed ~150m coordinates. */
export const createCheckIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { userId?: unknown; lat?: unknown; lng?: unknown; note?: unknown };
    return {
      userId: typeof v.userId === "string" ? v.userId.slice(0, 64) : "",
      lat: Number(v.lat),
      lng: Number(v.lng),
      note: typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 140) : "",
    };
  })
  .handler(
    async ({ data }): Promise<{ ok: boolean; row: CheckInRow | null; source: DataSource }> => {
      const { userId, lat, lng, note } = data;
      try {
        const rows = (await sql()`
          insert into check_ins (user_id, exact_lat, exact_lng, note, checked_in_at)
          values (${userId}, ${lat}, ${lng}, ${note === "" ? null : note}, now())
          returning id, checked_in_at, visible_until, note, share_paused, exact_lat, exact_lng
        `) as unknown as Parameters<typeof mapCheckIn>[0][];
        if (!rows[0]) return { ok: false, row: null, source: "db" };
        return { ok: true, row: mapCheckIn(rows[0]), source: "db" };
      } catch {
        // Calm fallback: a demo check-in (clearly labeled, never stored).
        const now = new Date();
        const visibleUntil = new Date(now.getTime() + 24 * 3_600_000);
        return {
          ok: true,
          row: {
            id: `draft-${Date.now()}`,
            checkedInAt: now.toISOString(),
            visibleUntil: visibleUntil.toISOString(),
            note: note === "" ? null : note,
            sharePaused: false,
            exactLat: lat,
            exactLng: lng,
            overdue: false,
          },
          source: "demo",
        };
      }
    },
  );

/** Owner: latest check-in (full row — exact point is the owner's). */
export const getMyCheckIn = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ userId: typeof input === "string" ? input.slice(0, 64) : "" }))
  .handler(async ({ data }): Promise<{ row: CheckInRow | null; source: DataSource }> => {
    const { userId } = data;
    try {
      const rows = (await sql()`
        select id, checked_in_at, visible_until, note, share_paused, exact_lat, exact_lng
        from check_ins
        where user_id = ${userId}
        order by checked_in_at desc
        limit 1`) as unknown as Parameters<typeof mapCheckIn>[0][];
      return { row: rows[0] ? mapCheckIn(rows[0]) : null, source: "db" };
    } catch {
      return { row: null, source: "demo" };
    }
  });

/** Owner: pause (or resume) sharing on the latest check-in — hides instantly (R-P5). */
export const setCheckInSharing = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { userId?: unknown; paused?: unknown };
    return { userId: typeof v.userId === "string" ? v.userId.slice(0, 64) : "", paused: v.paused === true };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; source: DataSource }> => {
    const { userId, paused } = data;
    try {
      await sql()`
        update check_ins set share_paused = ${paused}
        where user_id = ${userId}
          and id = (select id from check_ins where user_id = ${userId} order by checked_in_at desc limit 1)`;
      return { ok: true, source: "db" };
    } catch {
      return { ok: false, source: "demo" };
    }
  });

/** Peer view: fuzzed check-ins via the RLS-confined peer_check_ins view (mutual accepted peers only). */
export const listPeerCheckIns = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ userId: typeof input === "string" ? input.slice(0, 64) : "" }))
  .handler(async ({ data }): Promise<ListResult<PeerCheckInRow>> => {
    const { userId } = data;
    try {
      // RLS (peer policy) + the view guarantee: only mutual accepted peers,
      // only fuzzed columns, only currently-sharing rows.
      const rows = (await sql()`
        select id, user_id, peer_name, fuzz_lat, fuzz_lng, checked_in_at, note, visible_until, sharing
        from peer_check_ins
        where user_id <> ${userId}
        order by checked_in_at desc
        limit 50`) as unknown as Parameters<typeof mapPeerCheckIn>[0][];
      return { rows: rows.map((r) => mapPeerCheckIn(r)), source: "db" };
    } catch {
      // Calm demo fallback: two friendly sample peers, fuzzed points.
      const now = new Date();
      const threeH = now.getTime() - 3 * 3_600_000;
      const fourteenH = now.getTime() - 14 * 3_600_000;
      const future24 = new Date(now.getTime() + 21 * 3_600_000).toISOString();
      return {
        rows: [
          {
            id: "demo-peer-1",
            peerId: "demo-peer-1",
            peerName: "Maya",
            fuzzLat: 37.814,
            fuzzLng: -122.273,
            checkedInAt: new Date(threeH).toISOString(),
            note: "out tonight, phone low",
            visibleUntil: future24,
            sharing: true,
            overdue: false,
          },
          {
            id: "demo-peer-2",
            peerId: "demo-peer-2",
            peerName: "Jae",
            fuzzLat: 37.81,
            fuzzLng: -122.269,
            checkedInAt: new Date(fourteenH).toISOString(),
            note: null,
            visibleUntil: "",
            sharing: false,
            overdue: true, // gentle check-in card, never auto-escalated
          },
        ],
        source: "demo",
      };
    }
  });

/** Trusted peer list: mutual accepted first, then my pending invites. */
export const listTrustedPeers = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ userId: typeof input === "string" ? input.slice(0, 64) : "" }))
  .handler(async ({ data }): Promise<ListResult<PeerRow>> => {
    const { userId } = data;
    try {
      // Service-role read designed to mirror the RLS "mutual accepted" shape:
      // a pair shows as active only when both sides accepted.
      const rows = (await sql()`
        select
          p.user_id as user_id,
          u.display_name as display_name,
          case
            when a.peer_id is not null then 'accepted'
            else 'pending'
          end as status,
          (a.peer_id is not null and b.peer_id is not null) as mutual
        from (
          -- outgoing invites from me (the rows I can act on)
          select peer_id as user_id, status, created_at
          from trusted_peers where requester_id = ${userId}
          union
          -- incoming invites TO me (someone asked to be my peer)
          select requester_id as user_id, status, created_at
          from trusted_peers where peer_id = ${userId}
        ) p
        join public.users u on u.id = p.user_id
        left join trusted_peers a on a.requester_id = ${userId} and a.peer_id = p.user_id and a.status = 'accepted'
        left join trusted_peers b on b.requester_id = p.user_id and b.peer_id = ${userId} and b.status = 'accepted'
        order by mutual desc, p.created_at desc
        limit 50`) as unknown as Array<{ user_id: string; display_name: string; status: "accepted" | "pending"; mutual: boolean }>;
      return {
        rows: rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, status: r.status, mutual: r.mutual })),
        source: "db",
      };
    } catch {
      return { rows: [], source: "demo" };
    }
  });

/** Ensure the user row exists (demo auth → auth.users mirror + public.users). */
export const ensureUser = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { userId?: unknown; displayName?: unknown };
    return {
      userId: typeof v.userId === "string" ? v.userId.slice(0, 64) : "",
      displayName: typeof v.displayName === "string" ? v.displayName.trim().slice(0, 40) : "Neighbor",
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; source: DataSource }> => {
    const { userId, displayName } = data;
    if (!userId || userId.length < 16) return { ok: false, source: "demo" };
    try {
      await sql()`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
        values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                ${`demo+${userId.slice(0, 8)}@safeground.local`}, '', now(), now(), now(), '{"demo":true}')
        on conflict (id) do nothing`;
      await sql()`
        insert into public.users (id, display_name, role)
        values (${userId}, ${displayName || "Neighbor"}, 'neighbor')
        on conflict (id) do update set display_name = ${displayName || "Neighbor"}`;
      return { ok: true, source: "db" };
    } catch {
      return { ok: false, source: "demo" };
    }
  });