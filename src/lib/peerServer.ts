/**
 * Trusted-peers API glue (spec §1 — PEER-1/2/3 + NOTE-1).
 *
 * One RPC call helper + the calm error tail, mirroring directoryServer.ts:
 * `select public.<fn>(…)` rows come back as { v: jsonb }; Postgres raises
 * arrive wrapped in "…: <message>" — the UI only ever sees the calm tail.
 *
 * SAFETY CONTRACT (mirrors the schema RPCs, which are the enforcement layer):
 *  - Identity is ALWAYS the caller's own phone: digits-normalized from the
 *    x-sg-phone header or the body, and the caller's user id is resolved
 *    SERVER-SIDE from that phone (sg_peer_self inside every RPC re-verifies;
 *    the route never trusts a client-supplied user id).
 *  - Single-number lookup only (rate-limited ≤10/day in the DB), no lists, no
 *    enumeration. Never SMS from the app — invite codes are copied/shared by
 *    the user themself.
 *  - Mutual consent before anything is visible: pending invites expose a name
 *    only inside the invite row; accepted pairs are the only rows with
 *    check-in visibility — enforced by M4/M5 RPCs + the mutual-accept RLS.
 */
import { query } from "~/db";
import { normPhone, formatPhone } from "~/lib/alertIdentity";

export { formatPhone, normPhone };

export type PeerRpcRow = { [k: string]: unknown };

export async function peerRpc(fn: string, args: unknown[]): Promise<unknown> {
  const q = `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as v`;
  const rows = (await query(q, args)) as unknown as Array<PeerRpcRow>;
  return rows[0]?.v ?? null;
}

export const peerErrOf = (e: unknown): string => {
  const m = String((e as { message?: string })?.message ?? "").trim();
  const tail = m.includes(": ") ? m.slice(m.lastIndexOf(": ") + 2) : m;
  return tail.slice(0, 220) || "That didn't go through — nothing changed.";
};

/** Caller phone from ?phone=, the x-sg-phone header, or the body (normalized). */
export function peerCallerPhone(req: Request, body?: { phone?: unknown }): string {
  return normPhone(body?.phone ?? req.headers.get("x-sg-phone"));
}

/** Resolve the caller's users.id from their own phone (phone-identity → uuid).
 * Returns null when the phone has no user row yet — the route then raises the
 * calm "add your number first" line (sg_peer_self's own message). */
export async function userIdForPhone(phone: string): Promise<string | null> {
  if (!phone) return null;
  try {
    const rows = (await query(
      `select id from public.users where phone = $1 limit 1`,
      [phone],
    )) as unknown as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** A pending-invite "waiting" line — phone invites never expire (spec §1.2
 * PEER-1 STATE pending-invite: "Waiting for them to accept"; only code invites
 * show 48h). */
export const PHONE_INVITE_WAIT = "Waiting for them to accept";

/* ── The single server-side peer reader ─────────────────────────────
 * Extracted from GET /api/peers so the phone-keyed check-in path does NOT grow
 * a second peer reader (peer groups spec §2.1). Same SQL, same shape — the peer
 * screen and the check-in share sheet therefore always agree. Identity is the
 * caller's resolved users.id; a client user id is never involved. */
export interface PeerListEntry {
  userId: string;
  name: string;
  status: "accepted" | "pending";
  mutual: boolean;
  direction: "in" | "out";
  codeExpiresAt: string | null;
}
export async function listPeersForUser(requesterId: string): Promise<PeerListEntry[]> {
  if (!requesterId) return [];
  const rows = (await query(
    `select
        o.user_id as user_id,
        u.display_name as name,
        (a.peer_id is not null and b.peer_id is not null) as mutual,
        case
          when exists (
            select 1 from public.trusted_peers x
            where x.requester_id = o.user_id and x.peer_id = $1 and x.status = 'pending')
          then 'in' else 'out'
        end as direction,
        (
          select max(c.expires_at)::text
          from public.peer_invite_codes c
          where c.inviter_user_id = $1
            and c.redeemed_by = o.user_id and c.redeemed_at is not null
        ) as code_expires_at
      from (
        select distinct peer_id as user_id from public.trusted_peers where requester_id = $1
        union
        select distinct requester_id as user_id from public.trusted_peers where peer_id = $1
      ) o
      join public.users u on u.id = o.user_id
      left join public.trusted_peers a
        on a.requester_id = $1 and a.peer_id = o.user_id and a.status = 'accepted'
      left join public.trusted_peers b
        on b.requester_id = o.user_id and b.peer_id = $1 and b.status = 'accepted'
      order by mutual desc, u.display_name asc
      limit 100`,
    [requesterId],
  )) as unknown as Array<{
    user_id: string;
    name: string;
    mutual: boolean;
    direction: "out" | "in";
    code_expires_at: string | null;
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    status: r.mutual ? ("accepted" as const) : ("pending" as const),
    mutual: r.mutual,
    direction: r.direction,
    codeExpiresAt: r.code_expires_at,
  }));
}