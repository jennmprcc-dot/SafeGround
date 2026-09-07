/**
 * POST /api/directory/resume { phone, target } — admin-only HomeTeam member
 * resume wrapping sg_hometeam_resume (same double gate as pause: route-level
 * admin check plus the RPC's own is_roster_admin rejection).
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

async function resume(c: { request: Request }) {
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
    await rpc("sg_hometeam_resume", [caller, target]);
    return Response.json({ ok: true, target, paused: false });
  } catch (e) {
    return Response.json({ ok: false, error: errOf(e) }, { status: 403 });
  }
}

export const Route = createFileRoute("/api/directory/resume")({
  server: {
    handlers: {
      POST: resume,
    },
  },
});
