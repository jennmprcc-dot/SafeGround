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