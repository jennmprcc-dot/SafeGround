/**
 * Pass 2 — Donation Dispatch: submit a donation request (owner-directed
 * 2026-09-12). Anyone may submit (no auth — same as peer support); the row is
 * the queue. The server then fans a Firebase push out to the active roster
 * admins ONLY (Jenn + Bambi) via their registered tokens — no phone digits in
 * the push, never 911, never SMS (SMS is a later wave, not this PR).
 *
 * POST /api/donations/requests/submit
 *   { item, category, quantity?, notes?, size?, pickupOrDelivery:
 *     "pickup"|"delivery"|"either", contactPhone }
 * → 201 { ok, request } | 400 { ok:false, error, field? } | 503
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
  validateRequestInput,
} from "~/lib/donationServer";

async function submitRequest(c: { request: Request }) {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body with your request." },
      { status: 400 },
    );
  }
  const validated = validateRequestInput(body);
  if (!validated.ok) {
    return Response.json(
      { ok: false, error: validated.error, field: validated.field ?? null },
      { status: 400 },
    );
  }
  const v = validated.data;
  if (!(await donationTableReady("donation_requests"))) {
    return Response.json(
      { ok: false, error: DONATION_MISSING_TABLE_MSG("donation_requests"), code: "no_table" },
      { status: 503 },
    );
  }
  try {
    const rows = (await sql()`
      insert into public.donation_requests
        (item, category, quantity, notes, size, pickup_or_delivery, contact_phone)
      values (${v.item}, ${v.category}, ${v.quantity}, ${v.notes}, ${v.size},
              ${v.pickupOrDelivery}, ${v.contactPhone})
      returning id, item, category, pickup_or_delivery, contact_phone, status,
                created_at, updated_at
    `) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return Response.json(
        { ok: false, error: "That didn't go through — please try again in a moment." },
        { status: 503 },
      );
    }
    // Zero-PII analytics: category + preference only — never phone/notes.
    try {
      await insertAnalyticsEvent("donation_request_submit", {
        category: v.category,
        status: v.pickupOrDelivery,
      });
    } catch {
      /* silent — the request already succeeded */
    }
    // Push to admins only. Best-effort — never fails the submit.
    let fan = { notifiedPhones: 0, tokensSent: 0 };
    try {
      fan = await fanOutDonationAdmins("request", v.category, v.item);
    } catch {
      /* best-effort */
    }
    return Response.json(
      {
        ok: true,
        request: {
          id: String(row.id),
          status: String(row.status),
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

export const Route = createFileRoute("/api/donations/requests/submit")({
  server: {
    handlers: {
      POST: submitRequest,
    },
  },
});