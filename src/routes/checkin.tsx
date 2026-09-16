/**
 * Safe Sleeping Check-Ins — Build B (WIREFRAMES §4) + peer groups (BUILD B).
 * Consent-first: the owner checks in with an exact point that never leaves the
 * database (the trigger writes the ~150m fuzz), and trusted peers see ONLY the
 * fuzzed "approximate area" via the RLS-confined peer_check_ins view. 12h
 * overdue surfaces as a gentle self-nudge + a peer-visible gentle card — no
 * names/places in toasts, no auto-escalation, no authorities ever.
 * No background tracking: every check-in is a manual, user-initiated action.
 *
 * IDENTITY (peer groups spec §2.1 — the hinge): everything here is phone-keyed.
 * The caller's own number (getAlertIdentity().phone, stored on-device by the
 * /checkin/peers/invite "own" step) rides the x-sg-phone header; the server
 * resolves users.id from it. The old demo-UUID path (useAuth + myUserId +
 * createCheckIn/getMyCheckIn/…) is deprecated and NOT used on this route — the
 * peer graph, groups and check-ins all key on that one phone.
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
  StatusBadge,
  TextArea,
  useToasts,
} from "~/components/ui";
import { type I18nKey, useLanguage } from "~/lib/i18n";
import { MoonBlanketIcon, HeartIcon, PauseIcon, PersonIcon, LockIcon } from "~/lib/icons";
import { NoticeConsentOptIn } from "~/components/noticeConsent";
import { getAlertIdentity } from "~/lib/alertIdentity";
import { cn } from "~/lib/cn";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";
import { logAnonymousEvent } from "~/lib/analytics/logger";

/* ── Row shapes from the phone-keyed API (GET /api/checkin) ─────── */
interface MineRow {
  id: string;
  checkedInAt: string | null;
  visibleUntil: string | null;
  note: string | null;
  sharePaused: boolean;
  exactLat: number | null;
  exactLng: number | null;
  audienceKind: string | null;
}
/** Same reader the peer screen uses (listPeersForUser). */
interface PeerListRow {
  userId: string;
  name: string;
  status: "accepted" | "pending";
  mutual: boolean;
  direction: "in" | "out";
  codeExpiresAt: string | null;
}
/** Fuzzed peer check-ins via public.peer_check_ins — never exact coords. */
interface FriendRow {
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
interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
  members: Array<{ userId: string; name: string }>;
  staleCount: number;
  createdAt: string | null;
}
/** Who sees this check-in (mirrors the server AudienceKind + extra ids). */
type Audience =
  | { kind: "me" }
  | { kind: "all" }
  | { kind: "group"; groupId: string }
  | { kind: "peers"; peerIds: string[] };

/** Check-in success consent row: only when the neighbor has a stored phone
 * identity (the consent is tied to that phone). Reads identity lazily so the
 * opt-in appears on the checked-in state without touching auth. */
function CheckinConsentRow() {
  const [id] = useState(() => getAlertIdentity());
  if (!id?.phone) return null;
  return <NoticeConsentOptIn phone={id.phone} source="checkin" />;
}

/* ── small helpers ──────────────────────────────────────────────── */

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function hoursSince(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "under an hour";
  return `${Math.round(h)}h`;
}

/** Primary-button label derived from the audience (spec §3 #5). */
function audienceShareLabel(
  t: (k: I18nKey) => string,
  audience: Audience,
  groups: GroupRow[],
  mutualCount: number,
): string {
  if (audience.kind === "me") return t("ck_share_me");
  if (audience.kind === "all") {
    return mutualCount === 1
      ? t("ck_share_all_one")
      : t("ck_share_all").replace("{n}", String(mutualCount));
  }
  if (audience.kind === "group") {
    const g = groups.find((x) => x.id === audience.groupId);
    const n = g?.memberCount ?? 0;
    return t("ck_share_group").replace("{group}", g?.name ?? "…").replace("{n}", String(n));
  }
  return audience.peerIds.length === 1
    ? t("ck_share_pick_one")
    : t("ck_share_pick").replace("{n}", String(audience.peerIds.length));
}

