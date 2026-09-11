/**
 * PR-C: admin resolution of a listing-change report (owner-directed
 * 2026-09-11). ADMIN-ONLY via pinGate — staff_limited (Tracey) can VIEW the
 * queue but never act on it (server-enforced, not just a hidden button).
 *
 * POST /api/resources/mark-verified { phone, pin, verificationId, action, note? }
 *   action: "verified"  — the listing is actually correct: stamp the
 *                         resource's verified_at fresh (now) and resolve the
 *                         report. verified_by stays null (phone staff have no
 *                         users row — same convention as the sweep verify
 *                         path); the staff phone is recorded on the report.
 *           "resolved"  — the report was handled (e.g. the listing was
 *                         updated) without claiming a fresh verified stamp.
 *           "dismissed" — not an issue.
 * resolved_by + resolved_note (the admin's optional record, ≤500 chars) are
 * written on every action. Only `pending` rows can be acted on; acting twice
 * is a calm no-op 400, never a crash.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normOutreachPhone } from "~/lib/outreachServer";
import { pinFromRequest, pinGate } from "~/lib/staffPin";

const ACTIONS = ["verified", "resolved", "dismissed"] as const;

async function markVerified(c: { request: Request }) {
  let body: {
    phone?: unknown;
    pin?: unknown;
    verificationId?: unknown;
    action?: unknown;
    note?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with the report id and the action." }, { status: 400 });
  }
  const caller = normOutreachPhone(body.phone ?? c.request.headers.get("x-sg-phone"));
  const me = await pinGate(caller, pinFromRequest(c, body));
  if (!me.ok) {
    return Response.json({ ok: false, error: me.error, code: me.code }, { status: 403 });
  }
  if (me.role !== "admin") {
    return Response.json(
      { ok: false, error: "Only an outreach admin can verify or dismiss a report — the team lead can help." },
      { status: 403 },
    );
  }
  const verificationId = String(body.verificationId ?? "").trim().toLowerCase();
  const action = String(body.action ?? "").trim().toLowerCase();
  const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(verificationId)) {
    return Response.json({ ok: false, error: "Which report? (a valid report id is needed)" }, { status: 400 });
  }
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return Response.json({ ok: false, error: "Choose an action — verified, resolved, or dismissed." }, { status: 400 });
  }

  try {
    const row = (await sql()`
      select resource_id from public.resource_verifications
      where id = ${verificationId}::uuid and status = 'pending'`) as unknown as Array<{ resource_id: string }>;
    if (row.length === 0) {
      return Response.json({ ok: false, error: "That report is already handled — nothing changed." }, { status: 400 });
    }
    const resourceId = row[0]?.resource_id;

    // "verified": stamp the RESOURCE fresh (date column, like the seed) —
    // record the admin's phone on the report; verified_by stays null per the
    // phone-staff convention (no users row to reference).
    if (action === "verified") {
      await sql()`
        update public.resources
        set verified_at = now()::date, updated_at = now()
        where id = ${resourceId}::uuid`;
    }

    const resolved = (await sql()`
      update public.resource_verifications
      set status = ${action === "dismissed" ? "dismissed" : "resolved"},
          resolved_at = now(),
          resolved_by = ${caller},
          resolved_note = case when ${note.length > 0} then ${note} else resolved_note end
      where id = ${verificationId}::uuid and status = 'pending'
      returning id`) as unknown as Array<{ id: string }>;
    if (resolved.length === 0) {
      return Response.json({ ok: false, error: "That report is already handled — nothing changed." }, { status: 400 });
    }
    return Response.json({ ok: true, id: resolved[0]?.id, action, resourceVerified: action === "verified" });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/resources/mark-verified")({
  server: {
    handlers: {
      POST: markVerified,
    },
  },
});