/**
 * Group CRUD for the check-in share sheet (peer groups spec §2.2 / §4 API side).
 *
 * GET  /api/checkin/groups?phone=… →
 *   { ok, requesterId, requesterName, peers[], groups[] }
 *   peers[] = the shared peer reader (mutual accepted + pending invites, so the
 *             sheet can show pending rows disabled). groups[] = the caller's own
 *             groups with their still-mutual members.
 *
 * POST /api/checkin/groups { phone, action, groupId?, name?, memberIds?[] } →
 *   { ok, groups[], group? , dropped? }
 *   action: "create" | "rename" | "delete" | "addMembers" | "removeMember"
 *
 * SERVER-ENFORCED RULES (the client is never trusted; the schema is the floor):
 *  - Owner-only read/write. A group id that isn't the caller's answers 404 with
 *    the SAME calm line as "does not exist" — no existence leak (AC-10).
 *  - Only mutually accepted peers are selectable; anything else is dropped, and
 *    the caller sees the calm "someone you picked isn't a peer any more" line.
 *  - Caps: ≤6 groups per owner, ≤12 members per group, ≥1 member to save.
 *  - Name rules: 1–24 chars, no phone-like runs, no emails/TLDs, no obvious
 *    street address, case-insensitive unique per owner.
 *  - Deleting a group deletes ONLY the group + its membership rows: check-ins,
 *    notes and the trusted-peer relationships are untouched (AC-8).
 *  - Removing a member never notifies them and never touches the peer
 *    relationship (AC-9) — no push code exists on this path at all.
 *  - No phone digits are ever returned here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  ADD_NUMBER_FIRST,
  GROUP_CAP_REACHED,
  GROUP_GONE,
  GROUP_MEMBERS_FULL,
  GROUP_NAME_DUP,
  GROUP_NEEDS_ONE,
  GROUP_STALE_MEMBER,
  GROUP_LIMITS,
  groupsForOwner,
  intersectWithPeers,
  mutualPeersForUser,
  ownedGroup,
  ownerGroupCount,
  validateGroupName,
} from "~/lib/peerGroupServer";
import { listPeersForUser, peerCallerPhone, userIdForPhone } from "~/lib/peerServer";

async function listGroups(c: { request: Request }): Promise<Response> {
  const url = new URL(c.request.url);
  const phone = peerCallerPhone(c.request, { phone: url.searchParams.get("phone") });
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const requesterId = await userIdForPhone(phone);
  if (!requesterId) {
    // Nothing bound yet: honest empty state, never invented groups.
    return Response.json({ ok: true, requesterId: null, requesterName: null, peers: [], groups: [] });
  }
  try {
    const [peers, groups, nameRows] = await Promise.all([
      listPeersForUser(requesterId),
      groupsForOwner(requesterId),
      (async () =>
        (await sql()`
          select display_name from public.users where id = ${requesterId} limit 1`) as unknown as Array<{
          display_name: string;
        }>)(),
    ]);
    return Response.json({
      ok: true,
      requesterId,
      requesterName: nameRows[0]?.display_name ?? null,
      peers,
      groups,
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load your groups — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

/** { groups, group } — the refreshed list always comes back so the sheet can
 * never show a stale membership. */
async function withList(
  ownerId: string,
  groupId: string | null,
): Promise<{ groups: Awaited<ReturnType<typeof groupsForOwner>>; group: unknown }> {
  const groups = await groupsForOwner(ownerId);
  return { groups, group: groupId ? (groups.find((g) => g.id === groupId) ?? null) : null };
}
/** How many of the client's requested member ids are NOT live mutual peers
 * (already a member, stale, or never a peer) — the calm "left out" signal. */
function countDropped(pickedIds: Set<string>, raw: unknown): number {
  const asked = new Set(
    (Array.isArray(raw) ? raw : [])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v.length > 0),
  );
  let dropped = 0;
  for (const id of asked) if (!pickedIds.has(id)) dropped += 1;
  return dropped;
}

