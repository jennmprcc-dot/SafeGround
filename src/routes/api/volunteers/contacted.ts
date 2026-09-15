/**
 * Pass 3 — Volunteer flow: staff mark-contacted (owner-directed 2026-09-12).
 * Roster-gated (admin OR staff_limited). The staff phone comes from the
 * caller (body.staffPhone + roster check) — never public, mirrors the
 * donation claim/complete routes.
 *
 * POST /api/volunteers/contacted
 *   { id, staffPhone }
 * → 200 { ok } | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { volunteerGateOr403, volunteerTableReady } from "~/lib/volunteerServer";

async function markContacted(c: { request: Request }) {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body." },
      { status: 400 },
    );
  }
  const id = String(body.id ?? "");
  if (!id) {
    return Response.json(
      { ok: false, error: "Which sign-up are you marking? Try again.", field: "id" },
      { status: 400 },
    );
  }
  const staffPhone = normPhone(body.staffPhone);
  const gate = await volunteerGateOr403(staffPhone);
  if (gate) return gate;
  if (!(await volunteerTableReady())) {
    return Response.json(
      { ok: false, error: "The volunteers queue isn't live yet — the next database update adds it.", code: "no_table" },
      { status: 503 },
    );
  }
  try {
    await sql()`
      update public.volunteer_signups
      set status = 'contacted', updated_at = now()
      where id = ${id} and status <> 'contacted'`;
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/volunteers/contacted")({
  server: {
    handlers: {
      POST: markContacted,
    },
  },
});