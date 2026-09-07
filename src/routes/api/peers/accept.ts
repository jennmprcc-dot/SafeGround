/**
 * Peer accept / decline / remove (spec §1.2 — PEER-1 states).
 *
 * POST /api/peers/accept  { phone, userId } — invitee accepts: flips the
 *   pending row to accepted AND writes the reciprocal accepted row (M4 —
 *   SECURITY DEFINER; the client never writes trusted_peers directly).
 * POST /api/peers/decline { phone, userId } — invitee says "Not now": deletes
 *   the pending row SILENTLY (M4). The inviter simply sees no longer-pending —
 *   never "declined by name", no blame.
 * POST /api/peers/remove  { phone, userId } — removes (or cancels an outgoing
 *   pending invite): deletes BOTH directional rows instantly (M5). An
 *   ex-peer's view flips to "Not sharing" on the next refresh, never a stale
 *   last point (view filter + RLS already enforce it; the UI renders it).
 *
 * Identity: caller phone from x-sg-phone / body, digits-only; the caller user
 * id is resolved server-side from that phone. RPCs re-verify (SECURITY
 * DEFINER). Calm errors only; decline is silent to the inviter.
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerErrOf, peerRpc, userIdForPhone } from "~/lib/peerServer";

async function acceptPeer(c: { request: Request }) {
  let body: { phone?: unknown; userId?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const otherId = String(body.userId ?? "").slice(0, 64);
  if (phone.length < 7 || !otherId) {
    return Response.json({ ok: false, error: "A phone number and the invite are needed." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first — then you can accept an invite." }, { status: 400 });
  }
  try {
    const v = (await peerRpc("sg_peer_accept", [me, phone, otherId])) as { ok?: boolean; status?: string };
    return Response.json({ ok: v?.ok !== false, status: v?.status ?? "accepted" });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

async function declinePeer(c: { request: Request }) {
  let body: { phone?: unknown; userId?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const otherId = String(body.userId ?? "").slice(0, 64);
  if (phone.length < 7 || !otherId) {
    return Response.json({ ok: false, error: "A phone number and the invite are needed." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first." }, { status: 400 });
  }
  try {
    await peerRpc("sg_peer_decline", [me, otherId]);
    // Silent: the inviter simply sees "no longer pending" on their next refresh.
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true }); // decline is never a failure the inviter needs to explain
  }
}

async function removePeer(c: { request: Request }) {
  let body: { phone?: unknown; userId?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const otherId = String(body.userId ?? "").slice(0, 64);
  if (phone.length < 7 || !otherId) {
    return Response.json({ ok: false, error: "A phone number and the peer are needed." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first." }, { status: 400 });
  }
  try {
    await peerRpc("sg_peer_remove", [me, otherId]);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/peers/accept")({
  server: {
    handlers: {
      POST: acceptPeer,
    },
  },
});