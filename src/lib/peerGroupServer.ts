/**
 * Peer groups + group check-in send — shared server glue (owner-requested
 * 2026-09-15, BUILD A backend).
 *
 * WHY THIS EXISTS: check-ins reached NO peers. Two disconnected peer systems
 * existed — /checkin ran on a demo device UUID while peer management ran on
 * phone identity — so peers added by phone never appeared in the share sheet
 * and a check-in pushed nobody. A group is only meaningful as a VIEW of the
 * phone-based peer graph, so everything here keys on `users.id` resolved from
 * the caller's own phone (exactly like `trusted_peers`).
 *
 * SAFETY / PRIVACY CONTRACT (mirrors the schema, which is the enforcement
 * layer — this module never trusts a client-supplied user id, group id, member
 * list or audience):
 *  - Identity: the caller's phone resolves server-side to `users.id`
 *    (`userIdForPhone` / `bindPhoneToUser`). A client `userId` is never used.
 *  - Groups: readable/writable by their OWNER only. A group id that is not the
 *    caller's yields a calm 404 with no existence leak (same answer for
 *    "not mine" and "does not exist").
 *  - Membership grants NO visibility. The send set is ALWAYS intersected with
 *    the caller's LIVE mutual-accepted peers at send time, so a peer removed a
 *    minute ago is silently dropped (AC-14).
 *  - Peers only ever see fuzzed ~150m coords via `public.peer_check_ins`;
 *    `exact_lat`/`exact_lng` never enter a peer-facing payload (AC-18).
 *  - Push copy carries NO coordinates, NO phone digits, NO group name, NO note,
 *    NO address (AC-15/AC-16) — a lock screen on a shared phone must stay
 *    safe. Counts only in the response.
 *  - No per-recipient notification log is stored (deliberate): delivery counts
 *    are computed transiently at send time.
 *  - No background location anywhere in this module; it only records a point
 *    the caller explicitly tapped.
 */
import { sql } from "~/db";
import { normPhone } from "~/lib/alertIdentity";
import { peerRpc, userIdForPhone } from "~/lib/peerServer";
import { phoneKey, sendFcmMessage, tokensForPhone } from "~/lib/pushServer";
// Backlog 84dd5b25: the check-in push deep-links straight to the fresh fuzzed
// pin on the friends map. Pure link builder — carries only the check-in ROW id
// (a uuid), never a coordinate, name, phone or place.
import { checkInFocusLink } from "~/lib/checkinFocus";

/* ── Audience ─────────────────────────────────────────────────────── */
export type AudienceKind = "me" | "all" | "group" | "peers";
export const AUDIENCE_KINDS: ReadonlyArray<AudienceKind> = ["me", "all", "group", "peers"];
export function isAudienceKind(raw: unknown): raw is AudienceKind {
  return raw === "me" || raw === "all" || raw === "group" || raw === "peers";
}

/** Caps + name rules (spec §4). Enforced HERE in the route — the schema keeps
 * the format floor (length, no 7+ digit runs, no '@') as the last line. */
export const GROUP_LIMITS = { maxGroups: 6, maxMembers: 12, maxNameLength: 24 } as const;

export const GROUP_NAME_EMPTY = "A short name is all it needs — up to 24 characters.";
export const GROUP_NAME_LONG = "24 characters is the most a name can hold — try a shorter one.";
export const GROUP_NAME_PII =
  "Keep it short and simple — names with phone numbers or emails aren't saved.";
export const GROUP_NAME_DUP = "You already have a group called that.";
export const GROUP_NEEDS_ONE = "A group needs at least one trusted peer.";
export const GROUP_STALE_MEMBER = "Someone you picked isn't a peer any more — they were left out.";
export const GROUP_GONE = "That group isn't here — it may have been deleted.";
export const GROUP_CAP_REACHED = "You have all the groups a name can hold — try editing one you already have.";
export const GROUP_MEMBERS_FULL = "That group is full — 12 people is the most one group can hold.";
export const ADD_NUMBER_FIRST = "Add your number first — then you can check in with your peers.";

/** Calm, blame-free group-name validation. Mirrors the DB constraint and adds
 * the address/email heuristics the schema can't express. */
