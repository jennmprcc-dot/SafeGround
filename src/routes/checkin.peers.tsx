/**
 * PEER-1 — Trusted peers list (spec §1.2). Extends /checkin's peers section
 * into its own screen.
 *
 * States (top→bottom per spec):
 *  - no-connections EmptyState (Invite a peer / How it works)
 *  - revoked notice line (dismissable, never names who)
 *  - incoming invites (sage card TOP): "A peer wants to share check-ins with
 *    you." + Accept / Not now
 *  - pending-out (gold row): "Waiting for them to accept" (phone invite — no
 *    expiry) | "Invite sent · expires in 2d" (code invite), quiet Cancel
 *  - accepted rows: name + "sees your check-ins · remove anytime" + [Remove]
 *    → gentle-red confirm dialog
 *  - footer ConsentReceipt (Who/What/How long/Stop)
 * Skeleton rows while loading; offline banner + cached list + Retry.
 *
 * Identity: the caller's own phone (x-sg-phone) — bound server-side; a
 * neighbor whose phone has no user row yet sees the calm "add your number
 * first" state. No contact import anywhere; one typed number at a time.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import {
  BottomSheet,
  Button,
  Card,
  ConsentReceipt,
  Dialog,
  EmptyState,
  IconTile,
  ListRow,
  OfflineBanner,
  SkeletonRows,
  TextField,
  useToasts,
} from "~/components/ui";
import { getAlertIdentity } from "~/lib/alertIdentity";
import { type I18nKey, useLanguage } from "~/lib/i18n";
import { PersonIcon, CloseIcon } from "~/lib/icons";

interface PeerRow {
  userId: string;
  name: string;
  status: "pending" | "accepted";
  mutual: boolean;
  direction: "out" | "in";
  /** Present only when this pending invite came from a redeemed 6-char code
   * (PEER-3 — "Invite sent · expires in 2d"). Phone invites: null = no expiry. */
  codeExpiresAt: string | null;
}
interface NoteRow {
  id: string;
  note: string;
  recipientName: string;
  createdAt: string | null;
  status: "saved" | "delivered";
}
interface PeersState {
  ok: boolean;
  requesterId: string | null;
  requesterName: string | null;
  phone: string;
  peers: PeerRow[] | null;
  notes: NoteRow[] | null;
}
const EMPTY_PEERS: PeersState = { ok: true, requesterId: null, requesterName: null, phone: "", peers: null, notes: null };

const REVOKED_KEY = "sg.peers.revoked-notice-dismissed";

/** Load the caller's peers state with a phone identity (localStorage first,
 * falls back to prompting nothing on first visit). Signals "needsPhone" when
 * no stored phone exists yet (the invite flow binds it). */
async function fetchPeers(): Promise<{ state: PeersState; source: "db" | "offline" }> {
  const id = getAlertIdentity();
  if (!id?.phone) return { state: EMPTY_PEERS, source: "offline" };
  const q = new URLSearchParams({ phone: id.phone });
  try {
    const res = await fetch(`/api/peers?${q}`, { headers: { "x-sg-phone": id.phone } });
    const data = (await res.json().catch(() => null)) as PeersState | null;
    if (!res.ok || !data || !data.ok) {
      return { state: EMPTY_PEERS, source: "offline" };
    }
    return { state: data, source: "db" };
  } catch {
    return { state: EMPTY_PEERS, source: "offline" };
  }
}

/** First name only (the app never shows surnames). */
const first = (name: string): string => (name || "a peer").split(" ")[0];

/* ── Peer groups (PEER_GROUPS_SPEC §4) ────────────────────────────
 * Owner-only, server-enforced: GET/POST /api/checkin/groups. The client
 * mirrors the server's name rules + caps so most violations never leave the
 * phone; the server stays the enforcement layer either way. */

interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
  members: Array<{ userId: string; name: string }>;
  staleCount: number;
  createdAt: string | null;
}

