/**
 * Pass 2 — Donation Dispatch: roster-gated REQUESTS queue (owner-directed
 * 2026-09-12). Roster staff (admin OR staff_limited) see full rows — they need
 * contact_phone to coordinate (matches the established staff model). Open rows
 * first, then recent. No public SELECT exists (RLS) — anonymous readers get
 * zero rows; this route is the ONLY queue read path.
 *
 * GET /api/donations/requests?phone=…[&status=open|all]
 *   caller phone via ?phone= or x-sg-phone header (roster-gated).
 *   status=open (default) → open + claimed; status=all → + completed.
 * → 200 { ok, requests: DonationRequestRow[] } | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  mapRequestRow,
  staffGateOr403,
} from "~/lib/donationServer";

async function requestsQueue(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const gate = await staffGateOr403(caller);
  if (gate) return gate;
  if (!(await donationTableReady("donation_requests"))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG("donation_requests"), code: "no_table" },
      { status: 503 },
    );
  }
  const status = String(url.searchParams.get("status") ?? "open").toLowerCase();
  const filter = status === "all" ? ["open", "claimed", "completed"] : ["open", "claimed"];
  try {
    const rows = (await sql()`
      select id, item, category, quantity, notes, size, pickup_or_delivery,
             contact_phone, status, claimed_by_phone, claimed_at, completed_at,
             outcome_note, created_at, updated_at
      from public.donation_requests
      where status = any(${filter})
      order by (status <> 'open') asc, created_at desc
      limit 100`) as unknown as Array<Record<string, unknown>>;
    return Response.json({
      ok: true,
      requests: rows.map(mapRequestRow),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the requests queue — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/requests/")({
  server: {
    handlers: {
      GET: requestsQueue,
    },
  },
});