export function validateGroupName(
  raw: unknown,
  ownPhone?: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length === 0) return { ok: false, error: GROUP_NAME_EMPTY };
  if (name.length > GROUP_LIMITS.maxNameLength) return { ok: false, error: GROUP_NAME_LONG };
  // No phone-like runs (7+ digits), no emails, no dot-TLDs.
  if (/[0-9]{7,}/.test(name) || name.includes("@") || /\.(com|net|org|edu|gov|io|co|us)\b/i.test(name)) {
    return { ok: false, error: GROUP_NAME_PII };
  }
  // Obvious street address: "123 Main St", "88 Harbor Rd". Requires a street
  // suffix so ordinary names ("3 amigos", "Northside 2") still save.
  if (
    /\b\d{1,6}\s+[A-Za-z]{2,}\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|hwy|highway|pl|place|ter|terrace|cir|circle)\b/i.test(
      name,
    )
  ) {
    return { ok: false, error: GROUP_NAME_PII };
  }
  // Never the caller's own number, digits or formatted.
  const digits = normPhone(ownPhone ?? "");
  if (digits && (normPhone(name) === digits || name.replace(/[^0-9]/g, "") === digits)) {
    return { ok: false, error: GROUP_NAME_PII };
  }
  return { ok: true, name };
}

/* ── Phone → users.id bind (the friend-tester bug) ──────────────────
 * Nothing used to create the phone-bound public.users row, so
 * userIdForPhone() returned null for a fresh phone and POST /api/peers died
 * with "Add your number first". sg_peer_bind is create-or-bind + idempotent,
 * so it is safe to call on every app open. */
export interface BindResult {
  userId: string;
  name: string;
  created: boolean;
}
export async function bindPhoneToUser(phone: string, name = ""): Promise<BindResult | null> {
  const normalized = normPhone(phone);
  if (normalized.length < 7) return null;
  const v = (await peerRpc("sg_peer_bind", [normalized, String(name ?? "").slice(0, 40)])) as {
    ok?: boolean;
    user_id?: string;
    display_name?: string | null;
    created?: boolean;
  } | null;
  if (!v || v.ok !== true || typeof v.user_id !== "string") return null;
  return {
    userId: v.user_id,
    name: v.display_name ?? "Neighbor",
    created: v.created === true,
  };
}

/** The caller's id, creating/binding the phone row on first contact
 * (create-or-bind, exactly what a fresh phone needs). */
export async function resolveOrBindCaller(phone: string, name = ""): Promise<string | null> {
  const existing = await userIdForPhone(phone);
  if (existing) return existing;
  const bound = await bindPhoneToUser(phone, name);
  return bound?.userId ?? null;
}

/* ── The live peer graph ──────────────────────────────────────────── */
export interface MutualPeer {
  userId: string;
  name: string;
  phone: string;
}
/** Mutual-accepted peers WITH their phones (fan-out needs the phone; nothing
 * here is client-facing — the route strips phones from every response). */
export async function mutualPeersForUser(requesterId: string): Promise<MutualPeer[]> {
  if (!requesterId) return [];
  const rows = (await sql()`
    select u.id as user_id, u.display_name as name, coalesce(u.phone, '') as phone
    from (
      select distinct peer_id as user_id
      from public.trusted_peers
      where requester_id = ${requesterId} and status = 'accepted'
    ) o
    join public.users u on u.id = o.user_id
    where exists (
      select 1 from public.trusted_peers b
      where b.requester_id = o.user_id and b.peer_id = ${requesterId} and b.status = 'accepted'
    )
    order by u.display_name asc
    limit 100`) as unknown as Array<{ user_id: string; name: string; phone: string }>;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, phone: r.phone }));
}

/** Fuzzed peer check-ins (the "friends sharing with you" list). The
 * peer_check_ins view already hides paused/expired points and selects ONLY
 * fuzz_* coords; the mutual-accepted join is repeated here because this query
 * runs on the service role (a table owner bypasses RLS — never assume it). */