async function mutateGroups(c: { request: Request }): Promise<Response> {
  let body: {
    phone?: unknown;
    action?: unknown;
    groupId?: unknown;
    name?: unknown;
    memberIds?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with your phone." }, { status: 400 });
  }
  const phone = peerCallerPhone(c.request, body);
  if (phone.length < 7) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const me = await userIdForPhone(phone);
  if (!me) {
    return Response.json({ ok: false, error: ADD_NUMBER_FIRST }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const groupId = String(body.groupId ?? "").trim();

  try {
    /* ── create ─────────────────────────────────────────────────────── */
    if (action === "create") {
      const named = validateGroupName(body.name, phone);
      if (!named.ok) return Response.json({ ok: false, error: named.error }, { status: 400 });
      if ((await ownerGroupCount(me)) >= GROUP_LIMITS.maxGroups) {
        return Response.json({ ok: false, error: GROUP_CAP_REACHED }, { status: 400 });
      }
      const livePeers = await mutualPeersForUser(me);
      const picked = intersectWithPeers(
        livePeers,
        Array.isArray(body.memberIds) ? (body.memberIds as unknown[]) : [],
      );
      if (picked.length > GROUP_LIMITS.maxMembers) {
        return Response.json({ ok: false, error: GROUP_MEMBERS_FULL }, { status: 400 });
      }
      if (picked.length === 0) {
        // Honest difference: "you picked nobody" vs "the people you picked are
        // no longer peers" (both change nothing).
        const askedAny = Array.isArray(body.memberIds) && body.memberIds.length > 0;
        return Response.json(
          { ok: false, error: askedAny ? GROUP_STALE_MEMBER : GROUP_NEEDS_ONE },
          { status: 400 },
        );
      }
      const members = picked;
      let newId: string | null = null;
      try {
        const rows = (await sql()`
          insert into public.peer_groups (owner_user_id, name)
          values (${me}, ${named.name})
          returning id`) as unknown as Array<{ id: string }>;
        newId = rows[0]?.id ?? null;
      } catch (e) {
        // The unique (owner, lower(name)) index is the backstop for a race.
        if (/duplicate key|unique/i.test(String((e as Error).message ?? ""))) {
          return Response.json({ ok: false, error: GROUP_NAME_DUP }, { status: 400 });
        }
        throw e;
      }
      if (!newId) {
        return Response.json({ ok: false, error: "That didn't save — try again in a moment." }, { status: 503 });
      }
      for (const m of members) {
        await sql()`
          insert into public.peer_group_members (group_id, member_user_id)
          values (${newId}, ${m.userId})
          on conflict (group_id, member_user_id) do nothing`;
      }
      // Zero-PII counter — no name, no id, no members.
      void insertAnalyticsEvent("peer_group_created", { category: null, status: null, installId: null });
      const out = await withList(me, newId);
      const dropped = countDropped(new Set(members.map((m) => m.userId)), body.memberIds);
      return Response.json({ ok: true, ...out, dropped });
    }

    /* Every other action needs a group the caller OWNS (404 otherwise). */
    const group = groupId ? await ownedGroup(me, groupId) : null;
    if (!group) return Response.json({ ok: false, error: GROUP_GONE }, { status: 404 });

    /* ── rename ─────────────────────────────────────────────────────── */
    if (action === "rename") {
      const named = validateGroupName(body.name, phone);
      if (!named.ok) return Response.json({ ok: false, error: named.error }, { status: 400 });
      try {
        await sql()`
          update public.peer_groups set name = ${named.name}, updated_at = now()
          where id = ${group.id} and owner_user_id = ${me}`;
      } catch (e) {
        if (/duplicate key|unique/i.test(String((e as Error).message ?? ""))) {
          return Response.json({ ok: false, error: GROUP_NAME_DUP }, { status: 400 });
        }
        throw e;
      }
      const out = await withList(me, group.id);
      return Response.json({ ok: true, ...out });
    }

    /* ── delete (group + membership rows ONLY) ──────────────────────── */
    if (action === "delete") {
      // ON DELETE CASCADE removes the membership rows; check_ins.audience_group_id
      // is ON DELETE SET NULL, so the caller's own check-ins survive untouched.
      await sql()`delete from public.peer_groups where id = ${group.id} and owner_user_id = ${me}`;
      const out = await withList(me, null);
      return Response.json({ ok: true, ...out });
    }

    /* ── addMembers ─────────────────────────────────────────────────── */
    if (action === "addMembers") {
      const livePeers = await mutualPeersForUser(me);
      const picked = intersectWithPeers(
        livePeers,
        Array.isArray(body.memberIds) ? (body.memberIds as unknown[]) : [],
      );
      const room = GROUP_LIMITS.maxMembers - group.members.length;
      if (room <= 0) return Response.json({ ok: false, error: GROUP_MEMBERS_FULL }, { status: 400 });
      const add = picked.slice(0, room);
      for (const m of add) {
        await sql()`
          insert into public.peer_group_members (group_id, member_user_id)
          values (${group.id}, ${m.userId})
          on conflict (group_id, member_user_id) do nothing`;
      }
      const dropped = countDropped(new Set(add.map((m) => m.userId)), body.memberIds);
      const out = await withList(me, group.id);
      return Response.json({ ok: true, ...out, dropped });
    }

    /* ── removeMember (never notifies; never touches trusted_peers) ─── */
    if (action === "removeMember") {
      const memberId = String(
        (Array.isArray(body.memberIds) ? body.memberIds[0] : "") ?? "",
      ).trim();
      if (!memberId) return Response.json({ ok: false, error: GROUP_NEEDS_ONE }, { status: 400 });
      // Scoped to a group the caller owns, so it can only ever remove a row
      // from their own group. No push, no notification, no peer change (AC-9).
      await sql()`
        delete from public.peer_group_members
        where group_id = ${group.id} and member_user_id = ${memberId}`;
      const out = await withList(me, group.id);
      return Response.json({ ok: true, ...out });
    }

    return Response.json({ ok: false, error: "That action isn't one we know — nothing changed." }, { status: 400 });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — nothing changed. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/checkin/groups")({
  server: {
    handlers: {
      GET: listGroups,
      POST: mutateGroups,
    },
  },
});
