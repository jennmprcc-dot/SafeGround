/**
 * Pass 2 — Donation Dispatch: roster staff mark an offer/request complete
 * (owner-directed 2026-09-12). claimed/complete — the server sets
 * completed_at + outcome_note; claimed_by_phone stays the earlier gated
 * caller. open|claimed → completed. staff_limited may complete (consistent
 * with the existing plan). No delete path. Zero-PII analytics event logged
 * (category only) when the completion lands.
 *
 * POST /api/donations/complete
 *   { queue: "offers"|"requests", id, staffPhone, outcomeNote? }
 *   staffPhone via body.staffPhone (or x-sg-phone header) — roster-gated
 *   (admin OR staff_limited).
 * → 200 { ok, completed: boolean } | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  queueTable,
  staffGateOr403,
} from "~/lib/donationServer";

async function complete(c: { request: Request }) {
  let body: { queue?: unknown; id?: unknown; staffPhone?: unknown; outcomeNote?: unknown } = {};
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
  const outcomeNote = String(body.outcomeNote ?? "").trim().slice(0, 500) || null;
  try {
    // queueTable validated `queue` to one of the two literal strings below, so
    // the branching table name is safe (never a user string).
    const rows =
      target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'completed', completed_at = now(),
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed')
            returning id, category`) as unknown as Array<{ id: string; category: string }>)
        : ((await sql()`
            update public.donation_requests
            set status = 'completed', completed_at = now(),
                outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed')
            returning id, category`) as unknown as Array<{ id: string; category: string }>);
    if (rows.length > 0) {
      // Zero-PII analytics: category only — never phone/address/photo/notes.
      try {
        await insertAnalyticsEvent(
          target.kind === "offer" ? "donation_offer_complete" : "donation_request_complete",
          { category: rows[0].category },
        );
      } catch {
        /* silent — the completion already succeeded */
      }
    }
    return Response.json({ ok: true, completed: rows.length > 0, id });
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