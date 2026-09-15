/**
 * Pass 3 — Volunteer flow: roster-gated queue (owner-directed 2026-09-12).
 * Roster staff (admin OR staff_limited) see full rows — they need contact to
 * reach out. New first. No public SELECT exists (RLS) — anonymous readers get
 * zero rows; this route is the ONLY queue read path.
 *
 * GET /api/volunteers?phone=…
 *   caller phone via ?phone= or x-sg-phone header (roster-gated).
 * → 200 { ok, volunteers: VolunteerRow[] } | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import {
  mapVolunteerRow,
  volunteerGateOr403,
  volunteerTableReady,
} from "~/lib/volunteerServer";

async function volunteersQueue(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const gate = await volunteerGateOr403(caller);
  if (gate) return gate;
  if (!(await volunteerTableReady())) {
    return Response.json(
      { ok: false, error: "The volunteers queue isn't live yet — the next database update adds it.", code: "no_table" },
      { status: 503 },
    );
  }
  try {
    const rows = (await sql()`
      select id, name, contact, interest_note, status, created_at, updated_at
      from public.volunteer_signups
      order by (status <> 'new') asc, created_at desc
      limit 100`) as unknown as Array<Record<string, unknown>>;
    return Response.json({
      ok: true,
      volunteers: rows.map(mapVolunteerRow),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the volunteers queue — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/volunteers/")({
  server: {
    handlers: {
      GET: volunteersQueue,
    },
  },
});