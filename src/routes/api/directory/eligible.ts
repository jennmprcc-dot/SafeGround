/**
 * GET /api/directory/eligible?phone=…&audience=… — pre-send eligibility counts
 * for the notice confirm screen (spec §2.3). Any roster role may read counts
 * (the COMPOSER page itself stays admin-only); the SEND set is computed in
 * sg_send_group_notice at send time — client counts are "~N" estimates only.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  OUTREACH_CALM_LINE,
  errOf,
  normOutreachPhone,
  outreachIdentity,
  rpc,
} from "~/lib/directoryServer";

async function eligible(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normOutreachPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const me = await outreachIdentity(caller);
  if (me.role === null) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  const audience = String(url.searchParams.get("audience") ?? "").trim().toLowerCase();
  if (audience !== "hometeam" && audience !== "neighbors" && audience !== "both") {
    return Response.json(
      { ok: false, error: "Choose HomeTeam, neighbors, or both first." },
      { status: 400 },
    );
  }
  try {
    const v = (await rpc("sg_notice_eligible", [caller, audience])) as {
      ok?: boolean;
      eligible?: number;
      skipped_after_hours?: number;
    };
    if (!v || v.ok !== true) {
      return Response.json(
        { ok: false, error: "Couldn't count right now — try again in a moment." },
        { status: 503 },
      );
    }
    return Response.json({
      ok: true,
      audience,
      eligible: Number(v.eligible ?? 0),
      skippedAfterHours: Number(v.skipped_after_hours ?? 0),
    });
  } catch (e) {
    const msg = errOf(e);
    return Response.json({ ok: false, error: msg }, { status: msg === OUTREACH_CALM_LINE ? 403 : 503 });
  }
}

export const Route = createFileRoute("/api/directory/eligible")({
  server: {
    handlers: {
      GET: eligible,
    },
  },
});
