/**
 * Pass 2 — Donation Dispatch: roster-gated OFFERS queue (owner-directed
 * 2026-09-12). Roster staff (admin OR staff_limited) see full rows — they need
 * contact_phone to coordinate (matches the established staff model). Open rows
 * first, then recent. No public SELECT exists (RLS) — anonymous readers get
 * zero rows; this route is the ONLY queue read path.
 *
 * GET /api/donations/offers?phone=…[&status=open|all]
 *   caller phone via ?phone= or x-sg-phone header (roster-gated).
 *   status=open (default) → open + claimed; status=all → + completed.
 * → 200 { ok, offers: DonationOfferRow[] } | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  mapOfferRow,
  staffGateOr403,
} from "~/lib/donationServer";

async function offersQueue(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const gate = await staffGateOr403(caller);
  if (gate) return gate;
  if (!(await donationTableReady("donation_offers"))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG("donation_offers"), code: "no_table" },
      { status: 503 },
    );
  }
  const status = String(url.searchParams.get("status") ?? "open").toLowerCase();
  const filter = status === "all" ? ["open", "claimed", "completed"] : ["open", "claimed"];
  try {
    const rows = (await sql()`
      select id, path, item_description, category, condition_note, quantity,
             contact_phone, address_street, address_city, address_zip,
             approach_notes, pickup_time_window, photo_b64, status,
             claimed_by_phone, claimed_at, completed_at, outcome_note,
             created_at, updated_at
      from public.donation_offers
      where status = any(${filter})
      order by (status <> 'open') asc, created_at desc
      limit 100`) as unknown as Array<Record<string, unknown>>;
    return Response.json({
      ok: true,
      offers: rows.map(mapOfferRow),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the offers queue — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/offers/")({
  server: {
    handlers: {
      GET: offersQueue,
    },
  },
});