/**
 * POST /api/directory/consent { phone, afterHours, source } — self-service
 * neighbor opt-in for group updates (spec §2.1 M2) via
 * sg_notice_consents_upsert. The body phone must match the caller's own
 * x-sg-phone device header — anyone may set ONLY their own consent, never
 * anyone else's. Collected in-app via checkbox on the alert-sent +
 * peer-support success screens.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  errOf,
  normOutreachPhone,
  rpc,
} from "~/lib/directoryServer";

async function consent(c: { request: Request }) {
  let body: { phone?: unknown; afterHours?: unknown; source?: unknown; sms?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with phone." }, { status: 400 });
  }
  const headerPhone = normOutreachPhone(c.request.headers.get("x-sg-phone"));
  const phone = normOutreachPhone(body.phone);
  if (phone.length < 7 || headerPhone !== phone) {
    return Response.json(
      { ok: false, error: "That choice is tied to this phone — check the number and try again." },
      { status: 400 },
    );
  }
  const source = String(body.source ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "app";
  try {
    await rpc("sg_notice_consents_upsert", [phone, body.afterHours === true, source, body.sms === true]);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: errOf(e) }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/directory/consent")({
  server: {
    handlers: {
      POST: consent,
    },
  },
});
