/**
 * Anonymous analytics event intake (owner-directed 2026-09-07).
 *
 * POST /api/analytics/log — records ONE zero-PII event row. Body:
 *   { eventType, category?, status?, installId? }
 * Validation + insert live in ~/lib/analytics/server.ts (insertAnalyticsEvent);
 * this route is a thin server-only wrapper in TanStack Start v1 server-route
 * form (createFileRoute + server.handlers) so the browser never loads the
 * server's pg module graph.
 *
 * PRIVACY: writes exactly four columns (event_type, category, status,
 * install_id). Never reads request headers, x-forwarded-for, user-agent, IP,
 * phone, coords, notes, or any free text. The insert validates + drops
 * everything else. Always 200 with { ok } — a logging failure must never
 * break a neighbor's workflow.
 */
import { createFileRoute } from "@tanstack/react-router";
import { insertAnalyticsEvent } from "~/lib/analytics/server";

async function logEvent(c: { request: Request }) {
  let body: {
    eventType?: unknown;
    category?: unknown;
    status?: unknown;
    installId?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false });
  }
  const ok = await insertAnalyticsEvent(String(body.eventType ?? ""), {
    category: typeof body.category === "string" ? body.category : null,
    status: typeof body.status === "string" ? body.status : null,
    installId: typeof body.installId === "string" ? body.installId : null,
  });
  return Response.json({ ok });
}

export const Route = createFileRoute("/api/analytics/log")({
  server: {
    handlers: {
      POST: logEvent,
    },
  },
});
