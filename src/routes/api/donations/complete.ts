/**
 * Pass 2 — Donation Dispatch: roster staff record the OUTCOME of an offer or
 * request (owner-directed 2026-09-12; outcome choices 2026-09-16).
 *
 * Two outcomes, both recorded with who/when on the row:
 *  - "delivered"         → status completed + completed_at; the row LEAVES the
 *                          active queue (the existing complete flow, now with
 *                          an explicit outcome value).
 *  - "peer_not_at_spot"  → the row does NOT complete: status returns to
 *                          'claimed' so it STAYS ACTIVE in the queue with the
 *                          item held for another try, attempts + 1, and a calm
 *                          reschedule ping to the requester ("We'll try again
 *                          tomorrow / Monday."). Never a shaming tone.
 * outcome is optional in the body for backward compatibility with the earlier
 * "Mark complete" call — omitted means 'delivered'.
 *
 * Requester ping (reschedule only — a delivery needs no text): push to the
 * submitter's own tokens; SMS only through gateSms (consent + business hours +
 * STOP, never emergency:true). Zero phone digits in either payload.
 * Zero-PII analytics event logged (category only) when a delivery lands.
 *
 * POST /api/donations/complete
 *   { queue: "offers"|"requests", id, staffPhone, outcomeNote?,
 *     outcome?: "delivered"|"peer_not_at_spot" }
 *   staffPhone via body.staffPhone (or x-sg-phone header) — roster-gated
 *   (admin OR staff_limited).
 * → 200 { ok, completed: boolean, held: boolean, ping? } | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  DONATION_OUTCOME,
  isDonationOutcome,
} from "~/lib/donation";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  nextOutreachDay,
  pingDonationSubmitter,
  queueTable,
  rescheduleDayLabel,
  staffGateOr403,
  type DonationPingResult,
} from "~/lib/donationServer";

interface OutcomeRow {
  id: string;
  item: string;
  category: string;
  contact_phone: string;
}

async function complete(c: { request: Request }) {
  let body: {
    queue?: unknown;
    id?: unknown;
    staffPhone?: unknown;
    outcomeNote?: unknown;
    outcome?: unknown;
  } = {};
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
  const outcome = body.outcome === undefined || body.outcome === null || body.outcome === ""
    ? DONATION_OUTCOME.DELIVERED
    : String(body.outcome);
  if (!isDonationOutcome(outcome)) {
    return Response.json(
      {
        ok: false,
        error: "Which outcome? Use outcome: \"delivered\" or \"peer_not_at_spot\".",
      },
      { status: 400 },
    );
  }
  const outcomeNote = String(body.outcomeNote ?? "").trim().slice(0, 500) || null;
  const delivered = outcome === DONATION_OUTCOME.DELIVERED;
  try {
    // queueTable validated `queue` to one of the two literal strings below, so
    // the branching table name is safe (never a user string).
    //
    // delivered       → completed (cleared from the active queue).
    // peer_not_at_spot→ back to 'claimed' (STILL ACTIVE, item held) — the
    //                   claimer fields are preserved, and a never-claimed row
    //                   gets the caller as its claimer so the trail is honest.
    const rows: OutcomeRow[] = delivered
      ? target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'completed', completed_at = now(),
                outcome = ${outcome}, outcome_at = now(),
                outcome_by_phone = ${caller}, attempts = attempts + 1,
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item_description as item, category, contact_phone`) as unknown as OutcomeRow[])
        : ((await sql()`
            update public.donation_requests
            set status = 'completed', completed_at = now(),
                outcome = ${outcome}, outcome_at = now(),
                outcome_by_phone = ${caller}, attempts = attempts + 1,
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item, category, contact_phone`) as unknown as OutcomeRow[])
      : target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'claimed',
                claimed_by_phone = coalesce(claimed_by_phone, ${caller}),
                claimed_at = coalesce(claimed_at, now()),
                outcome = ${outcome}, outcome_at = now(),
                outcome_by_phone = ${caller}, attempts = attempts + 1,
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item_description as item, category, contact_phone`) as unknown as OutcomeRow[])
        : ((await sql()`
            update public.donation_requests
            set status = 'claimed',
                claimed_by_phone = coalesce(claimed_by_phone, ${caller}),
                claimed_at = coalesce(claimed_at, now()),
                outcome = ${outcome}, outcome_at = now(),
                outcome_by_phone = ${caller}, attempts = attempts + 1,
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item, category, contact_phone`) as unknown as OutcomeRow[]);
    const row = rows[0];
    if (!row) return Response.json({ ok: true, completed: false, held: false, id });
    if (delivered) {
      // Zero-PII analytics: category only — never phone/address/photo/notes.
      try {
        await insertAnalyticsEvent(
          target.kind === "offer" ? "donation_offer_complete" : "donation_request_complete",
          { category: row.category },
        );
      } catch {
        /* silent — the completion already succeeded */
      }
      return Response.json({ ok: true, completed: true, held: false, id });
    }
    // Peer not at spot → calm reschedule to the requester. Best-effort.
    let ping: DonationPingResult | null = null;
    try {
      ping = await pingDonationSubmitter({
        table: target.table,
        id: row.id,
        kind: "reschedule",
        itemLabel: row.item,
        contactPhone: row.contact_phone,
        offer: target.kind === "offer",
        dayLabel: rescheduleDayLabel(nextOutreachDay(), "en"),
      });
    } catch {
      ping = null;
    }
    return Response.json({ ok: true, completed: false, held: true, id, ping });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/complete")({
  server: {
    handlers: {
      POST: complete,
    },
  },
});
