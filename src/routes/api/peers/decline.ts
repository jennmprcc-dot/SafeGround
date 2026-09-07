/**
 * POST /api/peers/decline { phone, userId } — invitee says "Not now" (M4):
 * deletes the pending row SILENTLY. The inviter simply sees "no longer
 * pending" on their next refresh — never "declined by name", no blame.
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerRpc, userIdForPhone } from "~/lib/peerServer";

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
    return Response.json({ ok: true });
  } catch {
    // Decline is never a failure the inviter needs to see — silent by design.
    return Response.json({ ok: true });
  }
}

export const Route = createFileRoute("/api/peers/decline")({
  server: {
    handlers: {
      POST: declinePeer,
    },
  },
});