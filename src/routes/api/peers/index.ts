/**
 * Trusted-peers API (spec §1.2 — PEER-1 list + PEER-2 phone invite).
 *
 * GET  /api/peers?phone=…  → the caller's trusted-peers state:
 *   { ok, requesterId, requesterName, phone, peers: […], notes: […] }
 *   peers[]: { userId, name, status: pending|accepted, mutual, direction:
 *             'out' (I invited them) | 'in' (they invited me) }
 *   Pending phone invites carry NO expiry — only code invites show 48h.
 *
 * POST /api/peers  { phone, targetPhone } → invite by phone:
 *   { ok, status: pending|accepted, displayName, noAccount? }
 *   noAccount:true → the kind "No neighbor on that number yet." panel
 *   (→ PEER-3 code path). Idempotent; calm errors only.
 *
 * Phone identity: caller phone from ?phone= / x-sg-phone / body, digits-only
 * (normPhone). Server-side gates: RPCs are SECURITY DEFINER and verify the
 * caller against the phone↔user binding themselves — this route never trusts
 * a client-supplied user id. Never SMS from the app.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  peerCallerPhone,
  peerErrOf,
  peerRpc,
  userIdForPhone,
} from "~/lib/peerServer";

async function listPeers(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = peerCallerPhone(c.request, { phone: url.searchParams.get("phone") });
  if (caller.length < 7) {
    return Response.json({ ok: false, error: "A phone number is needed to see your trusted peers." }, { status: 400 });
  }
  const requesterId = await userIdForPhone(caller);
  if (!requesterId) {
    // No user row bound to this phone yet — nothing to show, calm line.
    return Response.json({ ok: true, requesterId: null, requesterName: null, phone: caller, peers: [], notes: [] });
  }
  try {
    // Distinct other-user ids (both directions of the pairing table), then
    // resolve name + mutual acceptance + invitation direction. A pair shows as
    // mutual only when BOTH directional rows are accepted (DB-enforced).
    // codeExpiresAt: set only for outgoing pending invites that came from a
    // redeemed 6-char code — the "expires in 48h" line (PEER-3). Phone invites
    // carry NO expiry (spec §1.2 pending-out state).
    const rows = (await sql()`
      select
        o.user_id as user_id,
        u.display_name as name,
        (a.peer_id is not null and b.peer_id is not null) as mutual,
        case
          when exists (
            select 1 from public.trusted_peers x
            where x.requester_id = o.user_id and x.peer_id = ${requesterId} and x.status = 'pending')
          then 'in' else 'out'
        end as direction,
        (
          select max(c.expires_at)::text
          from public.peer_invite_codes c
          where c.inviter_user_id = ${requesterId}
            and c.redeemed_by = o.user_id and c.redeemed_at is not null
        ) as code_expires_at
      from (
        select distinct peer_id as user_id from public.trusted_peers where requester_id = ${requesterId}
        union
        select distinct requester_id as user_id from public.trusted_peers where peer_id = ${requesterId}
      ) o
      join public.users u on u.id = o.user_id
      left join public.trusted_peers a
        on a.requester_id = ${requesterId} and a.peer_id = o.user_id and a.status = 'accepted'
      left join public.trusted_peers b
        on b.requester_id = o.user_id and b.peer_id = ${requesterId} and b.status = 'accepted'
      order by mutual desc, u.display_name asc
      limit 100`) as unknown as Array<{
      user_id: string;
      name: string;
      mutual: boolean;
      direction: "out" | "in";
      code_expires_at: string | null;
    }>;

    // Saved notes (NOTE-1 sender view) — delivered_at NULL = "saved, not yet
    // delivered"; the UI reads this as the honest saved-not-sent status.
    const notes = (await sql()`
      select
        n.id,
        n.note,
        split_part(u.display_name, ' ', 1) as recipient_name,
        n.created_at,
        case when n.delivered_at is null then 'saved' else 'delivered' end as status
      from public.peer_notes n
      join public.users u on u.id = n.recipient_user_id
      where n.sender_user_id = ${requesterId}
      order by n.created_at desc
      limit 50`) as unknown as Array<{
      id: string;
      note: string;
      recipient_name: string;
      created_at: string | Date;
      status: string;
    }>;

    const me = (await sql()`
      select display_name from public.users where id = ${requesterId} limit 1
    `) as unknown as Array<{ display_name: string }>;

    return Response.json({
      ok: true,
      requesterId,
      requesterName: me[0]?.display_name ?? null,
      phone: caller,
      peers: rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        status: r.mutual ? ("accepted" as const) : ("pending" as const),
        mutual: r.mutual,
        direction: r.direction,
        codeExpiresAt: r.code_expires_at,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        note: n.note,
        recipientName: n.recipient_name,
        createdAt: typeof n.created_at === "string" ? n.created_at : new Date(n.created_at).toISOString(),
        status: n.status,
      })),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load your peers — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

async function invitePeer(c: { request: Request }) {
  let body: { phone?: unknown; targetPhone?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone and theirs." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const target = String(body.targetPhone ?? "").replace(/[^0-9]/g, "").slice(0, 20);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: "Add your own number first — then you can invite someone you trust." }, { status: 400 });
  }
  if (target.length < 7) {
    return Response.json({ ok: false, error: "That number looks incomplete — check it and try again, no rush." }, { status: 400 });
  }
  const requesterId = await userIdForPhone(phone);
  if (!requesterId) {
    return Response.json(
      { ok: false, error: "Add your number first — then you can invite someone you trust." },
      { status: 400 },
    );
  }
  try {
    const v = (await peerRpc("sg_peer_invite", [requesterId, target])) as {
      ok?: boolean;
      status?: string;
      display_name?: string | null;
    };
    if (!v || v.ok !== true) {
      return Response.json({ ok: false, error: "That didn't go through — try again in a moment." }, { status: 503 });
    }
    return Response.json({
      ok: true,
      status: v.status,
      displayName: v.display_name ?? null,
      noAccount: false,
    });
  } catch (e) {
    const msg = peerErrOf(e);
    // The RPC's own calm line for an unknown number — the UI shows the kind
    // no-account panel (NOT an error) + the share-a-code path.
    if (/No neighbor on that number yet/.test(msg)) {
      return Response.json({ ok: true, noAccount: true, status: null, displayName: null });
    }
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/peers/")({
  server: {
    handlers: {
      GET: listPeers,
      POST: invitePeer,
    },
  },
});