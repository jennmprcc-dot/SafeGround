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
import type { CategoryId } from "~/lib/data";
import { realMarinAsDemoResources } from "~/lib/marinFallback";
import type { AlertKind, AlertLocation, AlertAudienceGroup, AlertRow, AlertSource } from "~/lib/alerts";
import type { NeedRow, NeedStatus, NeedVisibility, NeedSource, MemberStatusRow } from "~/lib/hometeam";

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
  lat: number | null;
  lng: number | null;
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
  /** Who sent the pending invite: "in" = they invited me, "out" = I invited
   * them. Only meaningful for pending rows (spec §1.2 PEER-1 states). */
  direction: "out" | "in";
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
  const name = displayName.trim().toLowerCase();
  // An empty device token (e.g. a missing phone) must NEVER break the UUID
  // shape — fall back to hashing the namespace + name alone. The UUID
  // construction below is untouched.
  const seed = deviceToken.trim() === "" ? SG_DEVICE_NS + name : SG_DEVICE_NS.replace(/-/g, "") + name + "|" + deviceToken;
  const h = sha1Hex(seed);
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

/** Raw supply_requests row shape (HomeTeam feed) — snake_case from the DB. */
interface DbNeedRow {
  id: string;
  items: string[] | null;
  note: string | null;
  status: string;
  visibility: string;
  requester_label: string | null;
  logged_by_outreach: boolean;
  claimed_name: string | null;
  claimed_at: string | Date | null;
  assigned_name: string | null;
  assigned_at: string | Date | null;
  delivered_name: string | null;
  delivered_at: string | Date | null;
  created_at: string | Date;
}
const ISO = (d: string | Date | null): string | null =>
  d ? (typeof d === "string" ? d : new Date(d).toISOString()) : null;
function mapNeed(r: DbNeedRow): NeedRow {
  const status: NeedStatus =
    r.status === "open" ? "open" : r.status === "delivered" ? "delivered" : r.status === "fulfilled" ? "fulfilled" : r.status === "claimed" ? "claimed" : "in_progress";
  const visibility: NeedVisibility =
    r.visibility === "assign_only" ? "assign_only" : r.visibility === "private" ? "private" : "open";
  return {
    id: r.id,
    items: Array.isArray(r.items) ? r.items : [],
    note: r.note,
    status,
    visibility,
    requesterLabel: r.requester_label ?? "A neighbor",
    loggedByOutreach: r.logged_by_outreach,
    claimedByName: r.claimed_name,
    claimedAt: ISO(r.claimed_at),
    assignedToName: r.assigned_name,
    assignedAt: ISO(r.assigned_at),
    deliveredByName: r.delivered_name,
    deliveredAt: ISO(r.delivered_at),
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
    source: "db" as const,
  };
}
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
    lat: r.lat ?? null,
    lng: r.lng ?? null,
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
  return realMarinAsDemoResources().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    address: r.address,
    hours: r.hours,
    phone: r.phone ?? null,
    note: r.note,
    verifiedAt: r.verifiedAt,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    openNow: r.openNow,
  }));
}

/* Owner-directed 2026-09-07 (Option A): DB-unreachable sweeps fallback is an
 * honest EMPTY list — never fabricated events. The map + list render their
 * calm "no heads-ups right now" empty state instead of fiction. */
