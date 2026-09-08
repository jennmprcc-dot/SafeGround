/**
 * Roster-admin peer-support queue (owner-directed 2026-09-06).
 *
 * GET /api/peer-support/queue?phone=…[&status=open|all] — open + claimed by
 *   default (the working queue); status=all for recent history. Gated
 *   server-side: caller must be an ACTIVE roster admin (isRosterAdmin), which
 *   degrades gracefully to not-admin when the roster table is missing.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { isRosterAdmin } from "~/lib/pushServer";
import {
  MISSING_TABLE_MSG,
  normPhone,
  peerSupportTableReady,
} from "~/lib/peerSupportServer";

async function listQueue(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  if (!(await isRosterAdmin(caller))) {
    return Response.json(
      { ok: false, error: "This queue is for the MPRCC outreach team." },
      { status: 403 },
    );
  }
  if (!(await peerSupportTableReady())) {
    return Response.json({ ok: false, error: MISSING_TABLE_MSG, code: "no_table" }, { status: 503 });
  }
  const status = String(url.searchParams.get("status") ?? "open").toLowerCase();
  const filter = status === "all" ? ["open", "claimed", "done", "closed"] : ["open", "claimed"];
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
    const rows = (urgentCols
      ? ((await sql()`
      select id, phone, name_optional, note, status, claimed_by_phone,
             delegate_to_phone, outcome_note, created_at, updated_at,
             coalesce(is_urgent, false) as is_urgent, need_category, location,
             fuzz_lat, fuzz_lng, (exact_lat is not null and exact_lng is not null) as has_exact,
             expires_at
      from public.peer_support_requests
      where status = any(${filter})
      order by is_urgent desc, created_at desc
      limit 50`) as unknown as Array<Record<string, unknown>>)
      : ((await sql()`
      select id, phone, name_optional, note, status, claimed_by_phone,
             delegate_to_phone, outcome_note, created_at, updated_at
      from public.peer_support_requests
      where status = any(${filter})
      order by created_at desc
      limit 50`) as unknown as Array<Record<string, unknown>>));
    return Response.json({
      ok: true,
      requests: rows.map((r) => ({
        id: String(r.id),
        phone: String(r.phone),
        name: r.name_optional == null ? null : String(r.name_optional),
        note: r.note == null ? null : String(r.note),
        status: String(r.status),
        claimedBy: r.claimed_by_phone == null ? null : String(r.claimed_by_phone),
        delegateTo: r.delegate_to_phone == null ? null : String(r.delegate_to_phone),
        outcomeNote: r.outcome_note == null ? null : String(r.outcome_note),
        isUrgent: r.is_urgent === true,
        needCategory: r.need_category == null ? null : String(r.need_category),
        location: r.location == null ? null : String(r.location),
        fuzzLat: r.fuzz_lat == null || r.fuzz_lat === "" ? null : Number(r.fuzz_lat),
        fuzzLng: r.fuzz_lng == null || r.fuzz_lng === "" ? null : Number(r.fuzz_lng),
        hasExact: r.has_exact === true,
        expiresAt: r.expires_at == null ? null : String(r.expires_at),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the queue — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/peer-support/queue")({
  server: {
    handlers: {
      GET: listQueue,
    },
  },
});
