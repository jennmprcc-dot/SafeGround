/**
 * SafeGround database bootstrap — schema apply + demo seed (server-only).
 *
 * Used two ways:
 *  1. `bun scripts/apply-schema.ts` / `bun scripts/seed.ts` — one-shot ops scripts.
 *  2. `bootstrapSchema()` server fn (src/lib/server.ts) — idempotent self-heal,
 *     gated behind ALLOW_DB_BOOTSTRAP=1 (see src/routes/api/admin/bootstrap.ts).
 *
 * Everything here is idempotent: already-present objects are skipped, and seed
 * rows use deterministic UUIDv5 ids with ON CONFLICT DO NOTHING, so re-running
 * never duplicates.
 *
 * NOTE: this source file deliberately avoids literal double-dollar sequences,
 * because they collide with shell-style templating in the authoring toolchain.
 * SQL dollar-quoting is built at runtime or via single-quoted bodies.
 */
import { createHash } from "node:crypto";
import { sql } from "~/db";
import { DEMO_RESOURCES, DEMO_SWEEPS } from "~/lib/data";

/* ── Statement splitting ──────────────────────────────────────────
 * schema.sql contains semicolons inside string literals (the privacy-comment
 * block) and a dollar-quoted function body, so a naive "split on ;" breaks.
 * This scanner tracks line comments, block comments, single-quoted strings
 * ('' escapes) and dollar-quoted spans, and only splits on bare semicolons. */
const DOLLAR_TAG_RE = /^\$[A-Za-z0-9_]*\$/;

