/**
 * POST /api/checkin/sharing { phone, paused } — pause or resume sharing on the
 * caller's latest check-in (phone-keyed; the demo-UUID server-fn path is not
 * used here). `share_paused = true` hides the point INSTANTLY for everyone,
 * group members included: the peer_check_ins view filters paused rows, and the
 * view is the only peer-facing surface (R-P5 / AC-20).
 *
 * Identity: the caller's own phone only (x-sg-phone / ?phone= / body) resolved
 * server-side to users.id — a client user id is never trusted. The update is
 * scoped to the caller's OWN rows, so it can't reach anyone else's check-in.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { ADD_NUMBER_FIRST } from "~/lib/peerGroupServer";
import { peerCallerPhone, userIdForPhone } from "~/lib/peerServer";

async function setSharing(c: { request: Request }): Promise<Response> {
  let body: { phone?: unknown; paused?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const paused = body.paused === true;
  try {
    await sql()`
      update public.check_ins set share_paused = ${paused}
      where user_id = ${me}
        and id = (
          select id from public.check_ins
          where user_id = ${me}
          order by checked_in_at desc limit 1
        )`;
    return Response.json({ ok: true, paused });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — nothing changed. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/checkin/sharing")({
  server: {
    handlers: {
      POST: setSharing,
    },
  },
});
