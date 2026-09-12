/**
 * Pass 2 — Donation Dispatch: roster staff claim an offer/request
 * (owner-directed 2026-09-12). "I'm on it" — the server sets claimed_by_phone
 * + claimed_at from the GATED caller (never from a body field). open → claimed.
 * staff_limited may claim (consistent with the existing plan). No delete path.
 *
 * POST /api/donations/claim
 *   { queue: "offers"|"requests", id, staffPhone }
 *   staffPhone via body.staffPhone (or x-sg-phone header) — roster-gated
 *   (admin OR staff_limited).
 * → 200 { ok, claimed: boolean } (claimed=false when the row isn't open — e.g.
 *   already claimed/completed or unknown id) | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  queueTable,
  staffGateOr403,
} from "~/lib/donationServer";

async function claim(c: { request: Request }) {
  let body: { queue?: unknown; id?: unknown; staffPhone?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with queue + id." }, { status: 400 });
  }
  const caller = normPhone(body.staffPhone ?? c.request.headers.get("x-sg-phone"));
  const gate = await staffGateOr403(caller);
  if (gate) return gate;
  const target = queueTable(String(body.queue ?? "").toLowerCase());
  if (!target) {
    return Response.json(
      { ok: false, error: "Which queue? Use queue: \"offers\" or \"requests\"." },
      { status: 400 },
    );
  }
  const id = String(body.id ?? "").trim().slice(0, 60);
  if (!id) return Response.json({ ok: false, error: "Which item? (id missing)" }, { status: 400 });
  if (!(await donationTableReady(target.table))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG(target.table), code: "no_table" },
      { status: 503 },
    );
  }
  try {
    // queueTable validated `queue` to one of the two literal strings below, so
    // the branching table name is safe (never a user string).
    const rows =
      target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'claimed', claimed_by_phone = ${caller},
                claimed_at = now(), updated_at = now()
            where id = ${id}::uuid and status = 'open'
            returning id`) as unknown as Array<{ id: string }>)
        : ((await sql()`
            update public.donation_requests
            set status = 'claimed', claimed_by_phone = ${caller},
                claimed_at = now(), updated_at = now()
            where id = ${id}::uuid and status = 'open'
            returning id`) as unknown as Array<{ id: string }>);
    return Response.json({ ok: true, claimed: rows.length > 0, id });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/claim")({
  server: {
    handlers: {
      POST: claim,
    },
  },
});