async function fetchGroups(phone: string): Promise<{ groups: GroupRow[]; ok: boolean }> {
  try {
    const res = await fetch(`/api/checkin/groups?${new URLSearchParams({ phone })}`, {
      headers: { "x-sg-phone": phone },
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; groups?: GroupRow[] } | null;
    if (!res.ok || !data || !data.ok || !Array.isArray(data.groups)) return { groups: [], ok: false };
    return { groups: data.groups, ok: true };
  } catch {
    return { groups: [], ok: false };
  }
}

async function groupMutate(
  phone: string,
  body: { action: string; groupId?: string; name?: string; memberIds?: string[] },
): Promise<{ ok: boolean; groups: GroupRow[]; dropped?: number; error?: string }> {
  try {
    const res = await fetch("/api/checkin/groups", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sg-phone": phone },
      body: JSON.stringify({ phone, ...body }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      groups?: GroupRow[];
      dropped?: number;
      error?: string;
    } | null;
    if (res.ok && data?.ok) return { ok: true, groups: data.groups ?? [], dropped: data.dropped };
    return { ok: false, groups: [], error: data?.error ?? "That didn't go through — nothing changed. Try again in a moment." };
  } catch {
    return { ok: false, groups: [], error: "No connection right now — nothing was saved. Try again when you can." };
  }
}

/** Client mirror of the server's group-name rules (spec §4 naming rules).
 * Returns null when the name is fine, else the calm translated error. */
function groupNameError(
  raw: string,
  existingNames: string[],
  ownPhone: string,
  t: (k: I18nKey) => string,
): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0) return t("grp_name_empty");
  if (name.length > 24) return t("grp_name_long");
  // No phone-like runs, no emails, no dot-TLDs, no street addresses.
  if (
    /[0-9]{7,}/.test(name) ||
    name.includes("@") ||
    /\.(com|net|org|edu|gov|io|co|us)\b/i.test(name) ||
    /\b\d{1,6}\s+[A-Za-z]{2,}\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|hwy|highway|pl|place|ter|terrace|cir|circle)\b/i.test(name)
  ) {
    return t("grp_name_bad");
  }
  // Never the caller's own number, digits or formatted.
  const digits = name.replace(/[^0-9]/g, "");
  const own = ownPhone.replace(/[^0-9]/g, "");
  if (digits.length >= 7 && own && digits === own) return t("grp_name_bad");
  // Case-insensitive unique per owner.
  if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) return t("grp_name_dup");
  return null;
}

/** Map a rare server-side rejection (race / bypass) back to the calm copy. */
function mapGroupError(msg: string, t: (k: I18nKey) => string): string {
  if (/already have a group/i.test(msg)) return t("grp_name_dup");
  if (/all the groups/i.test(msg)) return t("grp_cap_reached");
  if (/12 people is the most/i.test(msg)) return t("grp_members_full");
  if (/at least one trusted peer/i.test(msg)) return t("grp_needs_one");
  if (/peer any more|left out/i.test(msg)) return t("grp_stale_member");
  if (/no connection|didn.t go through|didn.t save|didn.t work/i.test(msg)) return t("grp_save_offline");
  return msg;
}

/** Checkbox list of accepted peers (pending invites shown disabled) — shared
 * by the create + edit sheets. Caps at 12 with a calm note (spec §4). */
