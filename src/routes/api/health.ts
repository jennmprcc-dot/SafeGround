/**
 * DB health check (server-side). Used to verify the live connection without
 * exposing any row data or credentials. Returns 503 with a calm message when
 * the database is unreachable (e.g. credential not yet saved).
 *
 * TanStack Start v1 server-route form: `createFileRoute('/api/...')` with a
 * `server.handlers` map. A bare `export async function GET()` in this file is
 * NOT picked up by the route generator — it never reaches routeTree.gen.ts or
 * the server bundle, and requests fall through to the SPA shell (that was the
 * /api/health-returns-HTML bug; see PR: fix/api-routes-deploy).
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

async function health() {
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

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: health,
    },
  },
});
