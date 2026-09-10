/**
 * Create + list a neighbor's peer-support requests (owner-directed 2026-09-06).
 *
 * POST /api/peer-support — one tap creates the row, then fans a Firebase
 *   push out to the two roster admins ONLY (Jenn + Bambi). The queue always
 *   keeps the request; the push is best-effort (works once admin devices have
 *   registered tokens). Never 911, never SMS, never the requester themself.
 * GET /api/peer-support?phone=… — the caller's own requests ("we got it" view).
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  MISSING_TABLE_MSG,
  fanOutToAdmins,
  normPhone,
  peerSupportTableReady,
} from "~/lib/peerSupportServer";
import {
  insertAnalyticsEvent,
} from "~/lib/analytics/server";

async function createRequest(c: { request: Request }) {
  let body: { phone?: unknown; name?: unknown; note?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = normPhone(body.phone);
  const name = String(body.name ?? "").trim().slice(0, 40);
  const note = String(body.note ?? "").trim().slice(0, 500);
  if (phone.length < 10) {
    return Response.json(
      { ok: false, error: "A phone number is needed so a peer can reach you back." },
      { status: 400 },
    );
  }
  if (!(await peerSupportTableReady())) {
    return Response.json({ ok: false, error: MISSING_TABLE_MSG, code: "no_table" }, { status: 503 });
  }
  try {
    const rows = (await sql()`
      insert into public.peer_support_requests (phone, name_optional, note)
      values (${phone}, ${name || null}, ${note || null})
      returning id, status, created_at`) as unknown as Array<{
      id: string;
      status: string;
      created_at: Date;
    }>;
    const row = rows[0];
    // Analytics (anonymous, fire-and-forget): the request REALLY landed in
    // the DB above, so count it. Category stays null — the form has no
    // category field (owner decision pending). A logging failure must never
    // break the request itself.
    try {
      await insertAnalyticsEvent("peer_support_request", { status: "open" });
    } catch {
      /* silent — the request already succeeded */
    }
    const { notifiedPhones, tokensSent } = await fanOutToAdmins(name);
    // SMS twin fan-out (owner-directed 2026-09-10): staff SMS dispatch
    // recipients get the same message as the push above. Best-effort — never
    // fails the request. Lazy import: smsServer reads process.env secrets and
    // must never land in a client bundle (2026-09-08 client-bundle-leak lesson).
    let sms: typeof import("~/lib/smsServer") | null = null;
    try {
      sms = await import("~/lib/smsServer");
    } catch {
      sms = null;
    }
    let smsResult = { notifiedPhones: 0, sent: 0, noConsent: 0 };
    let smsNote: string | null = null;
    if (sms) {
      try {
        smsResult = await sms.sendSmsToStaff(name);
      } catch {
        /* never throws by contract, but best-effort all the same */
      }
      if (!sms.smsConfig()) smsNote = sms.SMS_NOT_CONFIGURED;
    }
    return Response.json({
      ok: true,
      id: row.id,
      status: row.status,
      createdAt: String(row.created_at),
      // Honest signal: the queue ALWAYS has it; the push reached the team only
      // when an admin device had registered for push.
      teamNotified: notifiedPhones > 0 && tokensSent > 0,
      // SMS fan-out counts (absent smsNote = team texts attempted when wired).
      sms: smsResult,
      smsNote,
    });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

async function listMine(c: { request: Request }) {
  const url = new URL(c.request.url);
  const phone = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  if (phone.length < 10) {
    return Response.json(
      { ok: false, error: "A phone number is needed to look up your requests." },
      { status: 400 },
    );
  }
  if (!(await peerSupportTableReady())) {
    return Response.json({ ok: false, error: MISSING_TABLE_MSG, code: "no_table" }, { status: 503 });
  }
  try {
    const rows = (await sql()`
      select id, status, note, claimed_by_phone, created_at, updated_at
      from public.peer_support_requests
      where phone = ${phone}
      order by created_at desc
      limit 20`) as unknown as Array<Record<string, unknown>>;
    return Response.json({
      ok: true,
      requests: rows.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        note: r.note == null ? null : String(r.note),
        claimed: r.claimed_by_phone != null,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load your requests — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/peer-support/")({
  server: {
    handlers: {
      POST: createRequest,
      GET: listMine,
    },
  },
});
