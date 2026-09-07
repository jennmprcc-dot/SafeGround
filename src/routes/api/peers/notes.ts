/**
 * Kind notes API (spec §1.4 — NOTE-1).
 *
 * POST /api/peers/notes { phone, userId, note } — save a kind note to a
 *   mutual trusted peer (sg_note_save): writes peer_notes with delivered_at
 *   NULL — "saved, not yet delivered" until the messaging wave flips it.
 *   ≤140 chars, ≤20/day per sender (server-enforced), plain text, 1:1 only —
 *   never staff, never public. Returns { ok, id, createdAt }.
 * GET  /api/peers/notes?phone=… — the sender's saved notes, newest first
 *   (sg_notes_mine shape): { id, note, recipientName, createdAt, status:
 *   'saved' | 'delivered' }. The UI NEVER shows "Sent"/a checkmark — only the
 *   honest saved-not-delivered status.
 *
 * Identity: caller phone from ?phone=/x-sg-phone/body, digits-only; caller
 * user id resolved server-side. RPC re-verifies (SECURITY DEFINER).
 */
import { createFileRoute } from "@tanstack/react-router";
import { peerCallerPhone, peerErrOf, peerRpc, userIdForPhone } from "~/lib/peerServer";

async function saveNote(c: { request: Request }) {
  let body: { phone?: unknown; userId?: unknown; note?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  const recipientId = String(body.userId ?? "").slice(0, 64);
  const note = String(body.note ?? "").trim().slice(0, 140);
  if (phone.length < 7 || !recipientId) {
    return Response.json({ ok: false, error: "A phone number and the peer are needed." }, { status: 400 });
  }
  if (note.length === 0) {
    return Response.json({ ok: false, error: "Write a line or two first — even a few kind words matter." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: "Add your number first — then you can save a note." }, { status: 400 });
  }
  try {
    const v = (await peerRpc("sg_note_save", [me, recipientId, note])) as {
      ok?: boolean;
      id?: string;
      created_at?: string;
    };
    if (!v || v.ok !== true) {
      return Response.json({ ok: false, error: "That didn't save — try again in a moment." }, { status: 503 });
    }
    return Response.json({
      ok: true,
      id: v.id ?? null,
      createdAt: typeof v.created_at === "string" ? v.created_at : null,
      status: "saved",
    });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 400 });
  }
}

const ISO = (d: unknown): string | null =>
  d == null ? null : typeof d === "string" ? d : new Date(d as Date).toISOString();

async function listNotes(c: { request: Request }) {
  const url = new URL(c.request.url);
  const phone = peerCallerPhone(c.request, { phone: url.searchParams.get("phone") });
  if (phone.length < 7) {
    return Response.json({ ok: false, error: "A phone number is needed to see your notes." }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: true, notes: [] });
  }
  try {
    const v = (await peerRpc("sg_notes_mine", [me])) as { ok?: boolean; notes?: unknown[] };
    const notes = Array.isArray(v?.notes) ? v.notes : [];
    return Response.json({
      ok: true,
      notes: (notes as Array<Record<string, unknown>>).map((n) => ({
        id: String(n.id ?? ""),
        note: String(n.note ?? ""),
        recipientName: String(n.recipient_name ?? "a peer"),
        createdAt: ISO(n.created_at),
        status: n.status === "delivered" ? ("delivered" as const) : ("saved" as const),
      })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: peerErrOf(e) }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/peers/notes")({
  server: {
    handlers: {
      POST: saveNote,
      GET: listNotes,
    },
  },
});