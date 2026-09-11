/**
 * Admin-initiated staff PIN reset (owner-directed 2026-09-11).
 *
 * POST /api/outreach/reset-pin { adminPhone, adminPin, targetPhone, token }
 *
 * Three proofs, all server-side: the caller is an ACTIVE roster ADMIN (phone
 * + PIN), and the bootstrap secret SG_SETUP_TOKEN matches (env var; MISSING →
 * fail CLOSED bad_token). On success the target's pin_hash is cleared and
 * pin_must_set=true so they choose a fresh PIN on their next login. The setup
 * code is the owner's key, entered once per reset by the admin from the Team
 * tab — a stranger can never lock a staff member out (claim-attack guard).
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resetPinForStaff } from "~/lib/staffPin";

async function resetPin(c: { request: Request }) {
  let body: { adminPhone?: unknown; adminPin?: unknown; targetPhone?: unknown; token?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with adminPhone + adminPin + targetPhone + token." }, { status: 400 });
  }
  const result = await resetPinForStaff({
    adminPhone: String(body.adminPhone ?? "").trim(),
    adminPin: body.adminPin,
    targetPhone: String(body.targetPhone ?? "").trim(),
    setupToken: body.token,
  });
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error, code: result.code }, { status: 403 });
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/outreach/reset-pin")({
  server: {
    handlers: {
      POST: resetPin,
    },
  },
});