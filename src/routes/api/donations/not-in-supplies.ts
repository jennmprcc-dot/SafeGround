/**
 * Donation Dispatch — staff answer "Not in supplies right now"
 * (owner-directed 2026-09-16, backlog 332a92b7).
 *
 * Staff tap this on an ACTIVE row (open | claimed | in_route) when MPRCC just
 * doesn't have the item yet. The row goes BACK TO 'open' — claimed_by_phone,
 * claimed_at and route_started_at cleared, so it is back in the active pool and
 * can still be claimed and fulfilled when the item arrives — with
 * outcome = 'not_in_supplies', outcome_at / outcome_by_phone recorded,
 * attempts + 1 and the optional staff note. Nothing is deleted and the row
 * never leaves the queue (the Open filter shows open | claimed | in_route).
 *
 * Requester ping (one per action): push to the submitter's own registered
 * tokens; SMS only through gateSms (consent + business hours + STOP — never
 * emergency:true). Zero phone digits in either payload. The owner's copy is
 * verbatim in the text:
 *   "Your {item} isn't in our supplies right now. SafeGround is a
 *    community-driven organization that relies on donations from the
 *    community — we do our best to answer every request, and it can take time
 *    depending on the need. As soon as we're able to get your {item}, someone
 *    will be in touch."
 * The push notification carries the same message with the middle explanation
 * left out (the OS clips long notification bodies) — see DONATION_PING_COPY.
 *
 * No repeat pings: the 60s per-(row, kind) cooldown in pingDonationSubmitter
 * stops a double-tap from texting twice, and a row that later gets claimed and
 * fulfilled pings for THAT action only (a different kind, its own cooldown).
 *
 * POST /api/donations/not-in-supplies
 *   { queue: "offers"|"requests", id, staffPhone, outcomeNote? }
 *   staffPhone via body.staffPhone (or x-sg-phone header) — roster-gated
 *   (admin OR staff_limited).
 * → 200 { ok, returned: boolean, ping? } | 400 | 403 calm | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { DONATION_OUTCOME } from "~/lib/donation";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  pingDonationSubmitter,
  queueTable,
  staffGateOr403,
  type DonationPingResult,
} from "~/lib/donationServer";

interface ActiveRow {
  id: string;
  item: string;
  contact_phone: string;
}

async function notInSupplies(c: { request: Request }) {
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
  // Calm 400 for a malformed id instead of letting the ::uuid cast blow up into
  // a 503 — a valid-but-unknown id still falls through to the ok:returned:false
  // answer below (the row moved on; the client reloads the queue).
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    return Response.json(
      { ok: false, error: "That item id doesn't look right — reload the queue and try again." },
      { status: 400 },
    );
  }
  if (!(await donationTableReady(target.table))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG(target.table), code: "no_table" },
      { status: 503 },
    );
  }
  const outcomeNote = String(body.outcomeNote ?? "").trim().slice(0, 500) || null;
  const outcome = DONATION_OUTCOME.NOT_IN_SUPPLIES;
  try {
    // queueTable validated `queue` to one of the two literal table names below,
    // so the branching table name is safe (never a user string).
    //
    // Back to 'open' — the row is NOT finished, it is waiting on supplies. The
    // claim/route fields are cleared so the card reads as unclaimed and any
    // staff member can pick it up the moment the item shows up.
    const rows: ActiveRow[] =
      target.table === "donation_offers"
        ? ((await sql()`
            update public.donation_offers
            set status = 'open',
                claimed_by_phone = null, claimed_at = null, route_started_at = null,
                outcome = ${outcome}, outcome_at = now(), outcome_by_phone = ${caller},
                attempts = attempts + 1, outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item_description as item, contact_phone`) as unknown as ActiveRow[])
        : ((await sql()`
            update public.donation_requests
            set status = 'open',
                claimed_by_phone = null, claimed_at = null, route_started_at = null,
                outcome = ${outcome}, outcome_at = now(), outcome_by_phone = ${caller},
                attempts = attempts + 1, outcome_note = ${outcomeNote}, updated_at = now()
            where id = ${id}::uuid and status in ('open', 'claimed', 'in_route')
            returning id, item, contact_phone`) as unknown as ActiveRow[]);
    const row = rows[0];
    if (!row) return Response.json({ ok: true, returned: false, id });
    // Best-effort: a failed ping never fails the state change that landed.
    let ping: DonationPingResult | null = null;
    try {
      ping = await pingDonationSubmitter({
        table: target.table,
        id: row.id,
        kind: "not_in_supplies",
        itemLabel: row.item,
        contactPhone: row.contact_phone,
        offer: target.kind === "offer",
      });
    } catch {
      ping = null;
    }
    return Response.json({ ok: true, returned: true, id, ping });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/not-in-supplies")({
  server: {
    handlers: {
      POST: notInSupplies,
    },
  },
});