function MemberPicker({
  peers,
  selected,
  onChange,
  cap,
  t,
}: {
  peers: PeerRow[];
  selected: string[];
  onChange: (next: string[]) => void;
  cap: number;
  t: (k: I18nKey) => string;
}) {
  const accepted = peers.filter((p) => p.status === "accepted");
  const pending = peers.filter((p) => p.status === "pending");
  const atCap = selected.length >= cap;
  const allSelected = accepted.length > 0 && selected.length === accepted.length;
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (!atCap) onChange([...selected, id]);
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] px-2 text-small font-medium text-sg-ink">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange(allSelected ? [] : accepted.map((p) => p.userId))}
          className="h-5 w-5 accent-[#2F6B4F]"
        />
        {t("ck_pick_select_all")}
      </label>
      <div className="flex flex-col">
        {accepted.map((p) => {
          const checked = selected.includes(p.userId);
          return (
            <label key={p.userId} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] px-2">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atCap}
                onChange={() => toggle(p.userId)}
                className="h-5 w-5 accent-[#2F6B4F]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-sg-ink">{first(p.name)}</span>
                <span className="block text-small text-sg-ink-soft">sees your check-ins</span>
              </span>
            </label>
          );
        })}
        {pending.map((p) => (
          <div key={p.userId} className="flex min-h-[48px] items-center gap-3 rounded-[12px] px-2 opacity-60">
            <input type="checkbox" disabled className="h-5 w-5" aria-label={`${first(p.name)} — ${t("grp_pending_disabled")}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-sg-ink">{first(p.name)}</span>
              <span className="block text-small text-sg-ink-soft">{t("grp_pending_disabled")}</span>
            </span>
          </div>
        ))}
      </div>
      {atCap ? <p className="px-2 text-small text-sg-ink-soft">{t("grp_members_full")}</p> : null}
    </div>
  );
}

function PeersPage() {
  const { push } = useToasts();
  const { t } = useLanguage();
  const [state, setState] = useState<PeersState>(EMPTY_PEERS);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [revokedDismissed, setRevokedDismissed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(REVOKED_KEY) === "1",
  );
  const [removeTarget, setRemoveTarget] = useState<PeerRow | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  // Peer groups (spec §4): owner-only list + create/edit sheets + delete.
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupsOk, setGroupsOk] = useState(true);
  const [groupSheet, setGroupSheet] = useState<{ mode: "create" } | { mode: "edit"; group: GroupRow } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);
  const [howGroupsOpen, setHowGroupsOpen] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const { state: s, source } = await fetchPeers();
    setState(s);
    setOffline(source === "offline");
    if (s.phone) {
      const g = await fetchGroups(s.phone);
      setGroups(g.groups);
      setGroupsOk(g.ok);
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from the check-in audience control: /checkin/peers#groups
  // (spec §4 "second entry point") scrolls to the groups section.
  const needsPhone = !state.phone;
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hash === "#groups" &&
      !loading &&
      !needsPhone
    ) {
      document.getElementById("groups")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, needsPhone]);

  const peers = state.peers ?? [];
  const incoming = useMemo(() => peers.filter((p) => p.status === "pending" && p.direction === "in"), [peers]);
  const outgoing = useMemo(() => peers.filter((p) => p.status === "pending" && p.direction === "out"), [peers]);
  const accepted = useMemo(() => peers.filter((p) => p.status === "accepted"), [peers]);

  const act = async (action: "accept" | "decline" | "remove", peer: PeerRow) => {
    if (action === "remove") setRemoveTarget(peer); // confirm dialog first
    if (action === "decline") {
      setLoading(true);
      try {
        await fetch("/api/peers/decline", {
          method: "POST",
          headers: { "content-type": "application/json", "x-sg-phone": state.phone },
          body: JSON.stringify({ phone: state.phone, userId: peer.userId }),
        });
        push({ kind: "info", message: "Okay — nothing shared, and they won't be told." });
        await load(true);
      } catch {
        push({ kind: "error", message: "That didn't go through — try again in a moment." });
        setLoading(false);
      }
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const peer = removeTarget;
    setRemoveTarget(null);
    setLoading(true);
    try {
      const res = await fetch("/api/peers/remove", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": state.phone },
        body: JSON.stringify({ phone: state.phone, userId: peer.userId }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        push({ kind: "success", message: `${first(peer.name)} can no longer see your check-ins.` });
        await load(true);
      } else {
        push({ kind: "error", message: data?.error ?? "That didn't go through — try again in a moment." });
        setLoading(false);
      }
    } catch {
      push({ kind: "error", message: "No connection right now — try again when you can." });
      setLoading(false);
    }
  };

  const cancelOutgoing = async (peer: PeerRow) => {
    setLoading(true);
    try {
      const res = await fetch("/api/peers/remove", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": state.phone },
        body: JSON.stringify({ phone: state.phone, userId: peer.userId }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && data?.ok) {
        push({ kind: "success", message: "Invite cancelled — nothing was shared." });
        await load(true);
      } else {
        push({ kind: "error", message: "That didn't go through — try again in a moment." });
        setLoading(false);
      }
    } catch {
      push({ kind: "error", message: "No connection right now — try again when you can." });
      setLoading(false);
    }
  };

  /** Group delete (spec §4): only the group + its membership rows go. */
  const confirmDeleteGroup = async () => {
    if (!deleteTarget || !state.phone) return;
    const g = deleteTarget;
    setDeleteTarget(null);
    const r = await groupMutate(state.phone, { action: "delete", groupId: g.id });
    if (r.ok) {
      setGroups(r.groups);
      push({ kind: "success", message: t("grp_delete_done") });
    } else {
      push({ kind: "error", message: mapGroupError(r.error ?? "", t) });
    }
  };

  const onGroupsSaved = (next: GroupRow[]) => {
    setGroups(next);
    setGroupSheet(null);
    push({ kind: "success", message: t("grp_edit_saved") });
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Trusted peers</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Only these people can see your check-ins.</p>
        </header>

        {offline ? (
          <OfflineBanner message="No connection — showing what's saved on this phone." onRetry={() => void load()} />
        ) : null}

        {needsPhone ? (
          <Card>
            <p className="text-body text-sg-ink-soft">
              Peers are tied to a phone number you use on this device. Add it once and you can invite someone you trust.
            </p>
            <div className="mt-3">
              <Link to="/checkin/peers/invite" className="block w-full">
                <Button full>Add my number &amp; invite a peer</Button>
              </Link>
            </div>
          </Card>
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            {/* revoked notice — one calm line, never names who */}
            {!revokedDismissed && state.requesterId === null ? null : !revokedDismissed ? (
              <div className="flex items-center justify-between gap-3 rounded-[12px] bg-sg-paper px-3 py-2.5 text-small text-sg-ink-soft">
                <span>Someone stopped sharing with you. That&apos;s okay — it&apos;s always their choice.</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => {
                    setRevokedDismissed(true);
                    if (typeof localStorage !== "undefined") localStorage.setItem(REVOKED_KEY, "1");
                  }}
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-sg-ink-soft"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            ) : null}

            {peers.length === 0 ? (
              <EmptyState
                icon={<PersonIcon size={28} />}
                title="No trusted peers yet"
                body="Check-ins work best with one person you trust. They only ever see an approximate area — never your exact spot."
                steps={
                  <>
                    <Link to="/checkin/peers/invite" className="block w-full">
                      <Button full>Invite a peer</Button>
                    </Link>
                    <Button variant="quiet" full onClick={() => setHowOpen(true)}>
                      How it works
                    </Button>
                  </>
                }
              />
            ) : (
              <>
                {/* incoming invite — sage card at TOP */}
                {incoming.map((p) => (
                  <Card key={p.userId} className="border-sg-sage/40 bg-sg-sage-wash/50">
                    <div className="flex items-start gap-3">
                      <IconTile wash="bg-sg-sage-wash">
                        <PersonIcon size={20} />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <p className="text-body font-medium text-sg-ink">{first(p.name)} wants to share check-ins with you.</p>
                        <p className="mt-1 text-small text-sg-ink-soft">
                          If you accept, you&apos;ll each see the other&apos;s approximate area after check-in. Either of you can stop anytime.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            onClick={() => {
                              void (async () => {
                                setLoading(true);
                                try {
                                  const res = await fetch("/api/peers/accept", {
                                    method: "POST",
                                    headers: { "content-type": "application/json", "x-sg-phone": state.phone },
                                    body: JSON.stringify({ phone: state.phone, userId: p.userId }),
                                  });
                                  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
                                  if (res.ok && data?.ok) {
                                    push({ kind: "success", message: `You're connected — ${first(p.name)} can see your check-ins when you share.` });
                                    await load(true);
                                  } else {
                                    push({ kind: "error", message: data?.error ?? "That didn't go through — try again in a moment." });
                                    setLoading(false);
                                  }
                                } catch {
                                  push({ kind: "error", message: "No connection right now — try again when you can." });
                                  setLoading(false);
                                }
                              })();
                            }}
                          >
                            Accept
                          </Button>
                          <Button variant="secondary" onClick={() => void act("decline", p)}>
                            Not now
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}

                {/* pending-out — gold row */}
                {outgoing.map((p) => (
                  <ListRow key={p.userId} className="border border-sg-gold/40 bg-sg-gold-wash/60">
                    <IconTile wash="bg-sg-gold-wash">
                      <PersonIcon size={20} />
                    </IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-sg-ink">{first(p.name)}</span>
                      <span className="block text-small text-sg-ink-soft">
                        {p.codeExpiresAt ? "Invite sent · expires in 2d" : "Waiting for them to accept"}
                      </span>
                    </span>
                    <Button variant="quiet" className="!min-h-[44px] !px-2" onClick={() => void cancelOutgoing(p)}>
                      Cancel invite
                    </Button>
                  </ListRow>
                ))}

                {/* accepted rows */}
                {accepted.map((p) => (
                  <ListRow key={p.userId}>
                    <IconTile wash="bg-sg-sage-wash">
                      <PersonIcon size={20} />
                    </IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-sg-ink">{first(p.name)}</span>
                      <span className="block text-small text-sg-ink-soft">sees your check-ins · remove anytime</span>
                    </span>
                    <Button variant="destructive" className="!min-h-[44px] !px-2" onClick={() => setRemoveTarget(p)}>
                      Remove
                    </Button>
                  </ListRow>
                ))}
              </>
            )}

            {/* Your groups (PEER_GROUPS_SPEC §4) — placed after accepted peers
                in the top→bottom order; owner-only, membership = accepted peers */}
            <section id="groups" className="scroll-mt-24">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-small font-medium text-sg-ink">{t("grp_title")}</p>
                <button
                  type="button"
                  onClick={() => setHowGroupsOpen(true)}
                  className="inline-flex min-h-[44px] items-center px-1 text-sg-sky underline underline-offset-2"
                >
                  {t("grp_how")}
                </button>
              </div>

              {!groupsOk ? (
                <Card>
                  <p className="text-small text-sg-ink-soft">Couldn&apos;t load your groups right now — try again in a moment.</p>
                </Card>
              ) : groups.length === 0 ? (
                accepted.length === 0 ? (
                  /* Peer-less empty state: a group is built from accepted peers. */
                  <Card>
                    <p className="text-body text-sg-ink-soft">{t("grp_no_peers")}</p>
                    <div className="mt-3">
                      <Link to="/checkin/peers/invite" className="block w-full">
                        <Button variant="secondary" full>Invite a peer</Button>
                      </Link>
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <p className="text-body font-medium text-sg-ink">{t("grp_empty_title")}</p>
                    <p className="mt-1 text-small text-sg-ink-soft">{t("grp_empty_body")}</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <Button full onClick={() => setGroupSheet({ mode: "create" })}>{t("grp_new")}</Button>
                      <Button variant="quiet" full onClick={() => setHowGroupsOpen(true)}>{t("grp_how")}</Button>
                    </div>
                  </Card>
                )
              ) : (
                <>
                  <ul className="flex flex-col">
                    {groups.map((g) =>
                      g.memberCount === 0 ? (
                        /* Group with all members removed — calm recovery paths. */
                        <li key={g.id}>
                          <Card className="border-sg-gold/40 bg-sg-gold-wash/40">
                            <p className="text-body font-medium text-sg-ink">{g.name}</p>
                            <p className="mt-1 text-small text-sg-ink-soft">
                              {t("grp_empty_group_title")} — {t("grp_empty_group_body")}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button variant="secondary" onClick={() => setGroupSheet({ mode: "edit", group: g })}>
                                {t("grp_add")}
                              </Button>
                              <Button variant="destructive" onClick={() => setDeleteTarget(g)}>
                                {t("grp_manage_delete")}
                              </Button>
                            </div>
                          </Card>
                        </li>
                      ) : (
                        <ListRow key={g.id}>
                          <IconTile wash="bg-sg-sage-wash">
                            <PersonIcon size={20} />
                          </IconTile>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-medium text-sg-ink">{g.name}</span>
                            <span className="block text-small text-sg-ink-soft">
                              {t("grp_members").replace("{n}", String(g.memberCount))}
                            </span>
                          </span>
                          <Button variant="quiet" className="!min-h-[44px] !px-2" onClick={() => setGroupSheet({ mode: "edit", group: g })}>
                            {t("grp_manage_one")}
                          </Button>
                        </ListRow>
                      ),
                    )}
                  </ul>
                  <div className="mt-3">
                    <Button
                      full
                      disabled={groups.length >= 6}
                      disabledReason={groups.length >= 6 ? t("grp_cap_reached") : undefined}
                      onClick={() => setGroupSheet({ mode: "create" })}
                    >
                      {t("grp_new")}
                    </Button>
                  </div>
                </>
              )}
            </section>

            {/* saved notes (NOTE-1 sender view) */}
            {state.notes && state.notes.length > 0 ? (
              <section>
                <div className="mb-2 px-1">
                  <p className="text-small font-medium text-sg-ink">Saved notes</p>
                  <p className="text-small text-sg-ink-soft">Kind notes you saved — they&apos;ll send when messaging arrives.</p>
                </div>
                <Card>
                  <ul className="flex flex-col divide-y divide-sg-line">
                    {state.notes.map((n) => (
                      <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-body text-sg-ink">For {first(n.recipientName)}</p>
                          <p className="mt-0.5 line-clamp-2 text-small text-sg-ink-soft" style={{ overflowWrap: "anywhere" }}>{n.note}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-sg-paper px-2.5 py-1 text-small text-sg-ink-soft">Saved · not yet delivered</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            ) : null}

            <Link to="/checkin/peers/invite" className="block w-full">
              <Button full>+ Invite a peer</Button>
            </Link>

            <div className="flex flex-col">
              <button type="button" onClick={() => setHowOpen(true)} className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2">
                How sharing works
              </button>
              {state.phone ? (
                <button type="button" onClick={() => setCodeOpen(true)} className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2">
                  Have a code?
                </button>
              ) : null}
            </div>
          </>
        )}

        <ConsentReceipt
          who="Named peers only"
          what="Approximate area (~150m) + time + note, only when you check in"
          howLong="24 hours, then it disappears"
          stopLabel="Pause sharing"
        />

        <button type="button" onClick={() => setCrisisOpen(true)} className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2">
          Talk to someone
        </button>
      </div>

      {/* Remove confirm — gentle-red confirm, per spec */}
      <Dialog
        open={removeTarget != null}
        title={removeTarget ? `Remove ${first(removeTarget.name)}?` : ""}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoveTarget(null)}
      >
        She&apos;ll see &quot;Not sharing&quot; right away. She won&apos;t get your location again unless you invite her back.
      </Dialog>

      {/* Code redeem (PEER-3) */}
      <CodeSheet
        open={codeOpen}
        phone={state.phone}
        onClose={() => setCodeOpen(false)}
        onDone={(msg) => {
          setCodeOpen(false);
          if (msg) push({ kind: "success", message: msg });
          void load(true);
        }}
        onError={(msg) => push({ kind: "error", message: msg })}
      />

      {/* Group create / edit (spec §4) */}
      <GroupCreateSheet
        open={groupSheet?.mode === "create"}
        peers={peers}
        phone={state.phone}
        existingNames={groups.map((g) => g.name)}
        onClose={() => setGroupSheet(null)}
        onSaved={onGroupsSaved}
        onError={(msg) => push({ kind: "info", message: msg })}
      />
      <GroupManageSheet
        open={groupSheet?.mode === "edit"}
        group={groupSheet?.mode === "edit" ? groupSheet.group : null}
        peers={peers}
        phone={state.phone}
        existingNames={groups.map((g) => g.name)}
        onClose={() => setGroupSheet(null)}
        onSaved={onGroupsSaved}
        onError={(msg) => push({ kind: "info", message: msg })}
        onDelete={() => {
          if (groupSheet?.mode === "edit") setDeleteTarget(groupSheet.group);
          setGroupSheet(null);
        }}
      />
      <Dialog
        open={deleteTarget != null}
        title={deleteTarget ? t("grp_delete_title").replace("{group}", deleteTarget.name) : ""}
        confirmLabel={t("grp_delete_confirm")}
        destructive
        onConfirm={() => void confirmDeleteGroup()}
        onClose={() => setDeleteTarget(null)}
      >
        {t("grp_delete_body")}
      </Dialog>

      <HowGroupsSheet open={howGroupsOpen} onClose={() => setHowGroupsOpen(false)} />
      <HowSheet open={howOpen} onClose={() => setHowOpen(false)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

/** PEER-3 redeem: quiet "Have a code?" link opens this; redeem creates a
 * pending invite the redeemer then accepts on this screen (mutual consent). */
function CodeSheet({ open, phone, onClose, onDone, onError }: { open: boolean; phone: string; onClose: () => void; onDone: (msg: string | null) => void; onError: (msg: string) => void }) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (clean.length < 6) {
      setError("Enter the full code — it's 6 letters and numbers.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/peers/codes/use", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": phone },
        body: JSON.stringify({ phone, code: clean }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; inviterName?: string; error?: string } | null;
      if (res.ok && data?.ok) {
        onDone(data.inviterName ? `${data.inviterName} invited you — accept when you're ready.` : "Invite is waiting — accept when you're ready.");
      } else {
        setError(data?.error ?? "That code didn't work — check it or ask for a new one.");
      }
    } catch {
      setError("No connection right now — try again when you can.");
    } finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Enter a code">
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-body text-sg-ink-soft">Someone you trust shares a 6-letter code with you. It&apos;s valid for 48 hours.</p>
        <TextField
          label="Invite code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="ABC123"
          autoCapitalize="characters"
          maxLength={8}
          error={error ?? undefined}
        />
        <Button full disabled={sending || code.trim().length === 0} onClick={() => void redeem()}>
          {sending ? "Checking…" : "Use code"}
        </Button>
        <Button variant="quiet" full onClick={onClose}>
          Not now
        </Button>
      </div>
    </BottomSheet>
  );
}

/** PEER-1 "How sharing works" — the consent explainer sheet. */
function HowSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="How sharing works">
      <div className="flex flex-col gap-3 pb-2 text-small text-sg-ink-soft">
        <p><span className="font-medium text-sg-ink">Only people you choose.</span> You invite someone by typing one phone number — we never look at your contacts, and nothing is shared until they accept.</p>
        <p><span className="font-medium text-sg-ink">Only an approximate area.</span> When you check in, your trusted peers see a ~150m circle around you — never your exact spot.</p>
        <p><span className="font-medium text-sg-ink">Only 24 hours.</span> Each check-in disappears the next day. No trails, no history.</p>
        <p><span className="font-medium text-sg-ink">You can stop anytime.</span> Pause sharing hides you instantly; removing someone stops everything right away.</p>
      </div>
    </BottomSheet>
  );
}