/** One GET /api/checkin?phone=… read — the whole page state in a single fetch. */
async function fetchCheckin(phone: string): Promise<{
  ok: boolean;
  mine: MineRow | null;
  peers: PeerListRow[];
  friends: FriendRow[];
  groups: GroupRow[];
}> {
  const q = new URLSearchParams({ phone });
  try {
    const res = await fetch(`/api/checkin?${q}`, { headers: { "x-sg-phone": phone } });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      mine?: MineRow | null;
      peers?: PeerListRow[];
      friends?: FriendRow[];
      groups?: GroupRow[];
    } | null;
    if (!res.ok || !data || !data.ok) return { ok: false, mine: null, peers: [], friends: [], groups: [] };
    return {
      ok: true,
      mine: data.mine ?? null,
      peers: data.peers ?? [],
      friends: data.friends ?? [],
      groups: data.groups ?? [],
    };
  } catch {
    return { ok: false, mine: null, peers: [], friends: [], groups: [] };
  }
}

/* ── check-in confirm sheet (the consent moment, §4b + audience §3) ── */
function ConfirmSheet({
  open,
  peers,
  groups,
  onClose,
  onShare,
}: {
  open: boolean;
  peers: PeerListRow[];
  groups: GroupRow[];
  onClose: () => void;
  onShare: (opts: { note: string; audience: Audience }) => void;
}) {
  const { t } = useLanguage();
  const [seg, setSeg] = useState<"me" | "all" | "group">("all");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const mutual = useMemo(() => peers.filter((p) => p.mutual), [peers]);
  useEffect(() => {
    if (open) {
      // Default: all my peers when any exist (today's behaviour preserved);
      // Just me when none. A group is never pre-selected.
      setSeg(mutual.length > 0 ? "all" : "me");
      setSelectedGroupId(null);
      setPickOpen(false);
      setPicked([]);
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const audience: Audience =
    seg === "me"
      ? { kind: "me" }
      : seg === "group" && pickOpen
        ? { kind: "peers", peerIds: picked }
        : seg === "group" && selectedGroupId
          ? { kind: "group", groupId: selectedGroupId }
          : seg === "group"
            ? { kind: "group", groupId: "" }
            : { kind: "all" };
  const valid =
    seg === "me" ||
    seg === "all" ||
    (seg === "group" && (pickOpen ? picked.length > 0 : selectedGroupId != null));
  const audienceCount =
    audience.kind === "me"
      ? 0
      : audience.kind === "all"
        ? mutual.length
        : audience.kind === "group"
          ? (groups.find((g) => g.id === audience.groupId)?.memberCount ?? 0)
          : audience.peerIds.length;

  // ConsentReceipt Who/What — recomputed live from the audience choice.
  const firstNames = mutual.map((p) => p.name.split(" ")[0]);
  const who =
    audience.kind === "me"
      ? "Only you — no one else sees this"
      : audience.kind === "group"
        ? `“${groups.find((g) => g.id === audience.groupId)?.name ?? "a group"}”`
        : audience.kind === "peers"
          ? picked.length === 0
            ? "Only you"
            : picked
                .map((id) => mutual.find((m) => m.userId === id)?.name.split(" ")[0])
                .filter((n): n is string => Boolean(n))
                .slice(0, 2)
                .join(" and ")
          : firstNames.slice(0, 2).join(" and ") + (firstNames.length > 2 ? ` +${firstNames.length - 2} more` : "");
  const what =
    audience.kind === "me"
      ? "Nothing — just your own check-in history"
      : "Approximate area (~150m) + the time + your note";

  const togglePicked = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const segBtn = (k: "me" | "all" | "group", label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={seg === k}
      onClick={() => setSeg(k)}
      className={cn(
        "flex min-h-[48px] items-center justify-center rounded-[12px] border-2 px-2 text-btn font-medium transition-colors",
        seg === k ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink-soft",
      )}
    >
      {label}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Check in for tonight?">
      <div className="flex flex-col gap-4 pb-2">
        <ConsentReceipt who={who} what={what} howLong="24 hours, then it disappears" />

        {/* Who gets this check-in? — 3 segments + group picker (spec §3 #2) */}
        <div className="flex flex-col gap-2">
          <p className="text-btn font-medium">{t("ck_audience_label")}</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("ck_audience_label")}>
            {segBtn("me", t("ck_aud_me"))}
            {segBtn("all", t("ck_aud_all"))}
            {segBtn("group", t("ck_aud_group"))}
          </div>
          {mutual.length === 0 ? (
            <p className="px-1 text-small text-sg-ink-soft">{t("ck_aud_all_disabled")}</p>
          ) : null}
          {seg === "group" ? (
            groups.length === 0 ? (
              <Link to="/checkin/peers" hash="groups" className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2">
                {t("ck_aud_none")}
              </Link>
            ) : (
              <div className="flex flex-wrap gap-2" role="listbox" aria-label={t("ck_aud_group")}>
                {groups.map((g) => {
                  const active = !pickOpen && selectedGroupId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={g.memberCount === 0}
                      onClick={() => {
                        setSelectedGroupId(g.id);
                        setPickOpen(false);
                      }}
                      className={cn(
                        "inline-flex min-h-[48px] items-center gap-1.5 rounded-full border-2 px-3 text-btn transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                        active ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink-soft",
                      )}
                    >
                      <span className="max-w-[160px] truncate">{g.name}</span>
                      <span className="text-small opacity-70">· {g.memberCount}</span>
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
          {seg === "group" ? (
            <button
              type="button"
              onClick={() => {
                setPickOpen((v) => !v);
                setSelectedGroupId(null);
              }}
              className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2"
            >
              {t("ck_aud_pick")}
            </button>
          ) : null}
          {seg === "group" && pickOpen ? (
            <div className="flex flex-col gap-1 rounded-[12px] bg-sg-paper px-2 py-2">
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-2 text-small font-medium text-sg-ink">
                <input
                  type="checkbox"
                  checked={mutual.length > 0 && picked.length === mutual.length}
                  onChange={() => {
                    if (picked.length === mutual.length) setPicked([]);
                    else setPicked(mutual.map((p) => p.userId));
                  }}
                  className="h-5 w-5 accent-[#2F6B4F]"
                />
                {t("ck_pick_select_all")}
              </label>
              <div className="flex flex-col">
                {mutual.map((p) => (
                  <label key={p.userId} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] px-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(p.userId)}
                      onChange={() => togglePicked(p.userId)}
                      className="h-5 w-5 accent-[#2F6B4F]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-sg-ink">{p.name.split(" ")[0]}</span>
                      <span className="block text-small text-sg-ink-soft">sees your check-ins</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="px-2 pb-1 text-small text-sg-ink-soft">
                {t("ck_pick_count").replace("{n}", String(picked.length))}
              </p>
            </div>
          ) : null}
        </div>

        {/* Where should they look? — one honest option (the old "I'll place a
             pin" radio was a no-op and is gone; a real pin needs a map the app
             doesn't ship, so the single location read is the only promise). */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-btn font-medium">Where should they look?</legend>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-3">
            <input type="radio" name="where" checked onChange={() => undefined} className="accent-sg-sage" />
            <span className="text-body">
              Use my location once
              <span className="block text-small text-sg-ink-soft">reads once, shared only if you say yes</span>
            </span>
          </label>
        </fieldset>

        <TextArea
          label="Note (optional)"
          helper="e.g. 'out tonight, phone low' — 140 characters"
          maxLength={140}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything you want your peers to know?"
        />
        <Button full disabled={!valid} onClick={() => onShare({ note, audience })}>
          {audienceShareLabel(t, audience, groups, mutual.length)}
        </Button>
        {audience.kind !== "me" && audienceCount > 0 ? (
          <p className="px-1 text-small text-sg-ink-soft">{t("ck_push_note")}</p>
        ) : null}
        <Button variant="quiet" full onClick={onClose}>
          Not now
        </Button>
      </div>
    </BottomSheet>
  );
}

/* ── find-my-friend map (§4d) — fuzzed pins + approximate circles ─ */
function FriendsMap({ peers }: { peers: FriendRow[] }) {
  return (
    <div className="relative flex h-[240px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)", backgroundSize: "26px 26px, 100% 100%" }}
      />
      {peers.map((p, i) => {
        const left = 15 + ((i * 43) % 62);
        const top = 18 + ((i * 41) % 44);
        return (
          <div key={p.id} className="absolute" style={{ left: `${left}%`, top: `${top}%` }} aria-hidden>
            {p.overdue ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sg-clay shadow-md">
                <PersonIcon size={14} className="text-white" />
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sg-sage shadow-md ring-2 ring-sg-sage/25 ring-offset-2 ring-offset-transparent">
                <PersonIcon size={14} className="text-white" />
              </span>
            )}
          </div>
        );
      })}
      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-sg-card px-3 py-1.5 text-small font-medium text-sg-ink shadow-md">
        <span className="h-2.5 w-2.5 rounded-full bg-sg-sage" aria-hidden />
        Approximate area
      </span>
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-sg-card px-3 py-1.5 text-small text-sg-ink-soft shadow-md">
        <LockIcon size={14} aria-hidden />
        ~150m fuzz
      </span>
    </div>
  );
}

/* ── NOTE-1 composer sheet — preset heart + custom ≤140, honest save ── */
function NoteComposer({
  open,
  name,
  userId,
  preset,
  onClose,
  onSave,
}: {
  open: boolean;
  name: string;
  userId: string;
  preset: string;
  onClose: () => void;
  onSave: (peer: { name: string; userId: string }, text: string) => void;
}) {
  const [text, setText] = useState(preset);
  useEffect(() => {
    if (open) setText(preset);
  }, [open, preset]);
  return (
    <BottomSheet open={open} onClose={onClose} title={`Send a kind note to ${name}`}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-small text-sg-ink-soft">Only {name} sees this. Be kind — no pressure to reply.</p>
        <TextArea
          label="Your note"
          maxLength={140}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Thinking of you ♥"
          helper="Plain text — up to 140 characters"
        />
        <Button full disabled={text.trim().length === 0} onClick={() => onSave({ name, userId }, text)}>
          Save note
        </Button>
        <Button variant="quiet" full onClick={onClose}>
          Cancel
        </Button>
      </div>
    </BottomSheet>
  );
}

/* ── "How to help" — overdue peer expander (text/call/outreach steps,
 *   NEVER authorities; spec §1.4 keeps this unchanged) ─────────── */
function HelpSheet({ peer, onClose }: { peer: FriendRow | null; onClose: () => void }) {
  if (!peer) return null;
  const name = peer.peerName.split(" ")[0];
  return (
    <BottomSheet open={peer != null} onClose={onClose} title={`How to help ${name}`}>
      <div className="flex flex-col gap-3 pb-2 text-small text-sg-ink-soft">
        <p>
          {name} hasn&apos;t checked in for {peer.checkedInAt ? hoursSince(peer.checkedInAt) : "a while"}. A gentle reach-out can help — no pressure, no alarm.
        </p>
        <div className="flex flex-col gap-2">
          <p className="flex gap-2"><span className="font-medium text-sg-ink">1.</span> Send a kind note — tap their heart below and pick "Thinking of you".</p>
          <p className="flex gap-2"><span className="font-medium text-sg-ink">2.</span> Text or call the way you normally do — a soft "you okay?" goes far.</p>
          <Link to="/help" onClick={onClose} className="flex gap-2">
            <span className="font-medium text-sg-ink">3.</span> <span className="text-sg-sky underline underline-offset-2">Find MPRCC outreach opening times</span> — someone on the team can check in person.
          </Link>
        </div>
        <p>This stays between you. It never involves authorities, ever.</p>
      </div>
    </BottomSheet>
  );
}

/* ── Check-in page ──────────────────────────────────────────────── */
function CheckInPage() {
  const { t } = useLanguage();
  const { push } = useToasts();
  const [id] = useState(() => getAlertIdentity());
  const phone = id?.phone ?? "";
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [mine, setMine] = useState<MineRow | null>(null);
  const [peers, setPeers] = useState<PeerListRow[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [shareTick, setShareTick] = useState(0);
  const [locating, setLocating] = useState(false);
  /** Persistent on-screen confirmation of the check-in submit (owner-directed 2026-09-07). */
  const [checkinConfirmed, setCheckinConfirmed] = useState<SubmitConfirmState | null>(null);
  /** The audience of the LAST successful send this session — drives the honest
   * "visible to …" line on the status card (the API keeps only audienceKind). */
  const [lastAudience, setLastAudience] = useState<Audience | null>(null);
  // NOTE-1: composer sheet state + locally-saved note rows (outbox).
  const [composer, setComposer] = useState<{ name: string; userId: string; preset: string } | null>(null);
  const [savedNotes, setSavedNotes] = useState<Array<{ id: string; recipientName: string }>>([]);
  const [helpPeer, setHelpPeer] = useState<FriendRow | null>(null);

  useEffect(() => {
    if (!phone) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchCheckin(phone)
      .then((data) => {
        if (!alive) return;
        if (data.ok) {
          setMine(data.mine);
          setPeers(data.peers);
          setFriends(data.friends);
          setGroups(data.groups);
          setOffline(false);
        } else {
          setOffline(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setOffline(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, shareTick]);

  const mutually = useMemo(() => peers.filter((p) => p.mutual), [peers]);
  const acceptedPeers = mutually; // accepted rows rendered on /checkin (full manage lives on PEER-1)
  const selfOverdue = mine?.checkedInAt
    ? Date.now() - new Date(mine.checkedInAt).getTime() > 12 * 3_600_000
    : false;
  const defaultAudience: Audience = mutually.length > 0 ? { kind: "all" } : { kind: "me" };

  /** Honest "visible to …" line on the status card (spec §3 status card). */
  const visibleLine = (): string => {
    const la = lastAudience;
    if (la?.kind === "peers") return t("ck_visible_pick").replace("{n}", String(la.peerIds.length));
    if (la?.kind === "group") {
      const g = groups.find((x) => x.id === la.groupId);
      return g
        ? t("ck_visible_group").replace("{group}", g.name).replace("{n}", String(g.memberCount))
        : t("ck_visible_group_anon");
    }
    if (mine?.audienceKind === "me" || la?.kind === "me") return t("ck_visible_me");
    if (mine?.audienceKind === "group") return t("ck_visible_group_anon");
    if (mine?.audienceKind === "peers") return t("ck_visible_peers_anon");
    return t("ck_visible_all").replace("{n}", String(mutually.length));
  };

  const share = async (opts: { note: string; audience: Audience }) => {
    setConfirmOpen(false);
    if (!phone) {
      push({ kind: "info", message: "Add your number first — then you can check in with your peers." });
      return;
    }
    // REAL location only — a single user-initiated device read, used once for
    // this check-in. No stored fallback, no invented point: if the read fails
    // or isn't available, the sender sees a calm notice and tries again.
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      push({ kind: "error", message: "Location isn't available on this device right now — try again when you can." });
      return;
    }
    let lat: number;
    let lng: number;
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 0, timeout: 8000 }),
      );
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      setLocating(false);
    } catch {
      setLocating(false);
      setCheckinConfirmed({ saved: false, kind: "draft", line: "Couldn't read your location — allow it once, or try again when you can." });
      push({ kind: "error", message: "Couldn't read your location — allow it once, or try again when you can." });
      return;
    }
    const payload = {
      phone,
      lat,
      lng,
      note: opts.note,
      audience:
        opts.audience.kind === "group"
          ? { kind: "group", groupId: opts.audience.groupId }
          : opts.audience.kind === "peers"
            ? { kind: "peers", peerIds: opts.audience.peerIds }
            : { kind: opts.audience.kind },
    };
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": phone },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        id?: string;
        checkedInAt?: string | null;
        visibleUntil?: string | null;
        note?: string | null;
        sharePaused?: boolean;
        exactLat?: number | null;
        exactLng?: number | null;
        audienceKind?: string | null;
        notified?: number;
        error?: string;
      } | null;
      if (res.ok && data?.ok) {
        setMine({
          id: data.id ?? "",
          checkedInAt: data.checkedInAt ?? new Date().toISOString(),
          visibleUntil: data.visibleUntil ?? null,
          note: data.note ?? null,
          sharePaused: data.sharePaused === true,
          exactLat: data.exactLat ?? null,
          exactLng: data.exactLng ?? null,
          audienceKind: data.audienceKind ?? null,
        });
        setLastAudience(opts.audience);
        setShareTick((x) => x + 1);
        // Anonymous analytics: bare `check_in` counter, ONLY when the check-in
        // REALLY landed in the DB. No coords, no note, no user_id. Fire-and-forget.
        try {
          logAnonymousEvent("check_in");
        } catch {
          /* silent — the check-in already succeeded */
        }
        // Honest post-send line driven by the SERVER's real delivery counts
        // (spec §3): notified > 0 → "your people were notified"; 0 → "they'll
        // see it when they open the app"; "Just me" → the private line.
        const line =
          opts.audience.kind === "me"
            ? t("ck_saved_me")
            : (data.notified ?? 0) > 0
              ? t("ck_saved_notified")
              : t("ck_saved_quiet");
        setCheckinConfirmed({ saved: true, kind: "saved", line });
        push({ kind: "success", message: "You're checked in — rest easy." });
      } else {
        setCheckinConfirmed({ saved: false, kind: "draft", line: "No connection right now — your draft is saved. Try again when you can." });
        push({ kind: "error", message: data?.error ?? "No connection right now — your draft is saved. Try again when you can." });
      }
    } catch {
      setCheckinConfirmed({ saved: false, kind: "draft", line: "No connection right now — your draft is saved. Try again when you can." });
      push({ kind: "error", message: "No connection right now — your draft is saved. Try again when you can." });
    }
  };

  const pauseNow = async (paused: boolean) => {
    setPauseOpen(false);
    if (!phone) {
      push({ kind: "info", message: "Add your number first — then you can manage sharing." });
      return;
    }
    try {
      const res = await fetch("/api/checkin/sharing", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": phone },
        body: JSON.stringify({ phone, paused }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setMine((m) => (m ? { ...m, sharePaused: paused } : m));
        push({ kind: "info", message: paused ? "Sharing is paused — your peers see 'Not sharing right now'." : "Sharing is back on." });
      } else {
        push({ kind: "error", message: data?.error ?? "Couldn't update right now — try again in a moment." });
      }
    } catch {
      push({ kind: "error", message: "Couldn't update right now — try again in a moment." });
    }
  };

  // NOTE-1: open the composer (preset pre-fills, editable). The heart button
  // and "Write a note" both land here.
  const openComposer = (name: string, peerId: string, preset = "") => {
    if (!phone) {
      push({ kind: "info", message: "Add your number first — then you can save a note for a friend." });
      return;
    }
    setComposer({ name: name.split(" ")[0], userId: peerId, preset });
  };

  /** Save a note: writes peer_notes (delivered_at NULL) via the API AND keeps
   * a LOCAL outbox copy — the honest "saved, not yet delivered" state. */
  const saveNote = async (peer: { name: string; userId: string }, text: string) => {
    if (!text.trim()) return;
    setComposer(null);
    const identity = getAlertIdentity();
    if (!identity?.phone) {
      // No phone identity yet — keep the draft locally so nothing is lost.
      setSavedNotes((prev) => [...prev, { id: `local-${Date.now()}`, recipientName: peer.name }]);
      push({ kind: "info", message: `Note saved for ${peer.name} — will send when messaging arrives` });
      return;
    }
    try {
      const res = await fetch("/api/peers/notes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": identity.phone },
        body: JSON.stringify({ phone: identity.phone, userId: peer.userId, note: text.trim().slice(0, 140) }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setSavedNotes((prev) => [...prev, { id: `saved-${Date.now()}`, recipientName: peer.name }]);
        push({ kind: "success", message: `Note saved for ${peer.name} — will send when messaging arrives` });
      } else {
        // Honest partial state: the draft is saved on this phone (outbox).
        setSavedNotes((prev) => [...prev, { id: `draft-${Date.now()}`, recipientName: peer.name }]);
        push({ kind: "info", message: `Saved on this phone — we'll send it when we're connected.` });
      }
    } catch {
      setSavedNotes((prev) => [...prev, { id: `draft-${Date.now()}`, recipientName: peer.name }]);
      push({ kind: "info", message: `Saved on this phone — we'll send it when we're connected.` });
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Check in</h1>
          {locating ? (
            <p role="status" className="text-small text-sg-ink-soft">Reading your location once — nothing is stored.</p>
          ) : null}
          <p className="mt-0.5 text-small text-sg-ink-soft">Let someone know you're okay — no rush.</p>
        </header>

        {!phone ? (
          /* Phone-less state (spec §2.1): calm "add your number" card — the
             invite screen's own step stores the number via setAlertIdentity. */
          <Card>
            <p className="text-body text-sg-ink-soft">
              Peers are tied to a phone number you use on this device. Add it once and you can check in with the people you trust.
            </p>
            <div className="mt-3">
              <Link to="/checkin/peers/invite" className="block w-full">
                <Button full>Add my number</Button>
              </Link>
            </div>
          </Card>
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            {offline ? (
              <OfflineBanner
                message="No connection — showing what's saved on this phone."
                onRetry={() => setShareTick((x) => x + 1)}
              />
            ) : null}

            {/* status card (§4a states) */}
            <Card className={cn(selfOverdue && "border-sg-clay/50 bg-sg-clay-wash/40")}>
              <div className="flex items-start gap-3">
                <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]", selfOverdue ? "bg-sg-clay-wash text-sg-clay" : "bg-sg-sage-wash text-sg-sage")} aria-hidden>
                  <MoonBlanketIcon size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  {mine && !mine.sharePaused && mine.visibleUntil ? (
                    <>
                      <h2 className="text-h2">You're checked in — rest easy.</h2>
                      <p className="mt-1 text-small text-sg-ink-soft">
                        {timeLabel(mine.checkedInAt as string)} · {visibleLine()} until tomorrow {timeLabel(mine.visibleUntil as string)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setConfirmOpen(true)}>Check in again</Button>
                        <Button variant="quiet" onClick={() => setPauseOpen(true)}>
                          <PauseIcon size={18} aria-hidden /> Pause sharing
                        </Button>
                      </div>
                    </>
                  ) : mine && mine.sharePaused ? (
                    <>
                      <h2 className="text-h2">Sharing is paused</h2>
                      <p className="mt-1 text-small text-sg-ink-soft">Your peers see "Not sharing right now."</p>
                      <div className="mt-3">
                        <Button variant="secondary" onClick={() => void pauseNow(false)}>Resume sharing</Button>
                      </div>
                    </>
                  ) : selfOverdue ? (
                    <>
                      <h2 className="text-h2">It's been a while since your last check-in</h2>
                      <p className="mt-1 text-small text-sg-ink-soft">Want to let {mutually.length > 0 ? mutually[0]?.name.split(" ")[0] : "your peers"} know you're okay?</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => setConfirmOpen(true)}>Check in now</Button>
                        <Button variant="quiet" onClick={() => push({ kind: "info", message: "Snoozed for 2 hours — we'll gently remind you again." })}>Snooze 2h</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-h2">Not checked in tonight</h2>
                      <p className="mt-1 text-small text-sg-ink-soft">{mutually.length === 0 ? "Check-ins work best with one trusted person." : `Sharing with ${mutually.map((p) => p.name.split(" ")[0]).slice(0, 3).join(", ")}.`}</p>
                      <div className="mt-3">
                        <Button onClick={() => setConfirmOpen(true)}>
                          {audienceShareLabel(t, defaultAudience, groups, mutually.length)}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {checkinConfirmed ? (
                <div className="mt-2">
                  <SubmitConfirm state={checkinConfirmed} />
                  <p className="mt-1 text-small text-sg-ink-soft">
                    {checkinConfirmed.kind === "draft"
                      ? "You can keep going — the draft stays on this phone until you're connected."
                      : "Your exact spot stays with you — peers see only an approximate area, for 24 hours."}
                  </p>
                </div>
              ) : null}
            </Card>

            {/* trusted peers (§4c) — now links to the dedicated PEER-1 screen */}
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-small font-medium text-sg-ink">Trusted peers — only these people can see your check-ins</p>
                <Link
                  to="/checkin/peers"
                  className="inline-flex min-h-[48px] items-center px-1 text-sg-sky underline underline-offset-2"
                >
                  Invite a peer
                </Link>
              </div>
              <ul className="flex flex-col">
                {acceptedPeers.length === 0 ? (
                  <EmptyState
                    icon={<PersonIcon size={28} />}
                    title="No trusted peers yet"
                    body="Check-ins work best with one person you trust. They only ever see an approximate area — never your exact spot."
                    steps={
                      <Link to="/checkin/peers" className="block w-full">
                        <Button full>Invite a peer</Button>
                      </Link>
                    }
                  />
                ) : (
                  acceptedPeers.map((p) => (
                    <ListRow key={p.userId}>
                      <IconTile wash="bg-sg-sage-wash"><PersonIcon size={20} /></IconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-sg-ink">{p.name}</span>
                        <span className="block text-small text-sg-ink-soft">sees your check-ins · remove anytime</span>
                      </span>
                      <Link to="/checkin/peers" className="inline-flex min-h-[44px] items-center px-1 text-sg-sky underline underline-offset-2">
                        Manage
                      </Link>
                    </ListRow>
                  ))
                )}
              </ul>
            </section>

            {/* find-my-friend (§4d) */}
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-small font-medium text-sg-ink">Friends sharing with you</p>
              </div>
              {/* FRIEND-1 privacy copy — verbatim (spec §1.3) */}
              <p className="px-1 pb-2 text-small text-sg-ink-soft">
                Approximate areas only (~150m) · 24 hours · never background · stop anytime in Check in.
              </p>
              <FriendsMap peers={friends} />
              <ul className="mt-2 flex flex-col">
                {friends.length === 0 ? (
                  <EmptyState
                    icon={<HeartIcon size={28} />}
                    title="No one shares with you yet"
                    body="When a trusted peer checks in, you'll see their approximate area here — never their exact spot."
                  />
                ) : (
                  friends.map((p) => (
                    <ListRow key={p.id}>
                      <IconTile wash={p.overdue ? "bg-sg-clay-wash" : "bg-sg-sage-wash"}>
                        <PersonIcon size={20} />
                      </IconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-sg-ink">{p.peerName}</span>
                        {p.overdue ? (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-small text-sg-ink-soft">
                            <StatusBadge kind="Overdue">Overdue</StatusBadge>
                            <span>Hasn't checked in for {p.checkedInAt ? hoursSince(p.checkedInAt) : "a while"} — a gentle check-in could help.</span>
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-small text-sg-ink-soft">
                            Checked in {p.checkedInAt ? hoursSince(p.checkedInAt) : "recently"} ago · near an approximate area
                            {p.visibleUntil ? ` · until ${timeLabel(p.visibleUntil)}` : ""}
                            {p.note ? ` · "${p.note}"` : ""}
                          </span>
                        )}
                      </span>
                      {p.overdue ? (
                        <Button variant="text" onClick={() => setHelpPeer(p)} className="!min-h-[44px]">
                          How to help &rarr;
                        </Button>
                      ) : (
                        <Button variant="quiet" onClick={() => openComposer(p.peerName, p.userId, "Thinking of you \u2665")} className="!min-h-[44px] !px-2" aria-label={`Send a kind note to ${p.peerName}`}>
                          <HeartIcon size={18} aria-hidden />
                        </Button>
                      )}
                    </ListRow>
                  ))
                )}
              </ul>
              {/* NOTE-1: saved-status line per friend card (honest — never "Sent") */}
              {savedNotes.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1 px-1">
                  {savedNotes.map((n) => (
                    <p key={n.id} className="text-small text-sg-sage-deep">
                      Note saved for {n.recipientName} — will send when messaging arrives
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            <p className="text-small text-sg-ink-soft">
              Peers only ever see an approximate area (~150m) for 24 hours. Overdue notes go to your trusted peers alone — never to agencies, and never by themselves.
            </p>
            <CheckinConsentRow />
          </>
        )}

        <ConsentReceipt
          who="Only your chosen peers"
          what="Approximate area (~150m) + time + note"
          howLong="24 hours, then it disappears"
          stopLabel="Pause sharing"
          onStop={() => (phone ? setPauseOpen(true) : push({ kind: "info", message: "Add your number first — then you can manage sharing." }))}
        />

        <button type="button" onClick={() => setCrisisOpen(true)} className="self-start text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center">
          Talk to someone
        </button>
      </div>

      <ConfirmSheet
        open={confirmOpen}
        peers={peers}
        groups={groups}
        onClose={() => setConfirmOpen(false)}
        onShare={(o) => void share(o)}
      />

      <NoteComposer
        open={composer != null}
        name={composer?.name ?? "your friend"}
        userId={composer?.userId ?? ""}
        preset={composer?.preset ?? ""}
        onClose={() => setComposer(null)}
        onSave={(peer, text) => void saveNote(peer, text)}
      />

      <HelpSheet peer={helpPeer} onClose={() => setHelpPeer(null)} />

      <Dialog
        open={pauseOpen}
        title="Pause all sharing?"
        confirmLabel="Pause sharing"
        onConfirm={() => void pauseNow(true)}
        onClose={() => setPauseOpen(false)}
      >
        Your peers will see "Not sharing right now" right away. Nothing is deleted — your check-in history is still yours.
      </Dialog>

      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/checkin")({ component: CheckInRouteShell });

/**
 * Layout branch for the /checkin family (P1 outlet fix, 2026-09-08).
 * /checkin is BOTH a page and the parent of /checkin/peers(+/invite). Without
 * an <Outlet /> the child pages were swallowed and the parent rendered instead.
 * Child pages (peers, invite) already render their own <AppShell>, so when a
 * child matches we return a bare <Outlet /> — no double shell. The /checkin
 * page itself is untouched and renders exactly as before.
 */
function CheckInRouteShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChild = pathname === "/checkin/peers" || pathname.startsWith("/checkin/peers/");
  if (isChild) return <Outlet />;
  return <CheckInPage />;
}
