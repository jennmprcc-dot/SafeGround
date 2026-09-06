/**
 * Server-gated Firebase push send (POST).
 *
 * Two modes:
 *  - { phone, title, body, link }    → look up that phone's registered tokens
 *  - { token, title, body, link }    → send to that exact device token
 *  - { phone|token, title, body, link, validateOnly: true } → FCM
 *    validate_only (auth + validation only — NO delivery). Use for the test
 *    button's "Check wiring" step.
 *
 * GATE (server-side, never client trust): the caller may only send to their
 * OWN phone, or (as a roster admin) to roster recipients. The peer-support
 * request path targets only the two roster admins (PEER_SUPPORT_ADMIN_PHONES
 * in pushServer.ts) — never anyone else, never 911 / any agency. Consent is
 * device-level: only tokens that phone registered are ever delivered to.
 * Business-hours rules apply in the CALLING routes (alerts / group notices),
 * not to self-tests or admin sends.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { gateSend, sendFcmMessage, tokensForPhone } from "~/lib/pushServer";

async function sendPush(c: { request: Request }) {
  let body: {
    phone?: unknown; token?: unknown; title?: unknown; body?: unknown;
    link?: unknown; validateOnly?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body first." }, { status: 400 });
  }
  const callerPhone = String(body.phone ?? "").replace(/[^0-9]/g, "").slice(0, 20);
  const token = typeof body.token === "string" ? body.token.trim().slice(0, 512) : "";
  const title = String(body.title ?? "").trim().slice(0, 120) || "SafeGround";
  const fireBody = String(body.body ?? "").trim().slice(0, 500) || "";
  const link = typeof body.link === "string" ? body.link.trim().slice(0, 500) : undefined;
  const validateOnly = body.validateOnly === true;
  if (!fireBody) return Response.json({ ok: false, error: "Write a short message to send." }, { status: 400 });

  const gate = await gateSend(callerPhone, callerPhone, token);
  if (!gate.allowed) {
    return Response.json(
      { ok: false, error: gate.reason ?? "Not allowed to push to that phone." },
      { status: 403 },
    );
  }

  if (!token && !callerPhone) {
    return Response.json({ ok: false, error: "No phone or token to send to." }, { status: 400 });
  }

  const targets: string[] = token ? [token] : await tokensForPhone(callerPhone);
  if (targets.length === 0) {
    return Response.json(
      { ok: false, error: "No device has registered for push on this phone yet — tap Allow, then try again.", code: "no_tokens" },
      { status: 404 },
    );
  }

  const results = [];
  for (const t of targets) {
    try {
      results.push(await sendFcmMessage({ token: t, title, body: fireBody, link, validateOnly }));
    } catch (e) {
      results.push({
        to: `${t.slice(0, 12)}…`,
        status: "error",
        detail: e instanceof Error ? e.message.slice(0, 160) : "send failed",
      });
    }
  }
  const sent = results.filter((r) => r.status === "sent").length;
  const unregistered = results.filter((r) => r.status === "unregistered").length;
  return Response.json({ ok: sent > 0, results, sent, unregistered, validateOnly });
}

export const Route = createFileRoute("/api/push/send")({
  server: {
    handlers: {
      POST: sendPush,
    },
  },
});