/** Spec §4 "How groups work" — the group explainer sheet. */
function HowGroupsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("grp_how")}>
      <div className="flex flex-col gap-3 pb-2 text-small text-sg-ink-soft">
        <p><span className="font-medium text-sg-ink">{t("grp_how_1")}</span></p>
        <p>{t("grp_how_2")}</p>
        <p>{t("grp_how_3")}</p>
        <p>{t("grp_how_4")}</p>
      </div>
    </BottomSheet>
  );
}

/** Create a group (spec §4): name + accepted peers, consent line, Save. */
function GroupCreateSheet({
  open,
  peers,
  phone,
  existingNames,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  peers: PeerRow[];
  phone: string;
  existingNames: string[];
  onClose: () => void;
  onSaved: (groups: GroupRow[]) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setSelected([]);
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const nameError = groupNameError(name, existingNames, phone, t);
  const canSave = !saving && nameError == null && selected.length > 0;
  const disabledReason = nameError ?? (selected.length === 0 ? t("grp_needs_one") : undefined);

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await groupMutate(phone, {
      action: "create",
      name: name.replace(/\s+/g, " ").trim(),
      memberIds: selected,
    });
    setSaving(false);
    if (r.ok) {
      if (r.dropped && r.dropped > 0) onError(t("grp_stale_member"));
      onSaved(r.groups);
    } else {
      setError(mapGroupError(r.error ?? "", t));
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t("grp_new")}>
      <div className="flex flex-col gap-4 pb-2">
        <TextField
          label={t("grp_name_label")}
          helper={t("grp_name_help")}
          value={name}
          maxLength={24}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={name.trim().length > 0 && nameError ? nameError : undefined}
        />
        <p className="text-right text-small text-sg-ink-soft">{name.length}/24</p>
        <div className="flex flex-col gap-1">
          <p className="text-btn font-medium">{t("grp_who")}</p>
          <MemberPicker peers={peers} selected={selected} onChange={setSelected} cap={12} t={t} />
        </div>
        <p className="text-small text-sg-ink-soft">{t("grp_consent_line")}</p>
        {error ? (
          <p role="alert" className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay">
            {error}
          </p>
        ) : null}
        <Button full disabled={!canSave} disabledReason={disabledReason} onClick={() => void save()}>
          {saving ? "Saving…" : t("grp_save")}
        </Button>
        <Button variant="quiet" full onClick={onClose}>
          {t("grp_cancel")}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** Manage a group (spec §4): menu → rename | who's in it | delete. One idea
 * per screen; delete asks again in the gentle-red confirm dialog. */
function GroupManageSheet({
  open,
  group,
  peers,
  phone,
  existingNames,
  onClose,
  onSaved,
  onError,
  onDelete,
}: {
  open: boolean;
  group: GroupRow | null;
  peers: PeerRow[];
  phone: string;
  existingNames: string[];
  onClose: () => void;
  onSaved: (groups: GroupRow[]) => void;
  onError: (msg: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<"menu" | "rename" | "members">("menu");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && group) {
      setView("menu");
      setName(group.name);
      setSelected(group.members.map((m) => m.userId));
      setError(null);
      setSaving(false);
    }
  }, [open, group]);

  if (!group) return null;
  // Rename may keep its own name; duplicates are checked against the others.
  const others = existingNames.filter((n) => n.toLowerCase() !== group.name.toLowerCase());
  const renameError = groupNameError(name, others, phone, t);

  const rename = async () => {
    setSaving(true);
    setError(null);
    const r = await groupMutate(phone, { action: "rename", groupId: group.id, name: name.replace(/\s+/g, " ").trim() });
    setSaving(false);
    if (r.ok) onSaved(r.groups);
    else setError(mapGroupError(r.error ?? "", t));
  };

  /** Remove-flow: add + remove are separate server actions (AC-9 — removal
   * never notifies, never touches the peer relationship). */
  const saveMembers = async () => {
    setSaving(true);
    setError(null);
    const current = group.members.map((m) => m.userId);
    const toAdd = selected.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !selected.includes(id));
    let groupsOut: GroupRow[] | null = null;
    let dropped = 0;
    if (toAdd.length > 0) {
      const r = await groupMutate(phone, { action: "addMembers", groupId: group.id, memberIds: toAdd });
      if (!r.ok) {
        setSaving(false);
        setError(mapGroupError(r.error ?? "", t));
        return;
      }
      groupsOut = r.groups;
      dropped = r.dropped ?? 0;
    }
    for (const id of toRemove) {
      const r = await groupMutate(phone, { action: "removeMember", groupId: group.id, memberIds: [id] });
      if (!r.ok) {
        setSaving(false);
        setError(mapGroupError(r.error ?? "", t));
        return;
      }
      groupsOut = r.groups;
    }
    setSaving(false);
    if (dropped > 0) onError(t("grp_stale_member"));
    if (groupsOut) onSaved(groupsOut);
    else onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={group.name}>
      {view === "members" ? (
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-col gap-1">
            <p className="text-btn font-medium">{t("grp_who")}</p>
            <MemberPicker peers={peers} selected={selected} onChange={setSelected} cap={12} t={t} />
          </div>
          {error ? (
            <p role="alert" className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay">
              {error}
            </p>
          ) : null}
          <Button full disabled={saving} onClick={() => void saveMembers()}>
            {saving ? "Saving…" : t("grp_save")}
          </Button>
          <Button variant="quiet" full onClick={() => setView("menu")}>
            {t("grp_cancel")}
          </Button>
        </div>
      ) : view === "rename" ? (
        <div className="flex flex-col gap-4 pb-2">
          <TextField
            label={t("grp_name_label")}
            helper={t("grp_name_help")}
            value={name}
            maxLength={24}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            error={name.trim().length > 0 && renameError ? renameError : undefined}
          />
          <p className="text-right text-small text-sg-ink-soft">{name.length}/24</p>
          {error ? (
            <p role="alert" className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay">
              {error}
            </p>
          ) : null}
          <Button full disabled={saving || renameError != null} onClick={() => void rename()}>
            {saving ? "Saving…" : t("grp_manage_rename")}
          </Button>
          <Button variant="quiet" full onClick={() => setView("menu")}>
            {t("grp_cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 pb-2">
          <p className="text-small text-sg-ink-soft">
            {t("grp_members").replace("{n}", String(group.memberCount))}
          </p>
          <button
            type="button"
            onClick={() => setView("rename")}
            className="flex min-h-[52px] items-center justify-between gap-3 text-body text-sg-ink"
          >
            {t("grp_manage_rename")}
          </button>
          <button
            type="button"
            onClick={() => setView("members")}
            className="flex min-h-[52px] items-center justify-between gap-3 text-body text-sg-ink"
          >
            {t("grp_who")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-[52px] items-center justify-between gap-3 text-body text-sg-danger-gentle"
          >
            {t("grp_manage_delete")}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

export const Route = createFileRoute("/checkin/peers")({ component: PeersRouteShell });

/**
 * Layout branch for the /checkin/peers family (P1 outlet fix, 2026-09-08).
 * Same pattern as /checkin above: /checkin/peers is both a page and the parent
 * of /checkin/peers/invite. The invite page renders its own <AppShell>, so when
 * it matches we return a bare <Outlet />. The peers list itself is untouched.
 */
function PeersRouteShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChild = pathname.startsWith("/checkin/peers/invite");
  if (isChild) return <Outlet />;
  return <PeersPage />;
}