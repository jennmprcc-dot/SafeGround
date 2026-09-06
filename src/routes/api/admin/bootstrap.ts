/**
 * Gated, idempotent database bootstrap endpoint (schema + demo seed).
 *
 * DELIBERATELY OFF by default: set env var ALLOW_DB_BOOTSTRAP=1 in the platform
 * Secrets UI (even temporarily) to enable. When enabled it applies schema.sql
 * (idempotent, with the auth.uid() shim only if the auth schema is absent) and
 * seeds the clearly-labeled demo content. When disabled it returns 403 with a
 * calm explanation. Delete this route after Wave 2 ops are stable if undesired.
 *
 * TanStack Start v1 server-route form: `createFileRoute('/api/...')` with a
 * `server.handlers` map. A bare `export async function POST()` in this file is
 * NOT picked up by the route generator — it never reaches routeTree.gen.ts or
 * the server bundle, and requests fall through to the SPA shell (that was the
 * /api/*-returns-HTML bug; see PR: fix/api-routes-deploy).
 */
import { createFileRoute } from "@tanstack/react-router";
import { bootstrap } from "~/lib/bootstrap";

async function runBootstrap() {
  if (process.env.ALLOW_DB_BOOTSTRAP !== "1") {
    return Response.json(
      {
        ok: false,
        hint: "Bootstrap is disabled. Set ALLOW_DB_BOOTSTRAP=1 in the platform Secrets UI to run schema + seed once, then remove it.",
      },
      { status: 403 },
    );
  }
  try {
    const r = await bootstrap();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, hint: e instanceof Error ? e.message : "bootstrap failed" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/admin/bootstrap")({
  server: {
    handlers: {
      POST: runBootstrap,
    },
  },
});
