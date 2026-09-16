/**
 * Peer-to-peer texting — shared server glue (owner goal 2026-09-16:
 * "peers text peers — send messages to peer groups AND location").
 *
 * Mirrors peerGroupServer.fanOutCheckIn: one peer_messages thread row per
 * send, then a per-recipient fan-out with SMS as the primary channel, push
 * and in-app as companions. The composer + inbox live on /peer-text;
 * POST/GET handlers in src/routes/api/peer-messages.
 *
 * SAFETY / PRIVACY CONTRACT (the schema is the enforcement layer; this module
 * never trusts a client-supplied user id, group id, member list, audience or
 * location choice):
 *  - Identity: the caller's phone resolves server-side to users.id
 *    (userIdForPhone / resolveOrBindCaller). A client userId is never used.
 *  - Audience: the send set is ALWAYS intersected with the caller's LIVE
 *    mutual-accepted peers at send time (a peer removed a minute ago is
 *    dropped, never an error).
 *  - SMS is NEVER sent with emergency:true (peer-to-peer is not staff
 *    dispatch): every recipient passes gateSms() (stored sms_consent + not
 *    unsubscribed) AND the business-hours floor (Mon–Fri 8a–6p PT) unless the
 *    RECIPIENT consents to after-hours — exactly the existing centre floor.
 *    Out-of-hours peers degrade to push/in-app only; the message still lands.
 *  - Location: per-send, kind explicitly required server-side, default none,
 *    never pre-selected. Raw lat/lng never appear in SMS: fuzzed → words +
 *    map link, exact → link only. Map links carry a unique 24h-expiring
 *    token; exact coords are stored for the SENDER only (peer-facing payloads
 *    carry the fuzz, rounded at write by the trigger).
 *  - Push copy carries NO coordinates, NO phone digits, NO note text, NO
 *    group name (lock-screen safe) — the map token rides the deep link only.
 *  - Replies (inbound SMS) route to the ORIGINAL SENDER ONLY — never
 *    re-broadcast; "Reply STOP" is honored upstream before reply routing.
 *  - Cooldown/ceiling: ≤1 SMS+push per peer phone per 10 min per sender, and
 *    ≤10 sends/day per sender (same style as the check-in constants).
 *    Deliberately NOT persisted (same best-effort per-process guard as
 *    check-ins); the daily ceiling IS persisted via a DB count.
 *  - No background location anywhere; this module only records the point the
 *    caller explicitly chose to send.
 */
import { randomBytes } from "node:crypto";
import { sql } from "~/db";
import { normPhone } from "~/lib/alertIdentity";
import { peerRpc, userIdForPhone } from "~/lib/peerServer";
import {
  bindPhoneToUser,
  type MutualPeer,
} from "~/lib/peerGroupServer";
import { phoneKey, sendFcmMessage, tokensForPhone } from "~/lib/pushServer";
import { gateSms, sendSms } from "~/lib/smsServer";

/* ── Types ───────────────────────────────────────────────────────── */
export type PeerIntent = "need" | "unsafe" | "ok";
export function isPeerIntent(raw: unknown): raw is PeerIntent {
  return raw === "need" || raw === "unsafe" || raw === "ok";
}
export type PeerLocKind = "none" | "fuzzed" | "exact";
export function isPeerLocKind(raw: unknown): raw is PeerLocKind {
  return raw === "none" || raw === "fuzzed" || raw === "exact";
}

/** Absolute base for SMS/map links. The owner may override via Secrets
 * (SG_BASE_URL); the fallback is the app's live host (same constant the
 * social-card metas in __root.tsx use — never a raw localhost value). */
function sgBaseUrl(): string {
  const raw = (process.env.SG_BASE_URL ?? "https://3ece348267758ca697d7eddcee09689c.ctonew.app").trim();
  return raw.replace(/\/+$/, "");
}
export function peerTextMapUrl(token: string): string {
  return `${sgBaseUrl()}/peer-text/map?token=${encodeURIComponent(token)}`;
}

/* ── Caps + ceilings (mirror the check-in constants' style) ─────── */
export const MAX_PEER_TEXTS_PER_DAY = 10;
const PAIR_COOLDOWN_MS = 10 * 60 * 1000; // ≤1 sms+push per peer per 10 min
const recentSends = new Map<string, number>();
function pairKey(senderId: string, recipientPhone: string): string {
  return `${senderId}|${phoneKey(recipientPhone)}`;
}
function withinPairCooldown(senderId: string, recipientPhone: string, now: number): boolean {
  const key = pairKey(senderId, recipientPhone);
  const at = recentSends.get(key);
  if (at === undefined) return false;
  if (now - at > PAIR_COOLDOWN_MS) {
    recentSends.delete(key);
    return false;
  }
  return true;
}

