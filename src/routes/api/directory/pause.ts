/**
 * POST /api/directory/pause { phone, target } — admin-only HomeTeam member
 * pause wrapping sg_hometeam_pause (spec §2.4: the RPC itself rejects
 * staff_limited callers — enforced here AND in the DB, so staff_limited
 * fails twice over; they may claim/deliver supplies but never change
 * roster/consent state).
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  OUTREACH_CALM_LINE,
  callerFrom,
  errOf,
  normOutreachPhone,
  outreachIdentity,
  rpc,
} from "~/lib/directoryServer";

async function pause(c: { request: Request }) {
  let body: { phone?: unknown; target?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with phone + target." }, { status: 400 });
  }
  const caller = callerFrom(c.request, body);
  const me = await outreachIdentity(caller);
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  const target = normOutreachPhone(body.target);
  if (target.length < 7) {
    return Response.json({ ok: false, error: "Which member? (phone missing)" }, { status: 400 });
  }
  try {
    await rpc("sg_hometeam_pause", [caller, target]);
    return Response.json({ ok: true, target, paused: true });
  } catch (e) {
    return Response.json({ ok: false, error: errOf(e) }, { status: 403 });
  }
}

export const Route = createFileRoute("/api/directory/pause")({
  server: {
    handlers: {
      POST: pause,
    },
  },
});
