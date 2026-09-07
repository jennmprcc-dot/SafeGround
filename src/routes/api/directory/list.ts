/**
 * GET /api/directory/list?phone=… — staff-gated community roster (DIR-1/DIR-2).
 *
 * sg_directory_list returns role-split rows server-side: admin sees full
 * rows (phone, kind, opt-in flags); staff_limited sees REDACTED rows (names +
 * kind + active only — zero phone digits, never client filtering). Non-roster
 * callers get the calm line, never counts.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  OUTREACH_CALM_LINE,
  errOf,
  normOutreachPhone,
  outreachIdentity,
  rpc,
} from "~/lib/directoryServer";

async function listDir(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normOutreachPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const me = await outreachIdentity(caller);
  if (me.role === null) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  try {
    const v = (await rpc("sg_directory_list", [caller])) as {
      ok?: boolean;
      role?: string;
      members?: unknown[];
    };
    if (!v || v.ok !== true) {
      return Response.json(
        { ok: false, error: "Couldn't load the community — try again in a moment." },
        { status: 503 },
      );
    }
    return Response.json({ ok: true, role: me.role, name: me.name, members: v.members ?? [] });
  } catch (e) {
    const msg = errOf(e);
    return Response.json({ ok: false, error: msg }, { status: msg === OUTREACH_CALM_LINE ? 403 : 503 });
  }
}

export const Route = createFileRoute("/api/directory/list")({
  server: {
    handlers: {
      GET: listDir,
    },
  },
});
