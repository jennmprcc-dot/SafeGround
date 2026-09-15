/**
 * POST /api/peers/bind { phone, name? } — create-or-bind the caller's
 * `public.users` row from their own phone (sg_peer_bind).
 *
 * WHY (the friend-tester bug, verified in code 2026-09-15): when a caller's
 * phone was captured on-device (getAlertIdentity/setAlertIdentity) NOTHING on
 * the server created the phone-bound `public.users` row, so `userIdForPhone()`
 * returned null for a fresh phone and every peer route died with "Add your
 * number first" — including a first invite. This route is that missing step.
 *
 * CONTRACT:
 *  - Create-or-bind, idempotent, safe to call on EVERY app open: an existing
 *    row for that phone is returned unchanged (never re-keyed, never overwritten
 *    with a different id); a first-contact phone gets a fresh row.
 *  - Identity comes from the caller's own phone (x-sg-phone / ?phone= / body) —
 *    a client-supplied user id is never accepted here.
 *  - Calm errors only; no invented data (a name is used only at first bind).
 *  - GET is a calm informational 200 (safe to hit from a health probe / a
 *    prefetch); the bind itself is POST.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ADD_NUMBER_FIRST, bindPhoneToUser } from "~/lib/peerGroupServer";
import { peerCallerPhone, peerErrOf } from "~/lib/peerServer";

async function bind(c: { request: Request }): Promise<Response> {
  let body: { phone?: unknown; name?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  try {
    const bound = await bindPhoneToUser(phone, name);
    if (!bound) {
      return Response.json(
        { ok: false, error: "Couldn't save your number just now — try again in a moment." },
        { status: 503 },
      );
    }
    // No phone digits echoed back — the caller already knows their own number.
    return Response.json({
      ok: true,
      bound: true,
      requesterId: bound.userId,
      requesterName: bound.name,
      created: bound.created,
    });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

function bindInfo(): Response {
  return Response.json({
    ok: true,
    hint: "POST { phone, name? } with your x-sg-phone header to bind this device's number.",
  });
}

export const Route = createFileRoute("/api/peers/bind")({
  server: {
    handlers: {
      GET: bindInfo,
      POST: bind,
    },
  },
});