export function splitStatements(sqlText: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sqlText.length;
  let dollarTag = "";
  while (i < n) {
    const ch = sqlText[i];
    const two = sqlText.slice(i, i + 2);
    if (dollarTag) {
      if (sqlText.startsWith(dollarTag, i)) {
        cur += dollarTag;
        i += dollarTag.length;
        dollarTag = "";
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (two === "--") {
      const end = sqlText.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      cur += sqlText.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = sqlText.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      cur += sqlText.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'") {
      // copy the whole literal including '' escapes
      let j = i + 1;
      while (j < n) {
        if (sqlText[j] === "'" && sqlText[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sqlText[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      cur += sqlText.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "$") {
      const m = DOLLAR_TAG_RE.exec(sqlText.slice(i));
      if (m) {
        dollarTag = m[0];
        cur += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  const trimmed = cur.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

/* ── auth.uid() compatibility shim ─────────────────────────────────
 * schema.sql's RLS policies reference auth.uid() (Supabase Auth). If the auth
 * schema isn't provisioned in this Postgres yet, install a MINIMAL shim that
 * returns NULL — anon-like, never grants anything. Policies are NOT weakened:
 * every owner/outreach clause simply evaluates against a NULL uid until real
 * Supabase Auth lands (Wave 2), at which point the shim is deleted and the
 * real function takes over unchanged. */
const AUTH_SHIM = [
  `create schema if not exists auth`,
  // Single-quoted body is safe: the body itself contains no single quotes.
  `create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid'`,
];

/** Vite inlines `?raw` imports; Bun scripts read the file from disk. */
async function loadSchemaText(): Promise<string> {
  try {
    const mod = (await import("~/../schema.sql?raw")) as unknown as { default: string };
    return mod.default;
  } catch {
    const { readFileSync } = await import("node:fs");
    const path = new URL("../../schema.sql", import.meta.url).pathname;
    return readFileSync(path, "utf8");
  }
}

async function authSchemaMissing(): Promise<boolean> {
  const rows = await sql()`select 1 as one from pg_namespace where nspname = 'auth' limit 1`;
  return rows.length === 0;
}

function isAlreadyExists(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  // 42710 duplicate_object, 42P07 duplicate_table, 42701 duplicate_column,
  // 42723 duplicate_function, 42P06 duplicate_schema
  return (
    ["42710", "42P07", "42701", "42723", "42P06"].includes(err?.code ?? "") ||
    /already exists/i.test(err?.message ?? "")
  );
}

export interface SchemaApplyResult {
  applied: number;
  skipped: number;
  shimInstalled: boolean;
  statements: Array<{ ok: boolean; info: string }>;
}

export async function applySchema(): Promise<SchemaApplyResult> {
  // The repo copy (site/schema.sql) is identical to the shared artifact.
  // Load raw: Vite inlines it via ?raw for the server bundle; Bun scripts fall
  // back to reading the file from disk.
  const schemaSql = await loadSchemaText();
  const statements = splitStatements(schemaSql);
  const useShim = await authSchemaMissing();
  const result: SchemaApplyResult = { applied: 0, skipped: 0, shimInstalled: false, statements: [] };
  const run = async (stmt: string, label: string) => {
    try {
      await sql()(stmt as never);
      result.applied += 1;
      result.statements.push({ ok: true, info: label });
    } catch (e) {
      if (isAlreadyExists(e)) {
        result.skipped += 1;
        result.statements.push({ ok: true, info: `${label} (already exists)` });
      } else {
        throw e;
      }
    }
  };
  if (useShim) {
    for (const stmt of AUTH_SHIM) await run(stmt, "auth shim");
    result.shimInstalled = true;
  }
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 60);
    await run(stmt, label);
  }
  return result;
}

/* ── Seed: the SAME fictional demo data, clearly marked ──────────── */

/** Deterministic UUIDv5 in a SafeGround namespace — stable across runs. */
const SG_NS = "a7e40a32-4f2e-5f6a-9d0e-6b1c2d3e4f50"; // safeground-seed namespace
function uuid5(name: string): string {
  const h = createHash("sha1").update(SG_NS.replace(/-/g, ""), "hex").update(name).digest();
  const b = Uint8Array.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Next Friday 08:00 local (for the "Planned · Fri 8am" demo sweep). */
function nextFriday8am(): Date {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 5);
  return d;
}

export interface SeedResult {
  resourcesInserted: number;
  sweepsInserted: number;
  resourcesTotal: number;
  sweepsTotal: number;
  hometeamTotal: number;
  needsTotal: number;
  alertsTotal: number;
  rosterTotal: number;
}

export async function seedDemoData(): Promise<SeedResult> {
  const now = Date.now();
  const min = (m: number) => new Date(now - m * 60_000);

  for (const r of DEMO_RESOURCES) {
    await sql()`
      insert into resources (id, name, category, address, hours, phone, note, lat, lng, verified_at, verified_by)
      values (${uuid5("resource:" + r.id)}, ${r.name}, ${r.category}, ${r.address}, ${r.hours},
              ${r.phone ?? null}, ${r.note}, ${r.lat}, ${r.lng}, ${r.verifiedAt}::date, null)
      on conflict (id) do nothing`;
  }

  for (const s of DEMO_SWEEPS) {
    // Map demo sweep → schema lifecycle: reported/verified status + severity enum.
    const createdAt = min(s.reportedMinutesAgo);
    const isActive = s.status === "active";
    const isPlanned = s.status === "planned";
    const dbStatus = s.status === "resolved" ? "verified" : s.verified ? "verified" : "reported";
    const severity = s.status === "resolved" ? "resolved_recent" : isActive ? "active" : "planned";
    const eventAt = isPlanned ? nextFriday8am() : isActive ? createdAt : min(s.reportedMinutesAgo);
    const resolvedAt = s.status === "resolved" ? createdAt : null;
    const verifiedAt = s.verified ? createdAt : null;
    await sql()`
      insert into sweeps (id, reported_by, status, severity, event_at, resolved_at, lat, lng, note, verified_at, verified_by, created_at)
      values (${uuid5("sweep:" + s.id)}, null, ${dbStatus}::sweep_status, ${severity}::sweep_severity,
              ${eventAt.toISOString()}, ${resolvedAt ? resolvedAt.toISOString() : null},
              ${s.lat}, ${s.lng}, ${s.note},
              ${verifiedAt ? verifiedAt.toISOString() : null}, null, ${createdAt.toISOString()})
      on conflict (id) do nothing`;
  }

  const r1 = await sql()`select count(*)::int as n from resources`;
  const r2 = await sql()`select count(*)::int as n from sweeps`;

  // ── HomeTeam wave seed (idempotent, same fictional-demo style) ──
  // Two demo supporters with explicit consent + one open need + one resolved
  // demo alert. The need's location is a place NAME only ("Skatepark,
  // San Rafael") — no pin, no coordinates (privacy-first demo shapes).
  // requested_by needs a users row: reuse a deterministic demo neighbor.
  const janePhone = "14155550101";
  const baoPhone = "14155550102";
  const joePhone = "14155550103";
  const seedUserId = uuid5("seed:neighbor:joe");
  try {
    await sql()`
      insert into auth.users (id, email)
      values (${seedUserId}, ${`demo+${seedUserId.slice(0, 8)}@safeground.local`})
      on conflict (id) do nothing`;
  } catch { /* auth.users may be locked down; public.users insert below still works if the FK allows */ }
  await sql()`
    insert into public.users (id, display_name, role)
    values (${seedUserId}, 'Joe (demo)', 'neighbor')
    on conflict (id) do nothing`;
  await sql()`select public.hometeam_join(${janePhone}, 'Jane')`;
  await sql()`select public.hometeam_join(${baoPhone}, 'Bao')`;
  await sql()`
    insert into supply_requests (id, requested_by, items, note, pickup_preference, status, visibility)
    values (${uuid5("seed:need:joe-tent")}, ${seedUserId},
            array['tent']::text[], 'Joe needs a tent at the skatepark',
            'Skatepark, San Rafael', 'open', 'open')
    on conflict (id) do nothing`;
  // Resolved demo alert — shows the shape without looking like a live emergency.
  // Text location_shared with explicit 'none' (new rev-10 column shape);
  // resolved_by_role='sender' + outcome_note show the outcome-tracking shape.
  try {
    await sql()`
      insert into emergency_alerts
        (id, sender_phone, kind, note, location_shared, audience,
         resolved_at, resolved_by_phone, resolved_by_role, outcome_note, created_at)
      values (${uuid5("seed:alert:demo-resolved")}, ${joePhone}, 'help_needed',
              'Demo alert — already resolved, just showing the shape.',
              'none', array['friends', 'peers', 'hometeam']::text[],
              now() - interval '2 hours', ${joePhone}, 'sender',
              'Safely reached a friend nearby — all good. (Demo outcome note.)',
              now() - interval '3 hours')
      on conflict (id) do nothing`;
  } catch { /* emergency_alerts may not exist on very old DBs mid-migration; schema apply precedes seed */ }

  // ── Outreach roster seed (owner-directed 2026-09-06) ───────────────
  // Jenn Mallow + Carrie "Bambi" Klyse (admins), Tracey Cohen (staff_limited,
  // placeholder phone — real number not known yet; the lead will update it via
  // sg_outreach_roster_set once provided). Idempotent ON CONFLICT DO NOTHING.
  const rosterSeed: Array<[name: string, phone: string, role: string]> = [
    ["Jenn Mallow", "14158797940", "admin"],
    ["Carrie \"Bambi\" Klyse", "14155249090", "admin"],
    ["Tracey Cohen", "0000000000", "staff_limited"],
  ];
  for (const [name, phone, role] of rosterSeed) {
    try {
      await sql()`
        insert into outreach_roster (phone, display_name, role, active)
        values (${phone}, ${name}, ${role}, true)
        on conflict (phone) do nothing`;
    } catch { /* roster table may not exist on very old DBs mid-migration */ }
  }

  const r3 = await sql()`select count(*)::int as n from hometeam_members`;
  const r4 = await sql()`select count(*)::int as n from supply_requests`;
  let alertsTotal = 0;
  try {
    const r5 = await sql()`select count(*)::int as n from emergency_alerts`;
    alertsTotal = Number(r5[0]?.n ?? 0);
  } catch { /* table may be absent if schema apply was skipped */ }
  let rosterTotal = 0;
  try {
    const r6 = await sql()`select count(*)::int as n from outreach_roster`;
    rosterTotal = Number(r6[0]?.n ?? 0);
  } catch { /* table may be absent if schema apply was skipped */ }
  return {
    resourcesInserted: DEMO_RESOURCES.length,
    sweepsInserted: DEMO_SWEEPS.length,
    resourcesTotal: Number(r1[0]?.n ?? 0),
    sweepsTotal: Number(r2[0]?.n ?? 0),
    hometeamTotal: Number(r3[0]?.n ?? 0),
    needsTotal: Number(r4[0]?.n ?? 0),
    alertsTotal,
    rosterTotal,
  };
}

export interface BootstrapResult extends SchemaApplyResult, SeedResult {
  alreadyBootstrapped: boolean;
}

/** Apply schema (if missing) + seed (if missing) in one idempotent action. */
export async function bootstrap(): Promise<BootstrapResult> {
  const schema = await applySchema();
  // Ask PostgREST to pick up new tables (Supabase Data API). Harmless if absent.
  try {
    await sql()(`notify pgrst, 'reload schema'` as never);
  } catch {
    /* non-fatal: not a Supabase-hosted Postgres or no pgrst listener */
  }
  const seed = await seedDemoData();
  return {
    ...schema,
    ...seed,
    alreadyBootstrapped: schema.skipped > 0 && schema.applied === 0,
  };
}

/** Connectivity probe used by scripts and the health check. */
export async function pingDb(): Promise<string> {
  const rows = await sql()`select current_database() as db, current_user as usr`;
  return `${rows[0]?.usr}@${rows[0]?.db}`;
}
