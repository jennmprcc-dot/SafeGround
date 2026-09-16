/**
 * Phone-keyed check-ins + group check-in send (peer groups spec §2.2 — BUILD A).
 *
 * GET  /api/checkin?phone=… (header x-sg-phone) —
 *   { ok, requesterId, requesterName, mine, peers[], friends[], groups[] }
 *   mine    = my latest check-in row (my own exact point — mine only)
 *   peers   = the shared peer list (listPeersForUser — the SAME reader the peer
 *             screen uses, so the share sheet and PEER-1 never disagree)
 *   friends = peers' check-ins via public.peer_check_ins (FUZZED ~150m only,
 *             live mutual-accepted peers only, sharing + unexpired only)
 *   groups  = my groups with their still-mutual member counts (owner-only)
 *   Create-or-bind on first contact: a stored phone with no bound users row
 *   gets one here, so a fresh phone is never a dead end.
 *
 * POST /api/checkin { phone, lat, lng, note, audience: {kind, groupId?, peerIds?} }
 *   kind: "me" | "all" | "group" | "peers"  — one check-in row, then the
 *   fan-out per spec §5. "me" = no push at all.
 *   Returns counts only: { ok, id, …, audienceCount, notified, sent, ceiling }.
 *
 * SAFETY / PRIVACY (non-negotiable):
 *  - Identity is ALWAYS the caller's own phone resolved server-side. A client
 *    userId / groupId ownership / peer list is never trusted.
 *  - The send set is intersected with the caller's LIVE mutual-accepted peers at
 *    send time (a peer removed a minute ago is not notified).
 *  - Exact coords are written and echoed to the OWNER only; peers only ever see
 *    the fuzzed point through the view. Push copy + this response carry no phone
 *    digits, no coordinates, no group name, no note text, no address.
 *  - No background location: this route only stores the single point the caller
 *    explicitly chose to send.
 *  - Not business-hours gated (lead-approved): a 2am check-in is exactly the
 *    case this exists for; the anti-spam ceilings stand in for it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  ADD_NUMBER_FIRST,
  GROUP_GONE,
  bindPhoneToUser,
  checkInsInLastDay,
  fanOutCheckIn,
  friendCheckInsForUser,
  groupsForOwner,
  intersectWithPeers,
  isAudienceKind,
  memberBucket,
  mutualPeersForUser,
  ownedGroup,
  type AudienceKind,
  type MutualPeer,
} from "~/lib/peerGroupServer";
import { listPeersForUser, peerCallerPhone, userIdForPhone } from "~/lib/peerServer";

const iso = (d: unknown): string | null => {
  if (d === null || d === undefined) return null;
  return typeof d === "string" ? d : new Date(d as string | number | Date).toISOString();
};
interface CheckInRowShape {
  id: string;
  checked_in_at: string | Date;
  visible_until: string | Date | null;
  note: string | null;
  share_paused: boolean;
  exact_lat: number | null;
  exact_lng: number | null;
  audience_kind: string | null;
}
/** The owner's own row — the exact point is theirs, and only theirs. */
function mapMine(r: CheckInRowShape) {
  return {
    id: r.id,
    checkedInAt: iso(r.checked_in_at),
    visibleUntil: iso(r.visible_until),
    note: r.note,
    sharePaused: r.share_paused === true,
    exactLat: r.exact_lat,
    exactLng: r.exact_lng,
    audienceKind: r.audience_kind,
  };
}

