import { neon } from "@neondatabase/serverless";

/**
 * Server-only handle to the team's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL`, which the owner connects via
 * the database card and which is injected into the sandbox and passed to the live
 * host on publish. Resolved lazily (per call, not at module load) so the site
 * still builds and serves before a database is connected — the error only
 * surfaces if a query actually runs without `DATABASE_URL`.
 *
 * Use it only inside a `createServerFn()` handler or an `src/routes/api/*` route
 * (never client code):
 *
 *   const getPosts = createServerFn().handler(async () => {
 *     const rows = await sql()`select id, title, created_at from posts`;
 *     // Coerce non-primitive columns (timestamps are JS Dates) to strings before
 *     // returning to the client, or React will refuse to render them:
 *     return rows.map((r) => ({ ...r, created_at: String(r.created_at) }));
 *   });
 *
 * NOTE ON THE OTHER SUPABASE SECRETS: `supabase_url` + `supabase_anon_key` are
 * for the browser-side Supabase Data API (PostgREST/Realtime under RLS). They are
 * NOT needed for server-side SQL — this file talks straight to Postgres over
 * `DATABASE_URL` with the service role. Don't depend on them in server fns.
 */

/**
 * Parse + repair the `DATABASE_URL` secret into a connectable Postgres URL.
 * Exported so scripts/ (schema apply, seed) share the exact same logic as the
 * running server. Never logs or returns the password.
 *
 * Known secret-paste pitfalls this repairs (each verified against the real env):
 *  1. Supabase's "Connect" string ships as a template with a literal
 *     `[YOUR-PASSWORD]` placeholder. If the owner saved it unfilled we throw a
 *     calm, actionable error instead of an auth loop.
 *  2. Some secret managers wrap values in literal square brackets — strip a
 *     `[...]`-wrapped password segment.
 *  3. Supabase direct hosts (`db.<ref>.supabase.co:5432`) resolve IPv6-only
 *     AAAA records. IPv4-only hosts (this sandbox, most serverless runtimes)
 *     cannot reach them. The Supavisor pooler (`aws-0-<region>.pooler.supabase.com`)
 *     is dual-stack and serves the same database with user `postgres.<ref>` —
 *     rewrite to it. Region override: SUPABASE_DB_REGION env var.
 */
export function databaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set — connect a database (via the database card) before running queries."
    );
  }
  let url = raw.trim();
  if (/\[YOUR-PASSWORD\]/i.test(url)) {
    throw new Error(
      "DATABASE_URL still contains Supabase's [YOUR-PASSWORD] placeholder — the real database " +
        "password was never saved. Paste the actual password into DATABASE_URL (platform Secrets " +
        "UI, same place the current value lives) and re-publish."
    );
  }
  // Repair (2): postgres:[SECRET]@host → postgres:SECRET@host
  url = url.replace(/:\[([^\]]*)\]@/, ":$1@");
  // Repair (3): IPv6-only direct host → dual-stack Supavisor pooler (same DB).
  const direct = url.match(/^(postgresql:\/\/[^:]+):([^@]+)@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?\//);
  if (direct) {
    const [, user, password, ref] = direct;
    const region = process.env.SUPABASE_DB_REGION || "us-west-2";
    url =
      `postgresql://${user}.${ref}:${encodeURIComponent(password)}` +
      `@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  }
  return url;
}

export const sql = () => {
  return neon(databaseUrl());
};
