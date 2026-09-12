/**
 * First-login staff PIN setup (owner-directed 2026-09-11).
 *
 * POST /api/outreach/set-pin { phone, pin, token }
 *
 * Gated by the bootstrap secret SG_SETUP_TOKEN (env var the owner holds via
 * Secrets — MISSING env → fail CLOSED with bad_token, so nothing unlocks
 * without the owner's key). Roster phone must exist + be active; stores ONLY
 * a pgcrypto bcrypt hash — never the plaintext, never logged, never readable
 * back. On success pin_must_set=false so the next summary call opens the
 * dashboard with the new PIN.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { setPinForStaff } from "~/lib/staffPin";

async function setPin(c: { request: Request }) {
  let body: { phone?: unknown; pin?: unknown; token?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with phone + pin + token." }, { status: 400 });
  }
  const phone = String(body.phone ?? "").trim();
  const result = await setPinForStaff(phone, body.pin, body.token);
  if (!result.ok) {
    // Every failure is a calm 403 with a machine-readable code: bad_token
    // (token wrong or env missing), bad_pin (shape), not_staff (roster miss).
    return Response.json({ ok: false, error: result.error, code: result.code }, { status: 403 });
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/outreach/set-pin")({
  server: {
    handlers: {
      POST: setPin,
    },
  },
});