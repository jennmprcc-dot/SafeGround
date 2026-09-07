/**
 * Admin claim / delegate / mark-done for peer-support requests
 * (owner-directed 2026-09-06).
 *
 * POST /api/peer-support/claim { phone, id, action, delegateTo?, outcomeNote? }
 *   action: "claim" (I'm on it) | "delegate" (hand to a teammate's phone) |
 *   "done" (resolved, optional outcome note for MPRCC reporting).
 * Gated server-side: caller must be an ACTIVE roster admin (isRosterAdmin),
 * degrading gracefully to not-admin when the roster table is missing.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { isRosterAdmin } from "~/lib/pushServer";
import {
  MISSING_TABLE_MSG,
  normPhone,
  peerSupportTableReady,
} from "~/lib/peerSupportServer";

async function claimRequest(c: { request: Request }) {
  let body: {
    phone?: unknown;
    id?: unknown;
    action?: unknown;
    delegateTo?: unknown;
    outcomeNote?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with id + action." }, { status: 400 });
  }
  const caller = normPhone(body.phone ?? c.request.headers.get("x-sg-phone"));
  const id = String(body.id ?? "").trim().slice(0, 60);
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!(await isRosterAdmin(caller))) {
    return Response.json(
      { ok: false, error: "This queue is for the MPRCC outreach team." },
      { status: 403 },
    );
  }
  if (!id) return Response.json({ ok: false, error: "Which request? (id missing)" }, { status: 400 });
  if (!(await peerSupportTableReady())) {
    return Response.json({ ok: false, error: MISSING_TABLE_MSG, code: "no_table" }, { status: 503 });
  }
  try {
    if (action === "claim") {
      await sql()`update public.peer_support_requests
        set status = 'claimed', claimed_by_phone = ${caller}, updated_at = now()
        where id = ${id}::uuid and status = 'open'`;
    } else if (action === "delegate") {
      const to = normPhone(body.delegateTo);
      if (to.length < 10) {
        return Response.json(
          { ok: false, error: "A teammate's phone is needed to hand this off." },
          { status: 400 },
        );
      }
      await sql()`update public.peer_support_requests
        set status = 'claimed', claimed_by_phone = ${caller}, delegate_to_phone = ${to}, updated_at = now()
        where id = ${id}::uuid and status in ('open', 'claimed')`;
    } else if (action === "done") {
      const outcome = String(body.outcomeNote ?? "").trim().slice(0, 500);
      await sql()`update public.peer_support_requests
        set status = 'done', outcome_note = ${outcome || null}, updated_at = now()
        where id = ${id}::uuid and status in ('open', 'claimed')`;
    } else {
      return Response.json(
        { ok: false, error: "Unknown action — use claim, delegate, or done." },
        { status: 400 },
      );
    }
    return Response.json({ ok: true, id, action });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/peer-support/claim")({
  server: {
    handlers: {
      POST: claimRequest,
    },
  },
});
