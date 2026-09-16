/**
 * Donation Dispatch — staff mark a claimed item IN ROUTE (out for delivery)
 * (owner-directed 2026-09-16). claimed → in_route, route_started_at = now().
 * The claimer's identity (claimed_by_phone) is NOT changed here; the row stays
 * active in the queue (open + claimed + in_route) until an outcome clears it.
 *
 * Requester ping: "MPRCC staff is on the way with your {item}." Push to the
 * submitter's own registered tokens; SMS only through gateSms (consent +
 * business hours + STOP — never emergency:true). Zero phone digits in either.
 *
 * POST /api/donations/in-route
 *   { queue: "offers"|"requests", id, staffPhone }
 *   staffPhone via body.staffPhone (or x-sg-phone header) — roster-gated.
 * → 200 { ok, inRoute: boolean, ping? } | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  pingDonationSubmitter,
  queueTable,
  staffGateOr403,
  type DonationPingResult,
} from "~/lib/donationServer";

interface RouteRow {
  id: string;
  item: string;
  contact_phone: string;
}

async function inRoute(c: { request: Request }) {
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
    // Only a CLAIMED row can go in route ("claim → In route → outcome") — a
    // second tap, or a row that was never claimed, matches zero rows and the
    // client simply reloads the queue and shows the real state.
    const rows =
      target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'in_route', route_started_at = now(), updated_at = now()
            where id = ${id}::uuid and status = 'claimed'
            returning id, item_description as item, contact_phone`) as unknown as RouteRow[])
        : ((await sql()`
            update public.donation_requests
            set status = 'in_route', route_started_at = now(), updated_at = now()
            where id = ${id}::uuid and status = 'claimed'
            returning id, item, contact_phone`) as unknown as RouteRow[]);
    const row = rows[0];
    if (!row) return Response.json({ ok: true, inRoute: false, id });
    // Best-effort: a failed ping never fails the state change that landed.
    let ping: DonationPingResult | null = null;
    try {
      ping = await pingDonationSubmitter({
        table: target.table,
        id: row.id,
        kind: "in_route",
        itemLabel: row.item,
        contactPhone: row.contact_phone,
        offer: target.kind === "offer",
      });
    } catch {
      ping = null;
    }
    return Response.json({ ok: true, inRoute: true, id, ping });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/in-route")({
  server: {
    handlers: {
      POST: inRoute,
    },
  },
});
