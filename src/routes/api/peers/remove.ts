/**
 * POST /api/peers/remove { phone, userId } — remove a peer (or cancel an
 * outgoing pending invite) via M5: deletes BOTH directional rows instantly.
 * The ex-peer's view flips to "Not sharing" on the next refresh — never a
 * stale last point (the peer_check_ins view filter + mutual-accept RLS
 * already enforce it; the UI renders it).
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerErrOf, peerRpc, userIdForPhone } from "~/lib/peerServer";

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

export const Route = createFileRoute("/api/peers/remove")({
  server: {
    handlers: {
      POST: removePeer,
    },
  },
});