async function getCheckin(c: { request: Request }): Promise<Response> {
  const url = new URL(c.request.url);
  const phone = peerCallerPhone(c.request, { phone: url.searchParams.get("phone") });
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  // Create-or-bind on first contact (never a dead end for a fresh phone).
  let requesterId = await userIdForPhone(phone);
  if (!requesterId) {
    try {
      const bound = await bindPhoneToUser(phone);
      requesterId = bound?.userId ?? null;
    } catch {
      requesterId = null;
    }
  }
  if (!requesterId) {
    return Response.json({
      ok: true,
      requesterId: null,
      requesterName: null,
      mine: null,
      peers: [],
      friends: [],
      groups: [],
    });
  }
  try {
    const [meRow, peers, friends, groups] = await Promise.all([
      (async () =>
        (await sql()`
          select id, checked_in_at, visible_until, note, share_paused,
                 exact_lat, exact_lng, audience_kind
          from public.check_ins
          where user_id = ${requesterId}
          order by checked_in_at desc
          limit 1`) as unknown as CheckInRowShape[])(),
      listPeersForUser(requesterId),
      friendCheckInsForUser(requesterId),
      groupsForOwner(requesterId),
    ]);
    const nameRows = (await sql()`
      select display_name from public.users where id = ${requesterId} limit 1`) as unknown as Array<{
      display_name: string;
    }>;
    return Response.json({
      ok: true,
      requesterId,
      requesterName: nameRows[0]?.display_name ?? null,
      mine: meRow[0] ? mapMine(meRow[0]) : null,
      peers,
      friends,
      groups,
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load your check-ins — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

/** Accepts 41.2, "41.2", or null/absent. Returns null when unusable. */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function postCheckin(c: { request: Request }): Promise<Response> {
  let body: { phone?: unknown; lat?: unknown; lng?: unknown; note?: unknown; audience?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const requesterId = await userIdForPhone(phone);
  if (!requesterId) {
    // The bind runs on GET /api/checkin + POST /api/peers/bind; never trust a
    // client id to invent one here.
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }

  // ── Location: only what the caller explicitly sent (no background read) ──
  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
    return Response.json(
      { ok: false, error: "That spot didn't come through — nothing was shared. Try again, no rush." },
      { status: 400 },
    );
  }
  const note = String(body.note ?? "").trim().slice(0, 140);

  // ── Audience: server-resolved, never client-trusted ─────────────────────
  const raw = (body.audience ?? {}) as { kind?: unknown; groupId?: unknown; peerIds?: unknown };
  const hasAudience = body.audience !== undefined && body.audience !== null;
  let kind: AudienceKind = "me";
  if (hasAudience) {
    if (!isAudienceKind(raw.kind)) {
      return Response.json({ ok: false, error: "Pick who should see this check-in." }, { status: 400 });
    }
    kind = raw.kind;
  }
  let audienceGroupId: string | null = null;
  let recipients: MutualPeer[] = [];
  try {
    const livePeers = kind === "me" ? [] : await mutualPeersForUser(requesterId);
    if (kind === "all") {
      recipients = livePeers;
    } else if (kind === "group") {
      const groupId = String(raw.groupId ?? "").trim();
      // Owner-only. A group that isn't the caller's answers 404 exactly like a
      // group that doesn't exist — no existence leak, no row written.
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
      { ok: false, error: "Couldn't work out who to share with — nothing was saved. Try again in a moment." },
      { status: 503 },
    );
  }

  // ── One check-in row (the BEFORE INSERT trigger writes visible_until + fuzz) ──
  let row: CheckInRowShape;
  try {
    const rows = (await sql()`
      insert into public.check_ins
        (user_id, exact_lat, exact_lng, note, checked_in_at, audience_kind, audience_group_id)
      values (${requesterId}, ${lat}, ${lng}, ${note === "" ? null : note}, now(),
              ${kind}, ${audienceGroupId})
      returning id, checked_in_at, visible_until, note, share_paused,
                exact_lat, exact_lng, audience_kind`) as unknown as CheckInRowShape[];
    if (!rows[0]) {
      return Response.json({ ok: false, error: "That didn't save — try again in a moment." }, { status: 503 });
    }
    row = rows[0];
  } catch {
    return Response.json(
      { ok: false, error: "That didn't save — nothing was shared. Try again in a moment." },
      { status: 503 },
    );
  }

  // ── Fan-out (skipped entirely for "Just me") ──────────────────────────────
  let notified = 0;
  let sent = 0;
  let ceiling = false;
  if (kind !== "me") {
    try {
      const me = (await sql()`
        select display_name from public.users where id = ${requesterId} limit 1`) as unknown as Array<{
        display_name: string;
      }>;
      // Counts the row just written, so >10 means this is an 11th+ check-in today.
      const today = await checkInsInLastDay(requesterId);
      const r = await fanOutCheckIn({
        senderId: requesterId,
        senderName: me[0]?.display_name ?? null,
        recipients,
        checkInsLast24h: today,
        // Tapping the push lands on /checkin?focus=checkin:<id> — the friends
        // map scrolled into view with THIS fuzzed pin highlighted (84dd5b25).
        checkInId: row.id,
      });
      notified = r.notified;
      sent = r.sent;
      ceiling = r.ceiling;
    } catch {
      // Best-effort: the check-in is already saved and honest counts stay 0.
      notified = 0;
      sent = 0;
    }
    // Zero-PII counter: audience kind + a coarse member bucket. No names, no
    // ids, no coordinates, no group name. Fired only once the row really landed.
    void insertAnalyticsEvent("checkin_group_send", {
      category: kind,
      status: memberBucket(recipients.length),
      installId: null,
    });
  }

  return Response.json({
    ok: true,
    id: row.id,
    checkedInAt: iso(row.checked_in_at),
    visibleUntil: iso(row.visible_until),
    note: row.note,
    sharePaused: row.share_paused === true,
    exactLat: row.exact_lat,
    exactLng: row.exact_lng,
    audienceKind: kind,
    audienceCount: recipients.length,
    notified,
    sent,
    ceiling,
  });
}

export const Route = createFileRoute("/api/checkin/")({
  server: {
    handlers: {
      GET: getCheckin,
      POST: postCheckin,
    },
  },
});
