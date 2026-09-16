/**
 * My donation requests & offers (owner bug 2026-09-16: "my needs / my
 * requests don't populate").
 *
 * GET /api/donations/mine?phone=… (or the x-sg-phone header) — caller-keyed,
 * NOT roster-gated: a neighbor who submitted a donation request or offer can
 * see their OWN rows here. contact_phone is matched by its last 10 digits —
 * the same phoneKey identity as push_tokens, so 4158797940 == 14158797940.
 * The WHERE clause is server-side; a caller can never see another person's
 * rows, and the route returns zero PII beyond the caller's own submission:
 * no other people's phones, no addresses, no photos, no notes, no claimed-by.
 *
 * Response rows are the caller's OWN data, pruned to the fields the My
 * Requests page renders: kind, id, category, title, quantity, size, status,
 * createdAt. Statuses are plain open/claimed/completed; the UI maps them to
 * calm EN/ES lines.
 *
 * Graceful: a missing or unreachable table returns the rows that exist (never
 * a crash, never a blank panic line).
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { normPhone } from "~/lib/peerSupportServer";
import { donationTableReady } from "~/lib/donationServer";

export interface MyDonationRow {
  kind: "offer" | "request";
  id: string;
  category: string;
  title: string;
  quantity: string | null;
  size: string | null;
  status: string;
  createdAt: string;
}

const last10 = (raw: string): string => raw.replace(/[^0-9]/g, "").slice(-10);

async function myDonations(c: { request: Request }): Promise<Response> {
  const url = new URL(c.request.url);
  const caller = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  if (caller.length < 10) {
    return Response.json(
      {
        ok: false,
        error: "Add your number first — then the items you ask for or offer will show up here.",
        code: "needs_phone",
        rows: [],
      },
      { status: 400 },
    );
  }
  const key = last10(caller);
  const rows: MyDonationRow[] = [];

  // Requests (item, size) …
  if (await donationTableReady("donation_requests")) {
    try {
      const r = (await sql()`
        select id, item, category, quantity, size, status, created_at
        from public.donation_requests
        where substring(contact_phone from length(contact_phone) - 9) = ${key}
        order by created_at desc
        limit 50`) as unknown as Array<Record<string, unknown>>;
      for (const x of r) {
        rows.push({
          kind: "request",
          id: String(x.id),
          category: String(x.category),
          title: String(x.item),
          quantity: x.quantity == null ? null : String(x.quantity),
          size: x.size == null ? null : String(x.size),
          status: String(x.status),
          createdAt: String(x.created_at),
        });
      }
    } catch {
      /* one table failing never blanks the other */
    }
  }

  // … and offers (item_description; no size column on this table).
  if (await donationTableReady("donation_offers")) {
    try {
      const r = (await sql()`
        select id, item_description, category, quantity, status, created_at
        from public.donation_offers
        where substring(contact_phone from length(contact_phone) - 9) = ${key}
        order by created_at desc
        limit 50`) as unknown as Array<Record<string, unknown>>;
      for (const x of r) {
        rows.push({
          kind: "offer",
          id: String(x.id),
          category: String(x.category),
          title: String(x.item_description),
          quantity: x.quantity == null ? null : String(x.quantity),
          size: null,
          status: String(x.status),
          createdAt: String(x.created_at),
        });
      }
    } catch {
      /* one table failing never blanks the other */
    }
  }

  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return Response.json({ ok: true, phone: key, rows });
}

export const Route = createFileRoute("/api/donations/mine")({
  server: {
    handlers: {
      GET: myDonations,
    },
  },
});
