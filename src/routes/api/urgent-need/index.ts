/**
 * Urgent-need action (owner-directed 2026-09-08): "I need help now".
 *
 * POST /api/urgent-need { phone, name?, note?, category, location,
 *   fuzzLat?, fuzzLng?, exactLat?, exactLng?, notifyStaff? }
 *   category: help | advocacy | er_ride | er_supplies | support (owner's
 *     exact five, required, reviewed)
 *   location: none | fuzzed | exact — the sender's explicit choice, NEVER
 *     pre-selected; the server rejects a missing location.
 *   notifyStaff: "Notify MPRCC staff" consent, default ON (owner A&B).
 *     false suppresses the admin push ONLY — the request still records.
 *     Absent/true notifies the two roster admins as usual.
 *
 * SAFETY CONTRACT (same as peer support — this reuses that exact path):
 *  - The row lands in peer_support_requests with is_urgent=true + need_category,
 *    so it appears in the SAME outreach queue for claim/delegation.
 *  - Push goes ONLY to the two roster admins via fanOutToAdmins (Jenn + Bambi).
 *    Trusted peers/friends are NEVER notified of urgent needs — their channel
 *    stays the existing check-in / trusted-peers safety visibility.
 *  - Never 911, never any agency, never SMS, never the requester themself.
 *  - Exact coords expire with the request: the done/claim route clears exact
 *    when the request resolves; the API never returns exact to the queue UI.
 *  - 24h expiry (expires_at), mirroring the emergency-alert window.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  MISSING_TABLE_MSG,
  fanOutToAdmins,
  isUrgentNeedCategory,
  isUrgentNeedLocation,
  normPhone,
  peerSupportTableReady,
  type UrgentNeedCategory,
} from "~/lib/peerSupportServer";
import { insertAnalyticsEvent } from "~/lib/analytics/server";

function numOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

async function createUrgentNeed(c: { request: Request }) {
  let body: {
    phone?: unknown;
    name?: unknown;
    note?: unknown;
    category?: unknown;
    location?: unknown;
    fuzzLat?: unknown;
    fuzzLng?: unknown;
    exactLat?: unknown;
    exactLng?: unknown;
    notifyStaff?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = normPhone(body.phone);
  const name = String(body.name ?? "").trim().slice(0, 40);
  const note = String(body.note ?? "").trim().slice(0, 500);
  const category: UrgentNeedCategory | null = isUrgentNeedCategory(body.category)
    ? body.category
    : null;
  const location = isUrgentNeedLocation(body.location) ? body.location : null;
  if (phone.length < 10) {
    return Response.json(
      { ok: false, error: "A phone number is needed so the team can reach you back." },
      { status: 400 },
    );
  }
  if (!category) {
    return Response.json(
      { ok: false, error: "Please choose what you need — Help, Advocacy, ER ride, ER supplies, or Support." },
      { status: 400 },
    );
  }
  // Owner A&B: notify-staff consent, default ON. Only an explicit false
  // suppresses the push — the request still records either way.
  const notifyStaff = body.notifyStaff !== false;
  // Never-pre-selected guard (client + server): location must be explicit.
  if (!location) {
    return Response.json(
      { ok: false, error: "Please choose how much location to share — none, an approximate area, or the exact spot." },
      { status: 400 },
    );
  }
  const fuzzLat = location === "fuzzed" ? numOrNull(body.fuzzLat) : null;
  const fuzzLng = location === "fuzzed" ? numOrNull(body.fuzzLng) : null;
  const exactLat = location === "exact" ? numOrNull(body.exactLat) : null;
  const exactLng = location === "exact" ? numOrNull(body.exactLng) : null;
  if (location === "fuzzed" && (fuzzLat == null || fuzzLng == null)) {
    return Response.json(
      { ok: false, error: "Couldn't read your approximate area — pick No location to send with words only, or try again." },
      { status: 400 },
    );
  }
  if (location === "exact" && (exactLat == null || exactLng == null)) {
    return Response.json(
      { ok: false, error: "Couldn't read your exact spot — pick No location to send with words only, or try again." },
      { status: 400 },
    );
  }
  if (!(await peerSupportTableReady())) {
    return Response.json({ ok: false, error: MISSING_TABLE_MSG, code: "no_table" }, { status: 503 });
  }
  // Urgent columns arrive with the schema update; when the live DB predates
  // the migration, fall back to a plain peer-support-shaped row so the request
  // still lands in the queue (category travels in the note instead).
  let urgentCols = false;
  try {
    const probe = (await sql()`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'peer_support_requests'
        and column_name = 'is_urgent' limit 1`) as unknown as Array<unknown>;
    urgentCols = probe.length > 0;
  } catch {
    urgentCols = false;
  }
  try {
    type NewRow = { id: string; status: string; created_at: Date };
    const rows = urgentCols
      ? ((await sql()`
      insert into public.peer_support_requests
        (phone, name_optional, note, is_urgent, need_category, location,
         fuzz_lat, fuzz_lng, exact_lat, exact_lng, expires_at)
      values (${phone}, ${name || null}, ${note || null}, true, ${category}, ${location},
        ${fuzzLat}, ${fuzzLng}, ${exactLat}, ${exactLng}, now() + interval '24 hours')
      returning id, status, created_at`) as unknown as Array<NewRow>)
      : ((await sql()`
      insert into public.peer_support_requests (phone, name_optional, note)
      values (${phone}, ${name || null},
        ${"[urgent need: " + category + "] " + (note || "(no note)")})
      returning id, status, created_at`) as unknown as Array<NewRow>);
    const row = rows[0];
    // Analytics (anonymous, fire-and-forget): the request REALLY landed, so
    // count it with its category. A logging failure never breaks the request.
    try {
      await insertAnalyticsEvent("peer_support_request", { category, status: "urgent-open" });
    } catch {
      /* silent — the request already succeeded */
    }
    // SAME proven push path as peer support: both admin phones get the
    // push UNLESS the sender unchecked "Notify MPRCC staff" (owner A&B —
    // the row still records, the queue still shows it, only the push stops).
    const { notifiedPhones, tokensSent } = notifyStaff
      ? await fanOutToAdmins(name, { urgentCategory: category })
      : { notifiedPhones: 0, tokensSent: 0 };
    return Response.json({
      ok: true,
      id: row.id,
      status: row.status,
      createdAt: String(row.created_at),
      // Honest signal: the queue ALWAYS has it; the push reached the team only
      // when an admin device had registered for push.
      teamNotified: notifiedPhones > 0 && tokensSent > 0,
    });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/urgent-need/")({
  server: {
    handlers: {
      POST: createUrgentNeed,
    },
  },
});
