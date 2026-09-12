/**
 * Pass 2 — Donation Dispatch: submit a donation offer (owner-directed
 * 2026-09-12). Anyone may submit (no auth — same as peer support); the row is
 * the queue. The server then fans a Firebase push out to the active roster
 * admins ONLY (Jenn + Bambi) via their registered tokens — no phone digits in
 * the push, never 911, never SMS (SMS is a later wave, not this PR).
 *
 * POST /api/donations/offers/submit
 *   { path: "porch_drop"|"scheduled_pickup"|"mprcc_porch", itemDescription,
 *     category, conditionNote?, quantity?, contactPhone,
 *     addressStreet?/addressCity?/addressZip?   (required for porch_drop +
 *     scheduled_pickup), approachNotes? (porch_drop), pickupTimeWindow?
 *     (scheduled_pickup), photoB64? (porch_drop only, ≤ 400k chars ≈ 300KB
 *     client-compressed JPEG base64) }
 * → 201 { ok, offer } | 400 { ok:false, error, field? } | 503
 *
 * Privacy: contact_phone stored for staff coordination (roster-gated reads
 * only — no public SELECT). Zero-PII analytics event logged on success.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  DONATION_MISSING_TABLE_MSG,
  donationTableReady,
  fanOutDonationAdmins,
  validateOfferInput,
} from "~/lib/donationServer";

async function submitOffer(c: { request: Request }) {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body with your offer." },
      { status: 400 },
    );
  }
  const validated = validateOfferInput(body);
  if (!validated.ok) {
    return Response.json(
      { ok: false, error: validated.error, field: validated.field ?? null },
      { status: 400 },
    );
  }
  const v = validated.data;
  if (!(await donationTableReady("donation_offers"))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG("donation_offers"), code: "no_table" },
      { status: 503 },
    );
  }
  try {
    const rows = (await sql()`
      insert into public.donation_offers
        (path, item_description, category, condition_note, quantity,
         contact_phone, address_street, address_city, address_zip,
         approach_notes, pickup_time_window, photo_b64)
      values (${v.path}, ${v.itemDescription}, ${v.category}, ${v.conditionNote},
              ${v.quantity}, ${v.contactPhone}, ${v.addressStreet}, ${v.addressCity},
              ${v.addressZip}, ${v.approachNotes}, ${v.pickupTimeWindow}, ${v.photoB64})
      returning id, path, item_description, category, contact_phone, status,
                created_at, updated_at, claimed_by_phone, claimed_at,
                completed_at, outcome_note`) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return Response.json(
        { ok: false, error: "That didn't go through — please try again in a moment." },
        { status: 503 },
      );
    }
    // Zero-PII analytics: category + path only — never phone/address/photo.
    try {
      await insertAnalyticsEvent("donation_offer_submit", {
        category: v.category,
        status: v.path,
      });
    } catch {
      /* silent — the offer already succeeded */
    }
    // Push to admins only. Best-effort — never fails the submit.
    let fan = { notifiedPhones: 0, tokensSent: 0 };
    try {
      fan = await fanOutDonationAdmins("offer", v.category, v.itemDescription);
    } catch {
      /* best-effort */
    }
    return Response.json(
      {
        ok: true,
        offer: {
          id: String(row.id),
          status: String(row.status),
          path: v.path,
          category: v.category,
          createdAt: String(row.created_at),
        },
        teamNotified: fan.notifiedPhones > 0 && fan.tokensSent > 0,
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/donations/offers/submit")({
  server: {
    handlers: {
      POST: submitOffer,
    },
  },
});