export interface FriendCheckIn {
  id: string;
  userId: string;
  peerName: string;
  fuzzLat: number | null;
  fuzzLng: number | null;
  checkedInAt: string;
  note: string | null;
  visibleUntil: string | null;
  sharing: boolean;
  overdue: boolean;
}
const iso = (d: unknown): string | null => {
  if (d === null || d === undefined) return null;
  return typeof d === "string" ? d : new Date(d as string | number | Date).toISOString();
};
export async function friendCheckInsForUser(requesterId: string): Promise<FriendCheckIn[]> {
  if (!requesterId) return [];
  const rows = (await sql()`
    select v.id, v.user_id, v.peer_name, v.fuzz_lat, v.fuzz_lng,
           v.checked_in_at, v.note, v.visible_until, v.sharing
    from public.peer_check_ins v
    where v.user_id <> ${requesterId}
      and exists (
        select 1
        from public.trusted_peers a
        join public.trusted_peers b
          on b.requester_id = a.peer_id and b.peer_id = a.requester_id
        where a.requester_id = v.user_id and a.peer_id = ${requesterId}
          and a.status = 'accepted' and b.status = 'accepted'
      )
    order by v.checked_in_at desc
    limit 50`) as unknown as Array<{
    id: string;
    user_id: string;
    peer_name: string;
    fuzz_lat: number | null;
    fuzz_lng: number | null;
    checked_in_at: string | Date;
    note: string | null;
    visible_until: string | Date | null;
    sharing: boolean;
  }>;
  const now = Date.now();
  return rows.map((r) => {
    const at = iso(r.checked_in_at) ?? new Date().toISOString();
    return {
      id: r.id,
      userId: r.user_id,
      peerName: r.peer_name,
      fuzzLat: r.fuzz_lat,
      fuzzLng: r.fuzz_lng,
      checkedInAt: at,
      note: r.note,
      visibleUntil: iso(r.visible_until),
      sharing: r.sharing === true,
      overdue: now - new Date(at).getTime() > 12 * 3_600_000,
    };
  });
}

/* ── Groups (owner-only, server-enforced) ─────────────────────────── */
export interface GroupMemberView {
  userId: string;
  name: string;
}
export interface GroupView {
  id: string;
  name: string;
  /** Members that are STILL live mutual-accepted peers (the selectable set). */
  memberCount: number;
  members: GroupMemberView[];
  /** Rows left behind by a peer who was removed elsewhere (never selectable). */
  staleCount: number;
  createdAt: string | null;
}
/** The caller's groups with their mutual-accepted members — the single query
 * behind both the group UI and the check-in send (§2.2). */
export async function groupsForOwner(ownerId: string): Promise<GroupView[]> {
  if (!ownerId) return [];
  const groups = (await sql()`
    select g.id, g.name, g.created_at
    from public.peer_groups g
    where g.owner_user_id = ${ownerId}
    order by g.created_at asc
    limit 50`) as unknown as Array<{ id: string; name: string; created_at: string | Date }>;
  if (groups.length === 0) return [];
  const members = (await sql()`
    select m.group_id,
           u.id as user_id,
           u.display_name as name,
           (a.peer_id is not null and b.peer_id is not null) as mutual
    from public.peer_group_members m
    join public.users u on u.id = m.member_user_id
    left join public.trusted_peers a
      on a.requester_id = ${ownerId} and a.peer_id = m.member_user_id and a.status = 'accepted'
    left join public.trusted_peers b
      on b.requester_id = m.member_user_id and b.peer_id = ${ownerId} and b.status = 'accepted'
    order by u.display_name asc`) as unknown as Array<{
    group_id: string;
    user_id: string;
    name: string;
    mutual: boolean;
  }>;
  return groups.map((g) => {
    const mine = members.filter((m) => m.group_id === g.id);
    const live = mine.filter((m) => m.mutual);
    return {
      id: g.id,
      name: g.name,
      memberCount: live.length,
      members: live.map((m) => ({ userId: m.user_id, name: m.name })),
      staleCount: mine.length - live.length,
      createdAt: iso(g.created_at),
    };
  });
}
/** One group, but ONLY when the caller owns it. Returns null for both "not
 * yours" and "does not exist" — the route answers 404 either way, so a group
 * id can never be probed for existence (AC-10). */
