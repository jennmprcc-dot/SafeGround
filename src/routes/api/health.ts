/**
 * DB health check (server-side). Used to verify the live connection without
 * exposing any row data or credentials. Returns 503 with a calm message when
 * the database is unreachable (e.g. credential not yet saved).
 */
import { sql } from "~/db";

export async function GET() {
  try {
    const rows = await sql()`select count(*)::int as n from resources`;
    const sweeps = await sql()`select count(*)::int as n from sweeps`;
    return Response.json({
      ok: true,
      db: "reachable",
      resources: rows[0]?.n ?? 0,
      sweeps: sweeps[0]?.n ?? 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json(
      {
        ok: false,
        db: "unreachable",
        hint: message.includes("[YOUR-PASSWORD]")
          ? "DATABASE_URL still contains the [YOUR-PASSWORD] placeholder — save the real password in the platform Secrets UI."
          : "DATABASE_URL is set but the database did not answer.",
      },
      { status: 503 },
    );
  }
}
