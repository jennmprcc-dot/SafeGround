import { Pool } from "pg";

/**
 * Server-only handle to the team's database (Supabase Postgres via `pg`).
 * The connection string comes from `DATABASE_URL`, which the owner connects via
 * the database card and which is injected into the sandbox and passed to the live
 * host on publish. Resolved lazily (per call, not at module load) so the site
 * still builds and serves before a database is connected — the error only
 * surfaces if a query actually runs without `DATABASE_URL`.
 *
 * WHY `pg` AND NOT `@neondatabase/serverless`: the original driver (`neon`)
 * fails TLS on this sandbox for Supabase's pooler (the sandbox can't validate
 * the pooler cert SAN), while `pg` with `ssl.rejectUnauthorized: false` connects
 * cleanly. Supabase requires TLS on the wire, so we keep TLS enabled and skip
 * strict cert verification — the service-role credential + Supabase's network
 * wall remain the actual security boundary. Node-postgres also makes scripted
 * schema apply + seed simple (see scripts/ and src/lib/bootstrap.ts).
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
  // The user part for the pooler is `postgres.<ref>` (Supabase's pooler auth).
  // (`postgresql://` scheme, `postgres` user — capture only the user, not the scheme's `//`.)
  const direct = url.match(/^postgresql:\/\/([^:/]+):([^@]+)@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?\//);
  if (direct) {
    const [, user, password, ref] = direct;
    const region = process.env.SUPABASE_DB_REGION || "us-west-2";
    url =
      `postgresql://${user}.${ref}:${encodeURIComponent(password)}` +
      `@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  }
  return url;
}

/* ── pg client pool ────────────────────────────────────────────────
 * One lazy pool for the whole server process. TLS stays ON (Supabase requires
 * it on the wire) with strict verification off (see header comment). Per-call
 * clients were slower and left sockets around; a single small pool is fast and
 * clean. `max: 3` keeps the sandbox footprint tiny (free-tier friendly). */
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 8_000,
      idleTimeoutMillis: 30_000,
      application_name: "safeground",
    });
    pool.on("error", (err) => {
      // Log-and-continue: the calm demo fallback in the server fns is the
      // user-facing layer; never crash the process on a stale pooled socket.
      console.error("[safeground-db] pool error:", err.message);
    });
  }
  return pool;
}

/** Run a parameterized query and return the rows. Never logs the connection string. */
export async function query(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params.map((v) => (v === undefined ? null : v)));
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Tagged-template `sql` factory, kept surface-compatible with the neon-era API:
 *   const rows = await sql()`select ... where id = ${id}`;
 *   await sql()(`notify pgrst, 'reload schema'`);        // raw single-statement form
 * Parameters become `$1, $2, …` placeholders (safe from injection). `undefined`
 * values are bound as NULL (pg would otherwise reject them). Interpolating a raw
 * string into a template without a value is a no-op — never concatenate user input
 * into the template itself.
 */
export const sql = () => {
  return (
    strings: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<Record<string, unknown>[]> => {
    if (typeof strings === "string") return query(strings);
    if (strings.length === 1 && values.length === 0) return query(strings[0]);
    const text = strings.reduce((acc, part, i) => {
      if (i === 0) return part;
      return `${acc}$${i}${part}`;
    }, "");
    return query(text, values);
  };
};