export async function ownedGroup(ownerId: string, groupId: string): Promise<GroupView | null> {
  const id = String(groupId ?? "").trim();
  if (!ownerId || !/^[0-9a-f-]{32,40}$/i.test(id)) return null;
  const all = await groupsForOwner(ownerId);
  return all.find((g) => g.id === id) ?? null;
}
export async function ownerGroupCount(ownerId: string): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from public.peer_groups where owner_user_id = ${ownerId}`) as unknown as Array<{
    n: number;
  }>;
  return rows[0]?.n ?? 0;
}
/** Intersect a client-supplied member list with the LIVE mutual-accepted peers.
 * Anything else is dropped (never trusted, never an error the sender sees as a
 * failure). */
export function intersectWithPeers(peers: MutualPeer[], ids: unknown[]): MutualPeer[] {
  const wanted = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0),
  );
  return peers.filter((p) => wanted.has(p.userId));
}

/* ── Push fan-out (spec §5) ───────────────────────────────────────── */
export const PUSH_TITLE = "SafeGround — check-in";
/** Fixed push copy. First name only — no coordinates, no phone digits, no
 * group name, no note, no address (AC-15/AC-16). EN-only for now (i18n is
 * client-only), same as the peer-support + group-notice pushes. */
export function pushBodyFor(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && first.toLowerCase() !== "neighbor"
    ? `${first} checked in — tap to see where.`
    : "A peer checked in — tap to see where.";
}
/** ≤1 push per peer phone per 10 min (spec §9). Deliberately NOT persisted —
 * no per-recipient notification table exists, so this is a best-effort
 * per-process guard keyed on a hashed sender+recipient pair (never a stored
 * phone). Rotating processes may re-allow a push; the check-in itself is
 * unaffected either way. */
const PUSH_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_CHECKINS_PER_DAY = 10;
const recentPushes = new Map<string, number>();
function cooldownKey(senderId: string, recipientPhone: string): string {
  return `${senderId}|${phoneKey(recipientPhone)}`;
}
function withinCooldown(senderId: string, recipientPhone: string, now: number): boolean {
  const key = cooldownKey(senderId, recipientPhone);
  const at = recentPushes.get(key);
  if (at === undefined) return false;
  if (now - at > PUSH_COOLDOWN_MS) {
    recentPushes.delete(key);
    return false;
  }
  return true;
}
export interface FanOutResult {
  /** Recipients (deduped by phone) that actually had a registered device. */
  notified: number;
  /** Tokens the push service accepted. */
  sent: number;
  /** Phones in the audience (post-intersection, pre-token lookup). */
  audience: number;
  /** True when the daily ceiling suppressed the push (check-in still saved). */
  ceiling: boolean;
}
/**
 * Send the group check-in push. Best-effort per token: a failed token never
 * fails the check-in (AC-17). Deduped by phone so a peer reached by two paths
 * gets ONE notification (AC-13). Returns counts only — never phones.
 */
export async function fanOutCheckIn(opts: {
  senderId: string;
  senderName: string | null;
  recipients: MutualPeer[];
  /** The caller's own check-ins in the last 24h (the day ceiling counts them). */
  checkInsLast24h: number;
  /** The row just written — the push link focuses exactly this check-in
   * (backlog 84dd5b25). Absent/odd id → the plain /checkin link (still lands
   * on the page the owner asked for, just without the pin highlight). */
  checkInId?: string | null;
}): Promise<FanOutResult> {
  const { senderId, senderName, recipients } = opts;
  const audience = recipients.length;
  // The tap-through target: the friends map with THIS check-in's fuzzed pin
  // highlighted (backlog 84dd5b25). The id is a row uuid; no coordinates ride
  // along, and the link stays same-origin ("/…") so the service worker's
  // same-origin-only rule keeps holding.
  const link = checkInFocusLink(opts.checkInId);
  if (audience === 0) return { notified: 0, sent: 0, audience: 0, ceiling: false };
  if (opts.checkInsLast24h > MAX_CHECKINS_PER_DAY) {
    return { notified: 0, sent: 0, audience, ceiling: true };
  }
  // Dedupe by phone (last-10 digits): one notification per person, even when a
  // peer sits in two selected paths.
  const byPhone = new Map<string, MutualPeer>();
  for (const r of recipients) {
    const key = phoneKey(r.phone);
    if (!key) continue; // no phone on file → no device we can reach
    if (!byPhone.has(key)) byPhone.set(key, r);
  }
  const now = Date.now();
  let notified = 0;
  let sent = 0;
  for (const [, peer] of byPhone) {
    if (withinCooldown(senderId, peer.phone, now)) continue;
    let tokens: string[] = [];
    try {
      tokens = await tokensForPhone(peer.phone);
    } catch {
      continue; // push_tokens unreachable — the check-in still saved
    }
    if (tokens.length === 0) continue;
    notified += 1;
    recentPushes.set(cooldownKey(senderId, peer.phone), now);
    const body = pushBodyFor(senderName);
    for (const token of tokens.slice(0, 20)) {
      try {
        const r = await sendFcmMessage({ token, title: PUSH_TITLE, body, link });
        if (r.status === "sent") sent += 1;
      } catch {
        /* best-effort per token — never fails the check-in */
      }
    }
  }
  return { notified, sent, audience, ceiling: false };
}
/** The caller's check-ins in the last 24h — the ≤10/day sender ceiling. */
export async function checkInsInLastDay(userId: string): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from public.check_ins
    where user_id = ${userId} and checked_in_at > now() - interval '24 hours'`) as unknown as Array<{
    n: number;
  }>;
  return rows[0]?.n ?? 0;
}
/** Zero-PII analytics bucket for a member count. Nothing but a coarse label. */
export function memberBucket(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  return "6+";
}
