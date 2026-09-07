/**
 * POST /api/directory/notice { phone, title, body, audience } — admin-only
 * group-notice send (NOTICE-2).
 *
 * sg_send_group_notice validates (≤80/≤500, non-empty, known audience),
 * enforces the admin gate + business-hours rule, raises on an empty audience
 * (nothing logged, zero FCM calls), writes the log row, and returns recipient
 * phones. Fan-out happens here in the route layer: sendFcmMessage per
 * registered token (best-effort per token), then sent_count /
 * skipped_no_token are written back to the log row for MPRCC reporting.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  OUTREACH_CALM_LINE,
  callerFrom,
  errOf,
  outreachIdentity,
  rpc,
} from "~/lib/directoryServer";
import { sendFcmMessage, tokensForPhone } from "~/lib/pushServer";

async function sendNotice(c: { request: Request }) {
  let body: { phone?: unknown; title?: unknown; body?: unknown; audience?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body with phone + title + body + audience." },
      { status: 400 },
    );
  }
  const caller = callerFrom(c.request, body);
  const me = await outreachIdentity(caller);
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  const title = String(body.title ?? "").trim().slice(0, 120);
  const text = String(body.body ?? "").trim().slice(0, 700);
  const audience = String(body.audience ?? "").trim().toLowerCase();
  if (!title || !text || (audience !== "hometeam" && audience !== "neighbors" && audience !== "both")) {
    return Response.json(
      { ok: false, error: "A headline, a few lines, and an audience — then review before sending." },
      { status: 400 },
    );
  }
  try {
    const v = (await rpc("sg_send_group_notice", [caller, title, text, audience])) as {
      ok?: boolean;
      notice_id?: string;
      phones?: string[];
      eligible?: number;
      skipped_after_hours?: number;
    };
    if (!v || v.ok !== true || !v.notice_id) {
      return Response.json({ ok: false, error: "That didn't go through — nothing was sent." }, { status: 503 });
    }
    const phones = Array.isArray(v.phones) ? v.phones.map(String) : [];
    let sent = 0;
    let skippedNoToken = 0;
    for (const p of phones) {
      const tokens = await tokensForPhone(p);
      if (tokens.length === 0) {
        skippedNoToken += 1;
        continue;
      }
      let delivered = false;
      for (const t of tokens) {
        try {
          const r = await sendFcmMessage({ token: t, title, body: text });
          if (r.status === "sent") delivered = true;
        } catch {
          /* best-effort per token — counted below */
        }
      }
      if (delivered) sent += 1;
      else skippedNoToken += 1;
    }
    try {
      await sql()`
        update public.group_notices
        set sent_count = ${sent}, skipped_no_token = ${skippedNoToken}
        where id = ${v.notice_id}::uuid`;
    } catch {
      /* counts update is best-effort — the log row already exists */
    }
    return Response.json({
      ok: true,
      noticeId: v.notice_id,
      eligible: Number(v.eligible ?? phones.length),
      sent,
      skippedAfterHours: Number(v.skipped_after_hours ?? 0),
      skippedNoToken,
    });
  } catch (e) {
    return Response.json({ ok: false, error: errOf(e) }, { status: 403 });
  }
}

export const Route = createFileRoute("/api/directory/notice")({
  server: {
    handlers: {
      POST: sendNotice,
    },
  },
});
