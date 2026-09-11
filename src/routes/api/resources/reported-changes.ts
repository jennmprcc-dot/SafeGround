/**
 * PR-C: outreach check-in queue — listing-change reports (owner-directed
 * 2026-09-11). Staff-gated VIEW (any roster role reads pending rows; only
 * admins act on them via /api/resources/mark-verified).
 *
 * GET /api/resources/reported-changes?phone=… (or x-sg-phone header)
 *
 * PIN LOCK (owner-directed 2026-09-11): phone alone no longer opens the
 * staff queue — the caller proves it's them with their 4–6 digit PIN
 * (x-sg-pin header, per the staffPin.ts adoption recipe). Machine-readable
 * `code` drives the client: must_set / staff_pin_required / wrong / cooldown /
 * not_staff → the calm 403 line; the outreach.tsx gate handles the states.
 *
 * Privacy: staff_limited payloads never carry reporter phone digits — only
 * the last-4 tail (same convention as /api/outreach/summary). Admins see the
 * full optional number so they can follow up.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normOutreachPhone } from "~/lib/outreachServer";
import { pinFromRequest, pinGate } from "~/lib/staffPin";

interface DbReport {
  id: string;
  resource_id: string;
  resource_name: string;
  category: string;
  reason: string;
  note: string | null;
  reported_by: string | null;
  created_at: string | Date;
}

/** Last digits only — staff_limited payloads never carry full phone digits. */
const tail4 = (phone: string | null): string | null =>
  phone == null ? null : `•••${String(phone).replace(/[^0-9]/g, "").slice(-4)}`;

const iso = (d: string | Date | null | undefined): string | null =>
  d == null ? null : new Date(d).toISOString();

async function reportedChanges(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normOutreachPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const me = await pinGate(caller, pinFromRequest(c));
  if (!me.ok) {
    return Response.json({ ok: false, error: me.error, code: me.code }, { status: 403 });
  }
  const admin = me.role === "admin";
  try {
    const rows = (await sql()`
      select
        rv.id,
        rv.resource_id,
        r.name as resource_name,
        r.category,
        rv.reason,
        rv.note,
        rv.reported_by,
        rv.created_at
      from public.resource_verifications rv
      join public.resources r on r.id = rv.resource_id
      where rv.status = 'pending'
      order by rv.created_at desc
      limit 100`) as unknown as DbReport[];
    return Response.json({
      ok: true,
      role: me.role,
      name: me.name,
      items: rows.map((r) => ({
        id: r.id,
        resourceId: r.resource_id,
        resourceName: r.resource_name,
        category: r.category,
        reason: r.reason,
        note: r.note,
        // Admin gets the optional follow-up number; staff_limited gets words only.
        reportedByPhone: admin ? r.reported_by : null,
        reportedByTail: tail4(r.reported_by),
        createdAt: iso(r.created_at),
      })),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the check-ins — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/resources/reported-changes")({
  server: {
    handlers: {
      GET: reportedChanges,
    },
  },
});