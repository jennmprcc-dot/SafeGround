/**
 * POST /api/peers/codes/use { phone, code } — redeem an invite code INTO a
 * pending invite (inviter → me). The redeemer still accepts on PEER-1 —
 * mutual consent preserved (sg_peer_code_redeem). Returns { ok, inviterName }.
 * Never SMS from the app — the inviter shared the code themself.
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerErrOf, peerRpc, userIdForPhone } from "~/lib/peerServer";

async function redeemCode(c: { request: Request }) {
  let body: { phone?: unknown; code?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone and the code." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (phone.length < 7 || code.length < 6) {
    return Response.json({ ok: false, error: "That code didn't work — check it or ask for a new one." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first — then you can redeem a code." }, { status: 400 });
  }
  try {
    const v = (await peerRpc("sg_peer_code_redeem", [me, code])) as { ok?: boolean; inviter_name?: string | null };
    if (!v || v.ok !== true) {
      return Response.json({ ok: false, error: "That code didn't work — check it or ask for a new one." }, { status: 400 });
    }
    return Response.json({ ok: true, inviterName: v.inviter_name ?? "a peer" });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/peers/codes/use")({
  server: {
    handlers: {
      POST: redeemCode,
    },
  },
});