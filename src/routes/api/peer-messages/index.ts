/**
 * Peer-to-peer texting API (owner goal 2026-09-16 — spec Part A §A9).
 *
 * GET  /api/peer-messages?phone=… (or x-sg-phone header) —
 *   { ok, requesterId, senderName, senderSmsConsent, threads[] }
 *   threads = the SENDER's own threads, newest first, with replies inline
 *   (reply author first name + body only — never other phones, never coords
 *   beyond the sender's own). senderSmsConsent drives the first-send consent
 *   card on /peer-text (returning users are never re-gated).
 *   Create-or-bind on first contact (a fresh phone is never a dead end).
 *
 * POST /api/peer-messages
 *   { phone, intent: "need"|"unsafe"|"ok", note?, audience:{kind,groupId?,peerIds?},
 *     location:{kind:"none"|"fuzzed"|"exact", lat?, lng?} }
 *   Writes ONE peer_messages thread, then fans out per spec:
 *     SMS (opt-in + STOP + business-hours gated — NEVER emergency:true),
 *     push (app users), in-app (the saved thread). "Just me" = private note,
 *     no fan-out, no location to anyone.
 *   Returns COUNTS ONLY: { ok, threadId, audienceCount, smsSent, pushSent,
 *   inAppOnly, ceiling } — no recipient PII.
 *
 * SAFETY / PRIVACY (non-negotiable floors):
 *  - Identity is ALWAYS the caller's own phone resolved server-side; a client
 *    userId / groupId / peer list is never trusted.
 *  - The send set is intersected with the caller's LIVE mutual-accepted peers
 *    at send time.
 *  - Location kind is explicit server-side (default none, never pre-selected);
 *    raw lat/lng NEVER appear in SMS (fuzzed → words + map link, exact → link
 *    only, both 24h-expiring tokens). Exact coords are written for the sender
 *    only; peers only ever see the fuzz.
 *  - Peer-to-peer SMS is never emergency:true. Never auto-contacts 911/agencies.
 *  - Cooldown/ceiling: ≤1 SMS+push per peer phone per 10 min; ≤10 sends/day.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  ADD_NUMBER_FIRST,
  GROUP_GONE,
  intersectWithPeers,
  isAudienceKind,
  mutualPeersForUser,
  ownedGroup,
  type AudienceKind,
  type MutualPeer,
} from "~/lib/peerGroupServer";
import { userIdForPhone } from "~/lib/peerServer";
import {
  audienceBucket,
  isPeerIntent,
  isPeerLocKind,
  newMapToken,
  peerMsgCallerPhone,
  peerTextsInLastDay,
  fanOutPeerMessage,
  peerMessageThreadsFor,
  resolveOrBindCaller,
  senderHasSmsConsent,
} from "~/lib/peerMessageServer";

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function listThreads(c: { request: Request }): Promise<Response> {
  const url = new URL(c.request.url);
  const phone = peerMsgCallerPhone(c.request, { phone: url.searchParams.get("phone") });
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  let requesterId = await userIdForPhone(phone);
  if (!requesterId) {
    try {
      const bound = await resolveOrBindCaller(phone);
      requesterId = bound ?? null;
    } catch {
      requesterId = null;
    }
  }
  if (!requesterId) {
    return Response.json({ ok: true, requesterId: null, senderName: null, senderSmsConsent: false, threads: [] });
  }
  let consent = false;
  try {
    consent = await senderHasSmsConsent(phone);
  } catch {
    consent = false;
  }
  let senderName: string | null = null;
  let threads: Awaited<ReturnType<typeof peerMessageThreadsFor>> = [];
  try {
    const nameRows = (await sql()`
      select display_name from public.users where id = ${requesterId} limit 1`) as unknown as Array<{
      display_name: string;
    }>;
    senderName = nameRows[0]?.display_name ?? null;
    threads = await peerMessageThreadsFor(requesterId);
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load your messages — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, requesterId, senderName, senderSmsConsent: consent, threads });
}

async function sendPeerMessage(c: { request: Request }): Promise<Response> {
  let body: {
    phone?: unknown;
    intent?: unknown;
    note?: unknown;
    audience?: unknown;
    location?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerMsgCallerPhone(c.request, body);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const requesterId = await resolveOrBindCaller(phone);
  if (!requesterId) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }

  // ── Intent (required) + note (≤140) ────────────────────────────────
  if (!isPeerIntent(body.intent)) {
    return Response.json({ ok: false, error: "Pick what's happening first — no rush." }, { status: 400 });
  }
  const intent = body.intent;
  const note = String(body.note ?? "").trim().slice(0, 140);

  // ── Location: explicit kind, NEVER pre-selected / defaulted server-side.
  //    kind "none" (the only server default) is exactly "no location"; fuzzed
  //    and exact BOTH require a real point (the fuzz is computed at write).
  const loc = (body.location ?? {}) as { kind?: unknown; lat?: unknown; lng?: unknown };
  const hasLoc = body.location !== undefined && body.location !== null;
  let locKind: "none" | "fuzzed" | "exact" = "none";
  if (hasLoc) {
    if (!isPeerLocKind(loc.kind)) {
      return Response.json({ ok: false, error: "Choose how much location to share — nothing is sent until you pick." }, { status: 400 });
    }
    locKind = loc.kind;
  }
  let lat: number | null = null;
  let lng: number | null = null;
  if (locKind === "fuzzed" || locKind === "exact") {
    lat = numOrNull(loc.lat);
    lng = numOrNull(loc.lng);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return Response.json(
        { ok: false, error: "Couldn't read your location — pick No location to send with words only, or try again when you can." },
        { status: 400 },
      );
    }
  }

  // ── Audience: server-resolved, intersected with LIVE mutual peers ───
  const raw = (body.audience ?? {}) as { kind?: unknown; groupId?: unknown; peerIds?: unknown };
  const hasAudience = body.audience !== undefined && body.audience !== null;
  let kind: AudienceKind = "me";
  if (hasAudience) {
    if (!isAudienceKind(raw.kind)) {
      return Response.json({ ok: false, error: "Pick who should get this message." }, { status: 400 });
    }
    kind = raw.kind;
  }
  // "Just me" is a private self-note — no location is sent to anyone.
  if (kind === "me") locKind = "none";
  let audienceGroupId: string | null = null;
  let recipients: MutualPeer[] = [];
  try {
    const livePeers = kind === "me" ? [] : await mutualPeersForUser(requesterId);
    if (kind === "all") {
      recipients = livePeers;
    } else if (kind === "group") {
      const groupId = String(raw.groupId ?? "").trim();
      const group = await ownedGroup(requesterId, groupId);
      if (!group) return Response.json({ ok: false, error: GROUP_GONE }, { status: 404 });
      audienceGroupId = group.id;
      const memberIds = new Set(group.members.map((m) => m.userId));
      recipients = livePeers.filter((p) => memberIds.has(p.userId));
    } else if (kind === "peers") {
      recipients = intersectWithPeers(livePeers, Array.isArray(raw.peerIds) ? (raw.peerIds as unknown[]) : []);
    }
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't work out who to share with — nothing was sent. Try again in a moment." },
      { status: 503 },
    );
  }

  // ── One thread row (trigger writes fuzz + 24h expiry; token here) ───
  const mapToken = locKind === "none" ? null : newMapToken();
  let threadId: string;
  try {
    const rows = (await sql()`
      insert into public.peer_messages
        (sender_id, intent, note, audience_kind, audience_group_id,
         loc_kind, loc_exact_lat, loc_exact_lng, map_token, sent_at)
      values (${requesterId}, ${intent}, ${note === "" ? null : note}, ${kind},
              ${audienceGroupId}, ${locKind}, ${lat}, ${lng}, ${mapToken}, now())
      returning id`) as unknown as Array<{ id: string }>;
    if (!rows[0]) return Response.json({ ok: false, error: "That didn't save — try again in a moment." }, { status: 503 });
    threadId = rows[0].id;
  } catch {
    return Response.json(
      { ok: false, error: "That didn't save — nothing was sent. Try again in a moment." },
      { status: 503 },
    );
  }

  // ── Fan-out (skipped for "Just me") ─────────────────────────────────
  let smsSent = 0;
  let pushSent = 0;
  let inAppOnly = 0;
  let ceiling = false;
  if (kind !== "me") {
    let senderName: string | null = null;
    try {
      const me = (await sql()`
        select display_name from public.users where id = ${requesterId} limit 1`) as unknown as Array<{
        display_name: string;
      }>;
      senderName = me[0]?.display_name ?? null;
      const today = await peerTextsInLastDay(requesterId);
      const r = await fanOutPeerMessage({
        threadId,
        senderId: requesterId,
        senderName,
        recipients,
        intent,
        note: note === "" ? null : note,
        locKind,
        mapToken,
        sendsLast24h: today,
      });
      smsSent = r.smsSent;
      pushSent = r.pushSent;
      inAppOnly = r.inAppOnly;
      ceiling = r.ceiling;
    } catch {
      // Best-effort: the message is saved; honest counts stay 0.
    }
    // Zero-PII counter: intent + audience-kind bucket. No names, no ids, no
    // coordinates, no note text, no group name.
    void insertAnalyticsEvent("peer_text_send", {
      category: intent,
      status: audienceBucket(recipients.length),
      installId: null,
    });
  }

  return Response.json({
    ok: true,
    threadId,
    intent,
    note: note === "" ? null : note,
    audienceKind: kind,
    locKind,
    audienceCount: recipients.length,
    smsSent,
    pushSent,
    inAppOnly,
    ceiling,
  });
}

export const Route = createFileRoute("/api/peer-messages/")({
  server: {
    handlers: {
      GET: listThreads,
      POST: sendPeerMessage,
    },
  },
});