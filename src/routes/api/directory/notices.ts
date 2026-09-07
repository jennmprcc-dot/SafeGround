/**
 * GET /api/directory/notices?phone=… — sent-notice log (NOTICE-3, admin only).
 * staff_limited + non-roster callers fail server-side with the calm line.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  OUTREACH_CALM_LINE,
  errOf,
  normOutreachPhone,
  outreachIdentity,
  rpc,
} from "~/lib/directoryServer";

async function history(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normOutreachPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const me = await outreachIdentity(caller);
  if (me.role === null) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  try {
    const v = (await rpc("sg_notice_history", [caller])) as { ok?: boolean; notices?: unknown[] };
    if (!v || v.ok !== true) {
      return Response.json(
        { ok: false, error: "Couldn't load sent notices — try again in a moment." },
        { status: 503 },
      );
    }
    return Response.json({ ok: true, notices: v.notices ?? [] });
  } catch (e) {
    const msg = errOf(e);
    return Response.json({ ok: false, error: msg }, { status: msg === OUTREACH_CALM_LINE ? 403 : 503 });
  }
}

export const Route = createFileRoute("/api/directory/notices")({
  server: {
    handlers: {
      GET: history,
    },
  },
});
