/**
 * Register / update a Firebase web-push token (POST).
 *
 * The browser obtains an FCM registration token after the user taps "Allow"
 * and pushes it here so the server can reach THIS device later. The row is
 * keyed by (phone, token) — phone is the sg_norm_phone identity, token is the
 * FCM token. Consent is the user's "Allow" tap plus this explicit store call;
 * the server never pushes to a phone without a stored token.
 *
 * Gate: callerPhone must match the body phone (and the RLS on push_tokens
 * phones the row to the request's x-sg-phone header — server-side double
 * check). NEVER stores a token for a phone the caller didn't claim.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

const normPhone = (raw: unknown): string =>
  String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 20);

async function registerPush(c: { request: Request }) {
  let body: { phone?: unknown; token?: unknown; deviceLabel?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with phone + token." }, { status: 400 });
  }
  const phone = normPhone(body.phone);
  const token = String(body.token ?? "").trim().slice(0, 512);
  const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel.trim().slice(0, 60) : "";
  const headerPhone = normPhone((c.request.headers.get("x-sg-phone") ?? "").replace(/^\+/, ""));
  if (!phone || phone.length < 10) {
    return Response.json({ ok: false, error: "A valid phone is required to register push." }, { status: 400 });
  }
  if (!token || token.length < 20) {
    return Response.json({ ok: false, error: "No FCM token to save — allow notifications first." }, { status: 400 });
  }
  if (headerPhone && headerPhone !== phone) {
    return Response.json({ ok: false, error: "Phone mismatch — token not saved." }, { status: 403 });
  }
  try {
    await sql()`
      insert into public.push_tokens (phone, token, device_label, updated_at)
      values (${phone}, ${token}, ${deviceLabel || null}, now())
      on conflict (phone, token)
      do update set device_label = excluded.device_label, updated_at = now()`;
    return Response.json({ ok: true, phone, registered: true });
  } catch {
    return Response.json(
      { ok: false, error: "Push token not saved — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/push/register")({
  server: {
    handlers: {
      POST: registerPush,
    },
  },
});