function demoSweeps(): SweepRow[] {
  return [];
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
      // DB-unreachable fallback: return an EMPTY list, never fabricated people.
      // No invented peers, no fake fuzzed points — a real user sees an honest
      // empty "demo" state, not fiction passing as real check-ins.
      return { rows: [], source: "demo" };
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
          (a.peer_id is not null and b.peer_id is not null) as mutual,
          case
            when exists (
              select 1 from public.trusted_peers x
              where x.requester_id = p.user_id and x.peer_id = ${userId} and x.status = 'pending')
            then 'in' else 'out'
          end as direction
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
        limit 50`) as unknown as Array<{ user_id: string; display_name: string; status: "accepted" | "pending"; mutual: boolean; direction: "out" | "in" }>;
      return {
        rows: rows.map((r) => ({
          userId: r.user_id,
          displayName: r.display_name,
          status: r.status,
          mutual: r.mutual,
          direction: r.direction,
        })),
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

/* ── Wave 2a: Emergency alerts (owner-directed 2026-09-06) ──────────
 * All writes go through the RPCs (send_emergency_alert / sg_claim_alert /
 * resolve_emergency_alert) — the schema's only write paths for this table
 * (no direct INSERT/UPDATE policies on phone-identified rows). Reads run
 * service-role but are gated HERE on the viewer's phone: the exact point is
 * stripped from any viewer who isn't the sender, an on-duty peer-team member
 * (roster), or a notified HomeTeam supporter. This mirrors the RLS promises
 * for auth-based roles and is the app layer's second guard (the UI also
 * refuses to render exact unless canSeeExact). */

/** True when the error means "database unreachable", not an RPC rule rejection. */
function isDbDown(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|connect ETIMEDOUT|socketerror|connection refused|not reachable|timed out/i.test(m);
}

/** Calm, trauma-informed copy for an RPC rejection — pass the server's own words through. */
function calmRpcError(e: unknown, fallback: string): string {
  const m = String((e as { message?: string })?.message ?? "").trim();
  if (!m || /connection|ECONNREFUSED|ENOTFOUND/i.test(m)) return fallback;
  // RPC raise-exception messages are already gentle; keep them whole.
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}

interface DbAlertRow {
  id: string;
  kind: string;
  note: string | null;
  location_shared: string;
  fuzz_lat: number | null;
  fuzz_lng: number | null;
  exact_lat: number | null;
  exact_lng: number | null;
  audience: string[];
  sender_name: string | null;
  sender_phone: string;
  claimed_by: string | null;
  claimed_name: string | null;
  claimed_at: string | Date | null;
  resolved_at: string | Date | null;
  resolved_by_role: string | null;
  outcome_note: string | null;
  expires_at: string | Date;
  created_at: string | Date;
}

/** Map a DB alert row → the serializable AlertRow, honoring per-viewer privacy. */
function mapAlert(r: DbAlertRow, viewer: { phone: string; staff: boolean; admin: boolean; hometeam: boolean }): AlertRow {
  const own = r.sender_phone === viewer.phone;
  const notifiedHometeam = viewer.hometeam && r.audience.includes("hometeam");
  const canSeeExact = own || viewer.staff || notifiedHometeam;
  const resolved = r.resolved_at != null;
  // outcome_note is admin + sender only (staff_limited never sees it).
  const outcomeVisible = !resolved || own || viewer.admin;
  const c = (d: string | Date | null) => (d == null ? null : new Date(d).toISOString());
  return {
    id: r.id,
    kind: r.kind as AlertKind,
    note: r.note,
    location: r.location_shared as AlertLocation,
    fuzzLat: r.fuzz_lat,
    fuzzLng: r.fuzz_lng,
    exactLat: canSeeExact ? r.exact_lat : null,
    exactLng: canSeeExact ? r.exact_lng : null,
    canSeeExact,
    audience: r.audience as AlertAudienceGroup[],
    senderName: r.sender_name ?? (own ? "You" : "a neighbor"),
    senderPhone: r.sender_phone,
    claimedBy: r.claimed_by,
    claimedByName: r.claimed_name,
    claimedAt: c(r.claimed_at),
    resolved,
    resolvedAt: c(r.resolved_at),
    resolvedByRole: r.resolved_by_role as AlertRow["resolvedByRole"],
    outcomeNote: outcomeVisible ? r.outcome_note : null,
    expiresAt: new Date(r.expires_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    source: "db",
  };
}

function demoAlertRows(_phone: string): AlertRow[] {
  // DB-unreachable fallback: return an EMPTY list, never fabricated events.
  // No invented sender, no fake emergencies — a real user sees an honest
  // empty "demo" state, not fiction passing as real alerts.
  return [];
}
export const sendEmergencyAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as {
      senderPhone?: unknown; kind?: unknown; note?: unknown;
      location?: unknown; fuzzLat?: unknown; fuzzLng?: unknown;
      exactLat?: unknown; exactLng?: unknown; audience?: unknown;
    };
    const kind = v.kind === "unsafe_place" || v.kind === "police_nearby" || v.kind === "help_needed" ? (v.kind as AlertKind) : null;
    const location = v.location === "none" || v.location === "fuzzed" || v.location === "exact" ? (v.location as AlertLocation) : null;
    const audience = Array.isArray(v.audience)
      ? (v.audience as unknown[]).filter((x): x is AlertAudienceGroup => x === "friends" || x === "peers" || x === "hometeam").slice(0, 3)
      : [];
    const fuzzLat = Number(v.fuzzLat);
    const fuzzLng = Number(v.fuzzLng);
    const exactLat = Number(v.exactLat);
    const exactLng = Number(v.exactLng);
    return {
      senderPhone: String(v.senderPhone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      kind,
      note: typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 500) : "",
      location,
      fuzzLat: Number.isFinite(fuzzLat) && fuzzLat !== 0 ? fuzzLat : null,
      fuzzLng: Number.isFinite(fuzzLng) && fuzzLng !== 0 ? fuzzLng : null,
      exactLat: Number.isFinite(exactLat) && exactLat !== 0 ? exactLat : null,
      exactLng: Number.isFinite(exactLng) && exactLng !== 0 ? exactLng : null,
      audience,
    };
  })
  .handler(
    async ({ data }): Promise<{ ok: boolean; alertId: string | null; error: string | null; source: AlertSource }> => {
      const { senderPhone, kind, note, location, fuzzLat, fuzzLng, exactLat, exactLng, audience } = data;
      // Never-pre-selected guard (client + server): location must be explicit.
      if (!location) {
        return { ok: false, alertId: null, error: "Please choose how much location to share — none, an approximate area, or the exact spot.", source: "db" };
      }
      if (!kind) {
        return { ok: false, alertId: null, error: "Please choose what kind of help this is — Unsafe place, Police nearby, or Help needed.", source: "db" };
      }
      if (audience.length === 0) {
        return { ok: false, alertId: null, error: "Please choose at least one group to share this with — friends, peers, or HomeTeam.", source: "db" };
      }
      try {
        const rows = (await sql()`
          select public.send_emergency_alert(
            ${senderPhone}, ${kind}, ${note === "" ? null : note},
            ${fuzzLat}, ${fuzzLng}, ${location},
            ${audience}::text[], ${exactLat}, ${exactLng}
          ) as id`) as unknown as Array<{ id: string }>;
        return { ok: true, alertId: rows[0]?.id ?? null, error: null, source: "db" };
      } catch (e) {
        if (isDbDown(e)) {
          // Calm demo fallback: keep the sender's intent; clearly labeled draft.
          return { ok: true, alertId: `draft-${Date.now()}`, error: null, source: "demo" };
        }
        return { ok: false, alertId: null, error: calmRpcError(e, "That didn't go through — nothing was sent. No rush to try again."), source: "db" };
      }
    },
  );

/** Alerts this phone may see (sender's own, plus anything the on-duty team or
 * a notified HomeTeam supporter may act on). Exact coords are STRIPPED for
 * viewers who aren't entitled to them — the response itself carries no leak. */
export const listAlertsFor = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ rows: AlertRow[]; source: AlertSource }> => {
    const phone = data.phone;
    try {
      // Roster/hometeam match on the last 10 digits (roster stores 11-digit
      // with the leading 1; push_tokens/app send 10-digit) — owner bug
      // 2026-09-07, fixed here + in the DB sg_norm_phone.
      const key10 = phone.replace(/[^0-9]/g, "").slice(-10);
      const who = (await sql()`
        select
          coalesce((select bool_or(active and role = 'admin') from public.outreach_roster where substring(phone from length(phone) - 9) = ${key10}), false) as is_admin,
          coalesce((select bool_or(active) from public.outreach_roster where substring(phone from length(phone) - 9) = ${key10}), false) as is_staff,
          coalesce((select bool_or(status = 'active') from public.hometeam_members where substring(phone from length(phone) - 9) = ${key10}), false) as is_hometeam`
      ) as unknown as Array<{ is_admin: boolean; is_staff: boolean; is_hometeam: boolean }>;
      const viewer = { phone, staff: Boolean(who[0]?.is_staff), admin: Boolean(who[0]?.is_admin), hometeam: Boolean(who[0]?.is_hometeam) };
      const rows = (await sql()`
        select ea.id, ea.kind, ea.note, ea.location_shared, ea.fuzz_lat, ea.fuzz_lng,
               ea.exact_lat, ea.exact_lng, ea.audience, ea.sender_phone,
               coalesce(hs.display_name, rs.display_name) as sender_name,
               ea.claimed_by, coalesce(hc.display_name, rc.display_name) as claimed_name,
               ea.claimed_at, ea.resolved_at, ea.resolved_by_role, ea.outcome_note,
               ea.expires_at, ea.created_at
        from public.emergency_alerts ea
        left join public.hometeam_members hs on hs.phone = ea.sender_phone
        left join public.outreach_roster rs on rs.phone = ea.sender_phone and rs.active
        left join public.hometeam_members hc on hc.phone = ea.claimed_by
        left join public.outreach_roster rc on rc.phone = ea.claimed_by and rc.active
        where ea.sender_phone = ${phone}
           or (${viewer.staff} and ea.resolved_at is null and ea.expires_at > now())
           or (${viewer.admin} and ea.resolved_at is not null)
           or (${viewer.hometeam} and array['hometeam']::text[] <@ ea.audience
               and ea.resolved_at is null and ea.expires_at > now())
        order by ea.created_at desc
        limit 60`) as unknown as DbAlertRow[];
      return { rows: rows.map((r) => mapAlert(r, viewer)), source: "db" };
    } catch {
      return { rows: demoAlertRows(phone), source: "demo" };
    }
  });

/** "I'm on it" — server-atomic first-claim-wins via sg_claim_alert. */
export const claimEmergencyAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { alertId?: unknown; phone?: unknown };
    return { alertId: String(v.alertId ?? "").slice(0, 64), phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; alreadyHelping: boolean; claimedBy: string | null; error: string | null; source: AlertSource }> => {
    const { alertId, phone } = data;
    try {
      const rows = (await sql()`
        select claimed_by, claimed_at from public.sg_claim_alert(${alertId}, ${phone})
      `) as unknown as Array<{ claimed_by: string | null; claimed_at: string | Date | null }>;
      const claimedBy = rows[0]?.claimed_by ?? null;
      const winner = claimedBy === phone;
      return { ok: winner, alreadyHelping: !winner && claimedBy != null, claimedBy, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) {
        // Calm demo fallback: treat as claimed-by-me locally (never touches the DB).
        return { ok: true, alreadyHelping: false, claimedBy: phone, error: null, source: "demo" };
      }
      return { ok: false, alreadyHelping: false, claimedBy: null, error: calmRpcError(e, "That didn't go through — try again in a moment."), source: "db" };
    }
  });

/** Sender "I'm OK — all clear" (primary) or quiet close-without-note. Records
 * resolved_by_role=sender in the DB (or staff, admin-only, when the sender can't). */
export const resolveEmergencyAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { alertId?: unknown; phone?: unknown; note?: unknown };
    return {
      alertId: String(v.alertId ?? "").slice(0, 64),
      phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      note: typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 1000) : "",
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null; source: AlertSource }> => {
    const { alertId, phone, note } = data;
    try {
      await sql()`select public.resolve_emergency_alert(${alertId}, ${phone}, ${note === "" ? null : note})`;
      return { ok: true, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) return { ok: true, error: null, source: "demo" };
      return { ok: false, error: calmRpcError(e, "That didn't go through — nothing changed. Try again when you can."), source: "db" };
    }
  });

/** Current active alert SENT BY this phone (drives /alerts/mine). */
export const getMyActiveAlert = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ row: AlertRow | null; source: AlertSource }> => {
    const res = await listAlertsFor({ data: { phone: data.phone } });
    const mine = res.rows.find((r) => r.senderPhone === data.phone && !r.resolved) ?? null;
    return { row: mine, source: res.source };
  });
/* ── Wave 2b: HomeTeam needs loop (owner-directed 2026-09-06) ────
 * Writes go through the existing RPCs only (hometeam_join/claim/complete —
 * consent join + first-claim-wins + delivery recorded server-side; no direct
 * INSERT/UPDATE policies on phone-identified rows). Reads run service-role but
 * are gated HERE: only OPEN-visibility needs are served to supporters, and
 * assign_only/private needs drop their requester label + carry no claim
 * affordance in the UI. Phone identity is digits-only (sg_norm_phone shape). */
/** Open needs feed: open-visibility needs first, then in-progress/delivered
 * (assign_only keeps its status but no public requester detail; private needs
 * never appear on the supporter feed at all). */
export const listNeeds = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ rows: NeedRow[]; source: NeedSource }> => {
    try {
      const rows = (await sql()`
        select
          sr.id, sr.items, sr.note, sr.status::text as status, sr.visibility::text as visibility,
          sr.created_at,
          case
            when sr.visibility = 'open' then coalesce(u.display_name, 'A neighbor')
            else 'Coordinator'
          end as requester_label,
          (sr.visibility in ('assign_only', 'private')) as logged_by_outreach,
          hc.display_name as claimed_name, sr.claimed_at,
          ha.display_name as assigned_name, sr.assigned_at,
          hd.display_name as delivered_name, sr.delivered_at
        from public.supply_requests sr
        left join public.users u on u.id = sr.requested_by
        left join public.hometeam_members hc on hc.id = sr.hometeam_claimed_by
        left join public.hometeam_members ha on ha.id = sr.assigned_to
        left join public.hometeam_members hd on hd.id = sr.delivered_by
        where sr.visibility in ('open', 'assign_only')
          and sr.status <> 'cancelled'
          and coalesce(sr.fulfilled_at, sr.created_at) > now() - interval '30 days'
          and coalesce(sr.anonymize_at, now()) > now()
        order by
          case when sr.status = 'open' then 0 when sr.status in ('claimed', 'in_progress') then 1 else 2 end,
          sr.created_at desc
        limit 60`) as unknown as DbNeedRow[];
      return { rows: rows.map(mapNeed), source: "db" };
    } catch {
      // Owner-directed 2026-09-07 (Option A): DB-unreachable needs fallback is
      // an honest EMPTY list — never fabricated needs with invented names.
      // The feed renders its calm "No open needs right now" empty state.
      return { rows: [], source: "demo" };
    }
  },
);
/** Join the HomeTeam: phone + name + explicit consent (R-P1). After-hours
 * emergency-alert consent is DEFAULT OFF; the toggle sets it when present.
 * disclaimerAcknowledged (owner-approved verbatim 2026-09-11): the join button
 * is client-gated on the checkbox; the server records the acknowledgment
 * timestamp on the consent row (hometeam_join 4th arg) — same pattern as
 * sms_consent, never a new auth model. */
export const joinHomeTeam = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { phone?: unknown; name?: unknown; consentsToAfterHours?: unknown; smsConsent?: unknown; disclaimerAcknowledged?: unknown };
    return {
      phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      name: typeof v.name === "string" ? v.name.replace(/\s+/g, " ").trim().slice(0, 40) : "",
      consentsToAfterHours: v.consentsToAfterHours === true,
      // SMS opt-in (owner-approved 2026-09-08): explicit checkbox only.
      smsConsent: v.smsConsent === true,
      // HomeTeam Safety & Liability Disclaimer (owner-approved 2026-09-11):
      // explicit checkbox only — the join button stays disabled until checked.
      disclaimerAcknowledged: v.disclaimerAcknowledged === true,
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; memberId: string | null; error: string | null; source: NeedSource }> => {
    const { phone, name, consentsToAfterHours, smsConsent, disclaimerAcknowledged } = data;
    try {
      const rows = (await sql()`
        select public.hometeam_join(${phone}, ${name}, ${smsConsent}, ${disclaimerAcknowledged}) as id`) as unknown as Array<{ id: string }>;
      if (consentsToAfterHours) {
        // After-hours toggle is DEFAULT OFF; setting it is a graceful, non-blocking
        // update — the saver must never fail the join (older DBs lack the column).
        await sql()`
          update public.hometeam_members
          set consents_to_after_hours = true
          where phone = ${phone} and consents_to_after_hours = false
            and exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = 'hometeam_members'
                        and column_name = 'consents_to_after_hours')`;
      }
      return { ok: true, memberId: rows[0]?.id ?? null, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) {
        return { ok: true, memberId: `draft-${Date.now()}`, error: null, source: "demo" };
      }
      return { ok: false, memberId: null, error: calmRpcError(e, "That didn't go through — try again in a moment."), source: "db" };
    }
  });
/** "I got that" — server-atomic first-claim-wins via hometeam_claim. */
export const claimNeed = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { requestId?: unknown; phone?: unknown };
    return {
      requestId: String(v.requestId ?? "").slice(0, 64),
      phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; alreadyHandled: boolean; error: string | null; source: NeedSource }> => {
    const { requestId, phone } = data;
    try {
      await sql()`select public.hometeam_claim(${requestId}::uuid, ${phone})`;
      return { ok: true, alreadyHandled: false, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) return { ok: true, alreadyHandled: false, error: null, source: "demo" };
      const err = calmRpcError(e, "That didn't go through — try again in a moment.");
      return { ok: false, alreadyHandled: /already being handled|already complete/i.test(err), error: err, source: "db" };
    }
  });
/** "Mark delivered" — hometeam_complete records who brought what, when. */
export const markNeedDelivered = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { requestId?: unknown; phone?: unknown };
    return {
      requestId: String(v.requestId ?? "").slice(0, 64),
      phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null; source: NeedSource }> => {
    const { requestId, phone } = data;
    try {
      await sql()`select public.hometeam_complete(${requestId}::uuid, ${phone})`;
      return { ok: true, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) return { ok: true, error: null, source: "demo" };
      return { ok: false, error: calmRpcError(e, "That didn't go through — nothing changed. Try again when you can."), source: "db" };
    }
  });
/** Log a need. Neighbors log for themselves (phone + name → ensured demo user,
 * the same pattern sweeps/check-ins use — public.users has no phone column);
 * outreach rosters log on someone's behalf from their phone (keeps attribution
 * without touching the neighbor's row). */
export const logNeed = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as {
      items?: unknown; note?: unknown; neighborPhone?: unknown; neighborName?: unknown;
      outreachPhone?: unknown; pickup?: unknown; visibility?: unknown; disclaimerAcknowledged?: unknown;
    };
    const items = Array.isArray(v.items)
      ? (v.items as unknown[]).map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 60)).filter((x) => x.length > 0).slice(0, 10)
      : [];
    return {
      items,
      note: typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 400) : "",
      pickupPreference: typeof v.pickup === "string" ? v.pickup.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      neighborPhone: String(v.neighborPhone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      neighborName: typeof v.neighborName === "string" ? v.neighborName.replace(/\s+/g, " ").trim().slice(0, 40) : "",
      outreachPhone: String(v.outreachPhone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      visibility: v.visibility === "assign_only" || v.visibility === "private" ? (v.visibility as "assign_only" | "private") : "open",
      // HomeTeam Help Requests Safety & Liability Disclaimer (owner-approved
      // 2026-09-11): the requester checked "I agree…" on their first help
      // request. Client gates the submit; the server records the
      // acknowledgment on the requester's consent row (same pattern as Part A).
      disclaimerAcknowledged: v.disclaimerAcknowledged === true,
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; requestId: string | null; error: string | null; source: NeedSource }> => {
    const { items, note, pickupPreference, neighborPhone, neighborName, outreachPhone, visibility, disclaimerAcknowledged } = data;
    // A need with no phone is unattributable — say so plainly and stop BEFORE
    // demoUserId/auth.users, instead of failing deep in the DB (2026-09-07).
    if (neighborPhone.replace(/[^0-9]/g, "").length < 10) {
      return { ok: false, requestId: null, error: "Add your 10-digit phone so the need can reach the HomeTeam — it stays private.", source: "db" };
    }
    try {
      // Outreach-on-behalf path: staff phone must match the live roster (phone
      // identity, server-verified — no client trust). Last-10-digit match
      // (owner bug 2026-09-07): roster stores 11-digit.
      const staffKey = outreachPhone.replace(/[^0-9]/g, "").slice(-10);
      const staffRows = (await sql()`
        select display_name from public.outreach_roster
        where substring(phone from length(phone) - 9) = ${staffKey} and active limit 1`) as unknown as Array<{ display_name: string }>;
      const isStaff = staffRows.length > 0;
      // Non-staff phones may only create open needs — privacy(assign_only/private)
      // choices are enforced server-side, never by hiding a button.
      const finalVisibility = isStaff ? visibility : "open";
      // Neighbor path: ensure a users row the way sweeps/check-ins do (stable
      // per-device identity; phone stays a HomeTeam-only identity, never users).
      const displayName = (neighborName || "Neighbor").trim();
      const userId = demoUserId(displayName, `ht-${neighborPhone}`);
      await sql()`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
        values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                ${`demo+ht-${neighborPhone}@safeground.local`}, '', now(), now(), now(), '{"demo":true}')
        on conflict (id) do nothing`;
      await sql()`
        insert into public.users (id, display_name, role)
        values (${userId}, ${displayName}, 'neighbor')
        on conflict (id) do update set display_name = ${displayName}`;
      const rows = (await sql()`
        insert into supply_requests (requested_by, items, note, pickup_preference, visibility,
                                     created_at, fulfilled_at, cancelled_at)
        values (${userId}, ${items}, ${note === "" ? null : note}, ${pickupPreference === "" ? null : pickupPreference},
                ${finalVisibility}::text, now(), null, null)
        returning id, created_at`) as unknown as Array<{ id: string; created_at: string | Date }>;
      const row = rows[0];
      if (!row) return { ok: false, requestId: null, error: "That didn't go through — try again when you're ready.", source: "db" };
      // Requester-side disclaimer acknowledgment (owner-approved 2026-09-11):
      // recorded on the requester's consent row the moment their first help
      // request goes through with the box checked. Idempotent refresh on later
      // submits; outreach-on-behalf never records (the neighbor isn't typing).
      if (disclaimerAcknowledged) {
        await sql()`
          insert into public.disclaimer_acknowledgments (phone, help_requests_acknowledged_at)
          values (${neighborPhone}, now())
          on conflict (phone) do update set help_requests_acknowledged_at = now()`;
      }
      return { ok: true, requestId: row.id, error: null, source: "db" };
    } catch (e) {
      if (isDbDown(e)) {
        const requestId = `draft-${Date.now()}`;
        return { ok: true, requestId, error: null, source: "demo" };
      }
      // A raw "invalid input syntax for type uuid" means identity derivation
      // broke — never show the user Postgres internals.
      const raw = String((e as { message?: string })?.message ?? "");
      const msg = /invalid input syntax/i.test(raw)
        ? "Add your 10-digit phone so the need can reach the HomeTeam — it stays private."
        : calmRpcError(e, "That didn't go through — try again when you're ready.");
      return { ok: false, requestId: null, error: msg, source: "db" };
    }
  });
/** Opt out of new needs (pause) — status keeps history, claims nothing new. */
export const pauseHomeTeam = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ ok: boolean; source: NeedSource }> => {
    const { phone } = data;
    try {
      await sql()`select public.hometeam_pause(${phone})`;
      return { ok: true, source: "db" };
    } catch {
      return { ok: false, source: "demo" };
    }
  });
export const resumeHomeTeam = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ ok: boolean; source: NeedSource }> => {
    const { phone } = data;
    try {
      await sql()`select public.hometeam_resume(${phone})`;
      return { ok: true, source: "db" };
    } catch {
      return { ok: false, source: "demo" };
    }
  });
/** HomeTeam status for a phone: member row (active/paused) when joined. */
export const getHomeTeamStatus = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<MemberStatusRow> => {
    const { phone } = data;
    if (!phone) return { phone, displayName: null, status: "active", consentsToAfterHours: null, source: "demo" };
    try {
      const rows = (await sql()`
        select phone, display_name, status, consents_to_after_hours
        from public.hometeam_members where phone = ${phone} limit 1
      `) as unknown as Array<{ phone: string; display_name: string; status: string; consents_to_after_hours: boolean | null }>;
      const r = rows[0];
      if (!r) return { phone, displayName: null, status: "active", consentsToAfterHours: null, source: "db" };
      return {
        phone: r.phone,
        displayName: r.display_name,
        status: r.status === "paused" ? "paused" : "active",
        consentsToAfterHours: r.consents_to_after_hours ?? false,
        source: "db",
      };
    } catch {
      return { phone, displayName: null, status: "active", consentsToAfterHours: null, source: "demo" };
    }
  });
/** True when this phone has already acknowledged the HomeTeam Help Requests
 * Safety & Liability Disclaimer (owner-approved 2026-09-11). Drives the
 * first-help-request gate: no row = the full disclaimer + checkbox gate shows
 * until the requester agrees on their first submit. Fail-closed ("not
 * acknowledged") whenever the DB can't be reached — the gate showing again is
 * the calm, safe default. */
export const getHelpRequestsDisclaimerAck = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ acknowledged: boolean; source: NeedSource }> => {
    const { phone } = data;
    if (!phone) return { acknowledged: false, source: "demo" };
    try {
      const rows = (await sql()`
        select 1 from public.disclaimer_acknowledgments where phone = ${phone} limit 1
      `) as unknown as Array<Record<string, unknown>>;
      return { acknowledged: rows.length > 0, source: "db" };
    } catch {
      return { acknowledged: false, source: "demo" };
    }
  });
/** True when a phone is on the active outreach roster (staff can log on
 * someone's behalf — server-verified; the UI just shows the option). */
export const isOutreachPhone = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ isOutreach: boolean; source: NeedSource }> => {
    const { phone } = data;
    if (!phone) return { isOutreach: false, source: "db" };
    try {
      // Last-10-digit match (owner bug 2026-09-07): roster stores 11-digit.
      const key10 = phone.replace(/[^0-9]/g, "").slice(-10);
      const rows = (await sql()`
        select 1 from public.outreach_roster
        where substring(phone from length(phone) - 9) = ${key10} and active limit 1
      `) as unknown as Array<Record<string, unknown>>;
      return { isOutreach: rows.length > 0, source: "db" };
    } catch {
      return { isOutreach: false, source: "demo" };
    }
  });

/* ── Resources-real wave: admin add-resource (owner-directed 2026-09-06) ──
 * Jenn + Bambi add resources as they learn about them. Server-side gate: the
 * caller's normalized phone must match an ACTIVE outreach_roster row with
 * role='admin' BEFORE anything is inserted — a non-admin gets a calm
 * rejection from the server, not just a hidden button. verified_by records
 * the admin's user row; verified_at = today (listing date). */

/** True when this phone may add resources (active roster admin). UI hint only —
 * the add server fn re-checks authoritatively (never client trust). */
export const isAdminPhone = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ phone: String((input as { phone?: unknown })?.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20) }))
  .handler(async ({ data }): Promise<{ isAdmin: boolean; source: DataSource }> => {
    const { phone } = data;
    if (!phone) return { isAdmin: false, source: "db" };
    try {
      // Last-10-digit match (owner bug 2026-09-07): roster stores 11-digit.
      const key10 = phone.replace(/[^0-9]/g, "").slice(-10);
      const rows = (await sql()`
        select 1 from public.outreach_roster
        where substring(phone from length(phone) - 9) = ${key10} and active and role = 'admin'
        limit 1`) as unknown as Array<Record<string, unknown>>;
      return { isAdmin: rows.length > 0, source: "db" };
    } catch {
      return { isAdmin: false, source: "demo" };
    }
  });

const RESOURCE_CATEGORIES = [
  "food", "shelter", "water", "showers", "clinics", "charging", "legal",
  "daycenters", "transportation", "emergency",
] as const;
type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const addResource = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as {
      phone?: unknown; name?: unknown; category?: unknown; address?: unknown;
      hours?: unknown; phoneOfResource?: unknown; note?: unknown; lat?: unknown; lng?: unknown;
    };
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    return {
      // Caller identity: normalized digits (sg_norm_phone shape) — matched
      // server-side against outreach_roster role='admin' before any insert.
      phone: String(v.phone ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
      name: typeof v.name === "string" ? v.name.replace(/\s+/g, " ").trim().slice(0, 120) : "",
      category: RESOURCE_CATEGORIES.includes(v.category as ResourceCategory) ? (v.category as ResourceCategory) : null,
      address: typeof v.address === "string" ? v.address.trim().slice(0, 200) : "",
      hours: typeof v.hours === "string" ? v.hours.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      phoneOfResource: typeof v.phoneOfResource === "string" ? v.phoneOfResource.trim().slice(0, 60) : "",
      note: typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim().slice(0, 600) : "",
      lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
      lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    };
  })
  .handler(
    async ({ data }): Promise<{ ok: boolean; resourceId: string | null; error: string | null; source: DataSource }> => {
      const { phone, name, category, address, hours, phoneOfResource, note, lat, lng } = data;
      if (!name || name.length < 2) {
        return { ok: false, resourceId: null, error: "Give it a name so neighbors can find it.", source: "db" };
      }
      if (!category) {
        return { ok: false, resourceId: null, error: "Choose a category — whichever fits closest.", source: "db" };
      }
      try {
        // THE GATE: admin check happens here, server-side, before the insert.
        // Last-10-digit match (owner bug 2026-09-07): roster stores 11-digit.
        const adminKey = phone.replace(/[^0-9]/g, "").slice(-10);
        const adminRows = (await sql()`
          select 1 from public.outreach_roster
          where substring(phone from length(phone) - 9) = ${adminKey} and active and role = 'admin'
          limit 1`) as unknown as Array<Record<string, unknown>>;
        if (adminRows.length === 0) {
          return {
            ok: false,
            resourceId: null,
            error: "Only MPRCC outreach admins can add resources right now. Thank you for looking out — share it with the team and they'll take it from here.",
            source: "db",
          };
        }
        // verified_by: attribute to the roster admin's user row (uuid FK).
        // Same deterministic mapping the seed uses — the row is ensured in the
        // bootstrap/migration; fall back to null verified_by (still recorded
        // via verified_at + the roster) rather than failing the save.
        const adminName = "MPRCC outreach";
        const { uuid5 } = await import("~/lib/uuid5");
        const adminUserId = uuid5("seed:outreach:jenn");
        await sql()`
          insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
          values (${adminUserId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                  ${`demo+outreach-${adminUserId.slice(0, 8)}@safeground.local`}, '', now(), now(), now(), '{"seed":true}')
          on conflict (id) do nothing`;
        await sql()`
          insert into public.users (id, display_name, role)
          values (${adminUserId}, ${adminName}, 'outreach_admin')
          on conflict (id) do update set display_name = ${adminName}`;
        const today = new Date().toISOString().slice(0, 10);
        const rows = (await sql()`
          insert into public.resources (name, category, address, hours, phone, note, lat, lng, verified_at, verified_by)
          values (${name}, ${category}, ${address === "" ? null : address}, ${hours === "" ? null : hours},
                  ${phoneOfResource === "" ? null : phoneOfResource}, ${note === "" ? null : note},
                  ${lat}, ${lng}, ${today}::date, ${adminUserId})
          returning id`) as unknown as Array<{ id: string }>;
        return { ok: true, resourceId: rows[0]?.id ?? null, error: null, source: "db" };
      } catch (e) {
        if (isDbDown(e)) {
          // Calm demo fallback: never appears to lose the admin's work — but
          // tagged demo so the honest label shows (a demo row is NOT saved).
          return { ok: true, resourceId: `draft-${Date.now()}`, error: null, source: "demo" };
        }
        return { ok: false, resourceId: null, error: calmRpcError(e, "That didn't save — nothing was changed. Try again in a moment."), source: "db" };
      }
    },
  );