/* ── The caller's own id (create-or-bind, never a client id) ────── */
export async function resolveOrBindCaller(phone: string, name = ""): Promise<string | null> {
  const existing = await userIdForPhone(phone);
  if (existing) return existing;
  const bound = await bindPhoneToUser(phone, name);
  return bound?.userId ?? null;
}

/* ── The sender's sends in the last 24h (the ≤10/day ceiling) ───── */
export async function peerTextsInLastDay(senderId: string): Promise<number> {
  const rows = (await sql()`
    select count(*)::int as n from public.peer_messages
    where sender_id = ${senderId} and sent_at > now() - interval '24 hours'`) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/* ── SMS body ────────────────────────────────────────────────────── */
/** Calm intent line for SMS (EN-only, same as the existing push/SMS copy —
 * SMS bodies are composed server-side where the client i18n dict doesn't run). */
export function intentSmsLine(intent: PeerIntent): string {
  switch (intent) {
    case "need":
      return "I need support";
    case "unsafe":
      return "Unsafe location";
    case "ok":
      return "I'm OK";
  }
}
/** The body a peer receives by SMS. NEVER raw lat/lng: fuzzed → words + map
 * link; exact → the link only. The legal "Reply STOP" line is always present
 * (the recipient's opt-in is the privacy story — spec A1#7). */
export function peerSmsBody(opts: {
  senderName: string;
  intent: PeerIntent;
  note: string | null;
  locKind: PeerLocKind;
  mapToken: string | null;
}): string {
  const first = String(opts.senderName ?? "").trim().split(/\s+/)[0] ?? "";
  const who = first && first.toLowerCase() !== "neighbor" ? first : "A peer";
  let loc = "";
  if (opts.locKind === "fuzzed" && opts.mapToken) {
    loc = ` They're around an approximate area (~150m) — map: ${peerTextMapUrl(opts.mapToken)}.`;
  } else if (opts.locKind === "exact" && opts.mapToken) {
    loc = ` Exact spot (clears in 24h) — map: ${peerTextMapUrl(opts.mapToken)}.`;
  }
  const note = String(opts.note ?? "").trim();
  const body = `SafeGround — ${who}: ${intentSmsLine(opts.intent)}${note ? ` ${note}` : ""}${loc} Reply to reach ${who}. (Reply STOP to stop.)`;
  return body;
}
/** Reply echo to the ORIGINAL SENDER only — direct one-to-one, never a
 * group broadcast (spec A9.4). */
export function replyEchoBody(replierName: string, reply: string): string {
  const first = String(replierName ?? "").trim().split(/\s+/)[0] ?? "A peer";
  return `${first}: ${String(reply ?? "").trim().slice(0, 160)} (Reply STOP to stop.)`;
}

/* ── Map token (24h-expiring, unique) ────────────────────────────── */
export function newMapToken(): string {
  return randomBytes(12).toString("hex"); // 24 chars, url-safe
}

/* ── Fan-out ─────────────────────────────────────────────────────── */
export interface PeerMessageFanOut {
  /** Recipients in the audience (post live-mutual intersection, deduped). */
  audience: number;
  /** Recipients whose SMS Twilio accepted. */
  smsSent: number;
  /** Recipients whose push FCM accepted (≥1 token delivered). */
  pushSent: number;
  /** Recipients reached by neither SMS nor push (in-app / future reader). */
  inAppOnly: number;
  /** True when the daily ceiling suppressed the fan-out (thread still saved). */
  ceiling: boolean;
}
/**
 * Per-recipient fan-out. Best-effort everywhere: a failed token, an SMS gate
 * miss, or an unreachable DB never fails the saved message (AC-style fluid).
 * Deduped by phone so a peer in two selected paths gets ONE contact attempt.
 * Inserts the minimal recipient log rows (need them for reply routing +
 * honest counts), bounded by the 90-day purge trigger.
 */
export async function fanOutPeerMessage(opts: {
  threadId: string;
  senderId: string;
  senderName: string | null;
  recipients: MutualPeer[];
  intent: PeerIntent;
  note: string | null;
  locKind: PeerLocKind;
  mapToken: string | null;
  sendsLast24h: number;
}): Promise<PeerMessageFanOut> {
  const { threadId, senderId, senderName, recipients, intent, note, locKind, mapToken } = opts;
  const byPhone = new Map<string, MutualPeer>();
  for (const r of recipients) {
    const key = phoneKey(r.phone);
    if (key && !byPhone.has(key)) byPhone.set(key, r);
  }
  const audience = byPhone.size;
  if (audience === 0) return { audience: 0, smsSent: 0, pushSent: 0, inAppOnly: 0, ceiling: false };
  if (opts.sendsLast24h > MAX_PEER_TEXTS_PER_DAY) {
    return { audience, smsSent: 0, pushSent: 0, inAppOnly: 0, ceiling: true };
  }
  const now = Date.now();
  const body = peerSmsBody({ senderName: senderName ?? "Neighbor", intent, note, locKind, mapToken });
  let smsSent = 0;
  let pushSent = 0;
  let inAppOnly = 0;
  for (const [, peer] of byPhone) {
    let gotSms = false;
    let gotPush = false;
    // Cooldown: ≤1 SMS+push per peer phone per 10 min per sender.
    if (!withinPairCooldown(senderId, peer.phone, now)) {
      // SMS first (the primary channel). NEVER emergency:true — the centre
      // floor: consent + STOP + business-hours unless recipient opts in.
      const gate = await gateSms(peer.phone);
      if (gate.send) {
        try {
          const r = await sendSms(peer.phone, body);
          if (r.ok) {
            gotSms = true;
            smsSent += 1;
            recentSends.set(pairKey(senderId, peer.phone), now);
          }
        } catch {
          /* sendSms never throws, but best-effort never fails the message */
        }
      }
      // Push companion for app users (any device the peer registered).
      if (!gotSms) {
        try {
          const tokens = await tokensForPhone(peer.phone);
          if (tokens.length > 0) {
            recentSends.set(pairKey(senderId, peer.phone), now);
            for (const token of tokens.slice(0, 20)) {
              try {
                const r = await sendFcmMessage({
                  token,
                  title: "SafeGround — peer message",
                  body: `${firstOf(senderName)} sent you a message — tap to see it.`,
                  link: locKind !== "none" && mapToken ? `/peer-text/map?token=${mapToken}` : "/peer-text",
                });
                if (r.status === "sent") gotPush = true;
              } catch {
                /* best-effort per token */
              }
            }
            if (gotPush) pushSent += 1;
          }
        } catch {
          /* push_tokens unreachable — the message is still saved */
        }
      }
    }
    // In-app-only: reached by neither SMS nor push (they'll read it in the
    // app / via the map link when they open it).
    if (!gotSms && !gotPush) inAppOnly += 1;
    // Delivery log rows — the reply-routing backstop + honest counts. Attempt
    // insert best-effort; a failure must never fail the message.
    try {
      await sql()`
        insert into public.peer_message_recipients (thread_id, recipient_id, phone, channel)
        values (${threadId}, ${peer.userId}, ${peer.phone},
                ${gotSms ? "sms" : gotPush ? "push" : "inapp"})`;
    } catch {
      /* best-effort log — the message already landed */
    }
  }
  return { audience, smsSent, pushSent, inAppOnly, ceiling: false };
}

function firstOf(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && first.toLowerCase() !== "neighbor" ? first : "A peer";
}

/* ── Inbox (sender-only) ─────────────────────────────────────────── */
export interface PeerReplyView {
  authorName: string;
  body: string;
  createdAt: string;
}
export interface PeerThreadView {
  id: string;
  intent: PeerIntent;
  note: string | null;
  audienceKind: string;
  locKind: PeerLocKind;
  /** Sender's own exact point (theirs and only theirs — never peer-facing). */
  exactLat: number | null;
  exactLng: number | null;
  fuzzLat: number | null;
  fuzzLng: number | null;
  sentAt: string;
  replyCount: number;
  replies: PeerReplyView[];
}
/**
 * The SENDER's own threads, newest first, benign fields only: no recipients'
 * phones (reply author is only a first name), no coords beyond the sender's
 * own. Threads carry their replies inline (direct one-to-one echoes).
 */
export async function peerMessageThreadsFor(senderId: string): Promise<PeerThreadView[]> {
  if (!senderId) return [];
  const threads = (await sql()`
    select id, intent, note, audience_kind, loc_kind,
           loc_exact_lat, loc_exact_lng, loc_fuzz_lat, loc_fuzz_lng, sent_at
    from public.peer_messages
    where sender_id = ${senderId}
    order by sent_at desc
    limit 30`) as unknown as Array<{
    id: string;
    intent: string;
    note: string | null;
    audience_kind: string;
    loc_kind: string;
    loc_exact_lat: number | null;
    loc_exact_lng: number | null;
    loc_fuzz_lat: number | null;
    loc_fuzz_lng: number | null;
    sent_at: string | Date;
  }>;
  if (threads.length === 0) return [];
  const ids = threads.map((t) => t.id);
  const replies = (await sql()`
    select r.thread_id, r.body, r.created_at, u.display_name as author_name
    from public.peer_message_replies r
    join public.users u on u.id = r.author_id
    where r.thread_id = any(${ids})
    order by r.created_at asc`) as unknown as Array<{
    thread_id: string;
    body: string;
    created_at: string | Date;
    author_name: string | null;
  }>;
  const byThread = new Map<string, PeerReplyView[]>();
  for (const r of replies) {
    const list = byThread.get(r.thread_id) ?? [];
    list.push({
      authorName: String(r.author_name ?? "A peer").trim().split(/\s+/)[0] ?? "A peer",
      body: r.body,
      createdAt: new Date(r.created_at).toISOString(),
    });
    byThread.set(r.thread_id, list);
  }
  return threads.map((t) => ({
    id: t.id,
    intent: t.intent as PeerIntent,
    note: t.note,
    audienceKind: t.audience_kind,
    locKind: t.loc_kind as PeerLocKind,
    exactLat: t.loc_exact_lat,
    exactLng: t.loc_exact_lng,
    fuzzLat: t.loc_fuzz_lat,
    fuzzLng: t.loc_fuzz_lng,
    sentAt: new Date(t.sent_at).toISOString(),
    replyCount: byThread.get(t.id)?.length ?? 0,
    replies: byThread.get(t.id) ?? [],
  }));
}

/* ── 24h-expiring map link ───────────────────────────────────────── */
export interface MapTokenView {
  ok: boolean;
  expired: boolean;
  intent?: PeerIntent;
  note?: string | null;
  senderName?: string;
  locKind?: PeerLocKind;
  /** Peer-facing: ALWAYS the fuzz. Only the sender's own phone (`callerIsSender`)
   * receives the exact point. */
  fuzzLat?: number | null;
  fuzzLng?: number | null;
  exactLat?: number | null;
  exactLng?: number | null;
  callerIsSender?: boolean;
}
export async function mapTokenView(token: string, callerPhone: string): Promise<MapTokenView> {
  const clean = String(token ?? "").trim().slice(0, 80);
  if (!/^[0-9a-f]{8,80}$/i.test(clean)) return { ok: false, expired: false };
  const rows = (await sql()`
    select m.id, m.intent, m.note, m.loc_kind, m.loc_exact_lat, m.loc_exact_lng,
           m.loc_fuzz_lat, m.loc_fuzz_lng, m.loc_expires_at, m.sender_id,
           u.display_name as sender_name
    from public.peer_messages m
    join public.users u on u.id = m.sender_id
    where m.map_token = ${clean}
    limit 1`) as unknown as Array<{
    id: string;
    intent: string;
    note: string | null;
    loc_kind: string;
    loc_exact_lat: number | null;
    loc_exact_lng: number | null;
    loc_fuzz_lat: number | null;
    loc_fuzz_lng: number | null;
    loc_expires_at: string | Date | null;
    sender_id: string;
    sender_name: string | null;
  }>;
  const row = rows[0];
  if (!row) return { ok: false, expired: false };
  const expired =
    !row.loc_expires_at || new Date(row.loc_expires_at).getTime() < Date.now();
  const callerKey = phoneKey(callerPhone);
  let callerIsSender = false;
  if (callerKey) {
    // Last-10-digits match (4158797940 == 14158797940), like push_tokens.
    const row2 = (await sql()`
      select 1 from public.users
      where id = ${row.sender_id}
        and substring(phone from length(phone) - 9) = ${callerKey}
      limit 1`) as unknown as Array<Record<string, unknown>>;
    callerIsSender = row2.length > 0;
  }
  return {
    ok: true,
    expired,
    intent: row.intent as PeerIntent,
    note: row.note,
    senderName: String(row.sender_name ?? "A peer").trim().split(/\s+/)[0] ?? "A peer",
    locKind: row.loc_kind as PeerLocKind,
    fuzzLat: row.loc_fuzz_lat,
    fuzzLng: row.loc_fuzz_lng,
    // Exact point goes to the SENDER only — peers never receive it.
    exactLat: callerIsSender ? row.loc_exact_lat : null,
    exactLng: callerIsSender ? row.loc_exact_lng : null,
    callerIsSender,
  };
}

/* ── Reply routing (inbound SMS → sender only) ───────────────────── */
export interface RouteReplyResult {
  routed: boolean;
  echoSms: boolean;
}
/**
 * An inbound SMS from a peer's phone finds the MOST RECENT
 * peer_message_recipients row for that phone (≤7 days), appends a
 * peer_message_replies row to that thread, and notifies the ORIGINAL SENDER
 * ONLY: a push (lock-screen safe, no reply text) + an SMS echo gated by the
 * sender's own consent + business hours. Never re-broadcasts. Never
 * auto-contacts agencies. Callers handle STOP/HELP BEFORE calling this.
 */
export async function routePeerReply(fromDigits: string, replyBody: string): Promise<RouteReplyResult> {
  const key = phoneKey(fromDigits);
  const text = String(replyBody ?? "").trim().slice(0, 160);
  if (!key || !text) return { routed: false, echoSms: false };
  try {
    const found = (await sql()`
      select r.thread_id, r.recipient_id, m.sender_id, m.map_token, m.loc_kind
      from public.peer_message_recipients r
      join public.peer_messages m on m.id = r.thread_id
      where substring(r.phone from length(r.phone) - 9) = ${key}
        and r.sent_at > now() - interval '7 days'
      order by r.sent_at desc
      limit 1`) as unknown as Array<{
      thread_id: string;
      recipient_id: string;
      sender_id: string;
    }>;
    if (!found[0]) return { routed: false, echoSms: false };
    const { thread_id, recipient_id, sender_id } = found[0];
    await sql()`
      insert into public.peer_message_replies (thread_id, author_id, body)
      values (${thread_id}, ${recipient_id}, ${text})`;
    // Notify the sender: name for the echo + their phone for push/SMS.
    const sender = (await sql()`
      select u.phone, u.display_name
      from public.users u where u.id = ${sender_id} limit 1`) as unknown as Array<{
      phone: string;
      display_name: string | null;
    }>;
    const s = sender[0];
    if (!s?.phone) return { routed: true, echoSms: false };
    const replier = (await sql()`
      select display_name from public.users where id = ${recipient_id} limit 1`) as unknown as Array<{
      display_name: string | null;
    }>;
    const replierName = replier[0]?.display_name ?? "A peer";
    // Push to the sender (lock-screen safe: no coords, no digits, no text).
    try {
      const tokens = await tokensForPhone(s.phone);
      for (const token of tokens.slice(0, 20)) {
        try {
          await sendFcmMessage({
            token,
            title: "SafeGround — reply",
            body: `${firstOf(replierName)} replied to your message — tap to see it.`,
            link: "/peer-text",
          });
        } catch {
          /* best-effort per token */
        }
      }
    } catch {
      /* push_tokens unreachable — the SMS echo (below) still stands */
    }
    // SMS echo to the sender: gated by the SENDER's own consent + hours
    // (sendSms → gateSms enforces; never emergency:true).
    let echoSms = false;
    try {
      const r = await sendSms(s.phone, replyEchoBody(replierName, text));
      echoSms = r.ok;
    } catch {
      /* best-effort — the reply is already recorded */
    }
    return { routed: true, echoSms };
  } catch {
    return { routed: false, echoSms: false };
  }
}

/* ── Sender SMS consent (the first-send consent gate) ────────────── */
/** Does this phone already have SMS consent on file (any store)? Returning
 * users are never re-gated (same rule as the safety gate). */
export async function senderHasSmsConsent(phoneDigits: string): Promise<boolean> {
  const { smsConsentFor } = await import("~/lib/smsServer");
  const c = await smsConsentFor(phoneDigits);
  return c.sms;
}

/* ── Zero-PII analytics bucket ───────────────────────────────────── */
export function audienceBucket(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  return "6+";
}

/** The caller's normalized phone from ?phone= / x-sg-phone / body. */
export function peerMsgCallerPhone(req: Request, body?: { phone?: unknown }): string {
  return normPhone(body?.phone ?? req.headers.get("x-sg-phone"));
}

export { peerRpc };