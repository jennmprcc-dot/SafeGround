/**
 * Invite-code API (spec §1.2 PEER-3 — existing AC-C2 pattern, kept as
 * fallback; 6-char codes, 48h expiry, never SMS from the app).
 *
 * POST /api/peers/codes      { phone }        → mint (or reuse my live) code:
 *   { ok, code, expiresAt }  "Expires in 48h. Only share with someone you
 *   trust." The invitee copies/shares it themself via the system share sheet.
 * POST /api/peers/codes/use  { phone, code }  → redeem a code INTO a pending
 *   invite (inviter → me); the redeemer still accepts on PEER-1 — mutual
 *   consent preserved (sg_peer_code_redeem). Returns { ok, inviterName }.
 *
 * Identity: caller phone from ?phone=/x-sg-phone/body, digits-only; caller
 * user id resolved server-side. RPC re-verifies (SECURITY DEFINER); calm
 * errors (expired code → "Codes last 48h — ask them to make a new one.").
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerErrOf, peerRpc, userIdForPhone } from "~/lib/peerServer";

const ISO = (d: unknown): string | null =>
  d == null ? null : typeof d === "string" ? d : new Date(d as Date).toISOString();

async function createCode(c: { request: Request }) {
  let body: { phone?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: "Add your number first — then you can share an invite code." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first — then you can share an invite code." }, { status: 400 });
  }
  try {
    const v = (await peerRpc("sg_peer_code_create", [me])) as { ok?: boolean; code?: string; expires_at?: unknown };
    if (!v || v.ok !== true || !v.code) {
      return Response.json({ ok: false, error: "That didn't go through — try again in a moment." }, { status: 503 });
    }
    return Response.json({ ok: true, code: v.code, expiresAt: ISO(v.expires_at) });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/peers/codes")({
  server: {
    handlers: {
      POST: createCode,
    },
  },
});