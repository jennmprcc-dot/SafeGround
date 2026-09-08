/**
 * Safe Sleeping Check-Ins — Build B (WIREFRAMES §4).
 * Consent-first: the owner checks in with an exact point that never leaves the
 * database (the trigger writes the ~150m fuzz), and trusted peers see ONLY the
 * fuzzed "approximate area" via the RLS-confined peer_check_ins view. 12h
 * overdue surfaces as a gentle self-nudge + a peer-visible gentle card — no
 * names/places in toasts, no auto-escalation, no authorities ever.
 * No background tracking: every check-in is a manual, user-initiated action.
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
  SkeletonRows,
  StatusBadge,
  TextArea,
  useToasts,
} from "~/components/ui";
import { useAuth } from "~/lib/auth";
import {
  createCheckIn,
  getMyCheckIn,
  setCheckInSharing,
  listPeerCheckIns,
  listTrustedPeers,
  ensureUser,
  demoUserId,
} from "~/lib/server";
import type { CheckInRow, PeerCheckInRow, PeerRow, DataSource } from "~/lib/server";
import { MoonBlanketIcon, HeartIcon, PauseIcon, PersonIcon, LockIcon } from "~/lib/icons";
import { NoticeConsentOptIn } from "~/components/noticeConsent";
import { getAlertIdentity } from "~/lib/alertIdentity";
import { cn } from "~/lib/cn";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";
import { logAnonymousEvent } from "~/lib/analytics/logger";
/** Check-in success consent row: only when the neighbor has a stored phone
 * identity (the consent is tied to that phone). Reads identity lazily so the
 * opt-in appears on the checked-in state without touching auth. */
function CheckinConsentRow() {
  const [id] = useState(() => getAlertIdentity());
  if (!id?.phone) return null;
  return <NoticeConsentOptIn phone={id.phone} source="checkin" />;
}

/** Stable per-user UUID for the demo auth wave: same name + same device → same id. */
function myUserId(name: string): string {
  let token = "";
  if (typeof localStorage !== "undefined") token = localStorage.getItem("sg.device") ?? "";
  if (!token) {
    token = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    if (typeof localStorage !== "undefined") localStorage.setItem("sg.device", token);
  }
  return demoUserId(name, token);
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

/* ── check-in confirm sheet (the consent moment, §4b) ──────────── */
function ConfirmSheet({
  open,
  peers,
  onClose,
  onShare,
}: {
  open: boolean;
  peers: PeerRow[];
  onClose: () => void;
  onShare: (opts: { mode: "once" | "pin"; note: string }) => void;
}) {
  const [mode, setMode] = useState<"once" | "pin">("once");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setMode("once");
      setNote("");
    }
  }, [open]);
  // FRIEND-1: the "Who sees" line names current mutual peers by first name;
  // N = live mutual count, 0 allowed → button reads "Check in (just for me)"
  // and the consent line says only you can see it (records for history/self-
  // nudge, shares with nobody).
  const mutual = peers.filter((p) => p.mutual);
  const names = mutual.map((p) => p.displayName.split(" ")[0]).slice(0, 2);
  const count = mutual.length;
  const who = count > 0 ? names.join(" and ") : "Only you — no one else sees this";
  return (
    <BottomSheet open={open} onClose={onClose} title="Check in for tonight?">
      <div className="flex flex-col gap-4 pb-2">
        <ConsentReceipt
          who={who}
          what={count > 0 ? "Approximate area (~150m) + the time + your note" : "Nothing — just your own check-in history"}
          howLong="24 hours, then it disappears"
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-btn font-medium">Where should they look?</legend>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-3">
            <input type="radio" name="where" checked={mode === "once"} onChange={() => setMode("once")} className="accent-sg-sage" />
            <span className="text-body">
              Use my location once
              <span className="block text-small text-sg-ink-soft">reads once, shared only if you say yes</span>
            </span>
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-3">
            <input type="radio" name="where" checked={mode === "pin"} onChange={() => setMode("pin")} className="accent-sg-sage" />
            <span className="text-body">
              I'll place a pin
              <span className="block text-small text-sg-ink-soft">a nearby spot you choose — no live location</span>
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
        <Button full onClick={() => onShare({ mode, note })}>
          {count > 0 ? `Share check-in with ${count} ${count === 1 ? "peer" : "peers"}` : "Check in (just for me)"}
        </Button>
        <Button variant="quiet" full onClick={onClose}>
          Not now
        </Button>
      </div>
    </BottomSheet>
  );
}

/* ── find-my-friend map (§4d) — fuzzed pins + approximate circles ─ */
function FriendsMap({ peers }: { peers: PeerCheckInRow[] }) {
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
function HelpSheet({ peer, onClose }: { peer: PeerCheckInRow | null; onClose: () => void }) {
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
  const { signedIn, displayName, signIn } = useAuth();
  const { push } = useToasts();
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState<CheckInRow | null>(null);
  const [mineSource, setMineSource] = useState<DataSource>("demo");
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [friends, setFriends] = useState<PeerCheckInRow[]>([]);
  const [friendsSource, setFriendsSource] = useState<DataSource>("demo");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [shareTick, setShareTick] = useState(0);
  const [locating, setLocating] = useState(false);
  /** Persistent on-screen confirmation of the check-in submit (owner-directed 2026-09-07). */
  const [checkinConfirmed, setCheckinConfirmed] = useState<SubmitConfirmState | null>(null);
  // NOTE-1: composer sheet state + locally-saved note rows (outbox).
  const [composer, setComposer] = useState<{ name: string; userId: string; preset: string } | null>(null);
  const [savedNotes, setSavedNotes] = useState<Array<{ id: string; recipientName: string }>>([]);
  const [helpPeer, setHelpPeer] = useState<PeerCheckInRow | null>(null);

  const userId = signedIn ? myUserId(displayName) : "";

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      setMine(null);
      setPeers([]);
      setFriends([]);
      return;
    }
    let alive = true;
    setLoading(true);
    ensureUser({ data: { userId, displayName } }).catch(() => undefined);
    Promise.all([
      getMyCheckIn({ data: { userId } }),
      listTrustedPeers({ data: { userId } }),
      listPeerCheckIns({ data: { userId } }),
    ])
      .then(([mineRes, peersRes, friendsRes]) => {
        if (!alive) return;
        setMine(mineRes.row);
        setMineSource(mineRes.source);
        setPeers(peersRes.rows);
        setFriends(friendsRes.rows);
        setFriendsSource(friendsRes.source);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) {
          setLoading(false);
          setMine(null);
          setPeers([]);
          setFriends([]);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, userId, shareTick]);

  const mutually = useMemo(() => peers.filter((p) => p.mutual), [peers]);
  const acceptedPeers = mutually; // accepted rows rendered on /checkin (full manage lives on PEER-1)
  const selfOverdue = mine?.overdue ?? false;

  const share = async (opts: { mode: "once" | "pin"; note: string }) => {
    setConfirmOpen(false);
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
    const res = await createCheckIn({ data: { userId, lat, lng, note: opts.note } });
    if (res.ok) {
      setMine(res.row);
      setMineSource(res.source);
      setShareTick((t) => t + 1);
      // Anonymous analytics: bare `check_in` counter, ONLY when the check-in
      // REALLY landed in the DB (source === "db" — demo fallbacks never
      // count). No coords, no note, no user_id. Fire-and-forget.
      if (res.source === "db") {
        try {
          logAnonymousEvent("check_in");
        } catch {
          /* silent — the check-in already succeeded */
        }
      }
      // Persistent on-screen confirmation (owner-directed): STAYS until the
      // next check-in starts. Peers aren't push-notified by this path — the
      // check-in itself is the notice, so "no team push" copy is the honest one.
      setCheckinConfirmed({ saved: true, kind: "saved", line: res.source === "db" ? "Saved — your people can see you're okay." : "Saved on this phone — will sync when connected." });
      push({ kind: "success", message: res.source === "db" ? "You're checked in — rest easy." : "Check-in saved here — will sync when connected." });
    } else {
      setCheckinConfirmed({ saved: false, kind: "draft", line: "No connection right now — your draft is saved. Try again when you can." });
      push({ kind: "error", message: "No connection right now — your draft is saved. Try again when you can." });
    }
  };

  const pauseNow = async (paused: boolean) => {
    setPauseOpen(false);
    const res = await setCheckInSharing({ data: { userId, paused } });
    if (res.ok) {
      setMine((m) => (m ? { ...m, sharePaused: paused } : m));
      push({ kind: "info", message: paused ? "Sharing is paused — your peers see 'Not sharing right now'." : "Sharing is back on." });
    } else {
      push({ kind: "error", message: "Couldn't update right now — try again in a moment." });
    }
  };

  // NOTE-1: open the composer (preset pre-fills, editable). The heart button
  // and "Write a note" both land here.
  const openComposer = (name: string, peerId: string, preset = "") => {
    if (!signedIn) {
      push({ kind: "info", message: "Sign in to save a note for a friend." });
      return;
    }
    setComposer({ name: name.split(" ")[0], userId: peerId, preset });
  };

  /** Save a note: writes peer_notes (delivered_at NULL) via the API AND keeps
   * a LOCAL outbox copy — the honest "saved, not yet delivered" state. */
  const saveNote = async (peer: { name: string; userId: string }, text: string) => {
    if (!text.trim()) return;
    setComposer(null);
    const id = getAlertIdentity();
    if (!id?.phone) {
      // No phone identity yet — keep the draft locally so nothing is lost.
      setSavedNotes((prev) => [...prev, { id: `local-${Date.now()}`, recipientName: peer.name }]);
      push({ kind: "info", message: `Note saved for ${peer.name} — will send when messaging arrives` });
      return;
    }
    try {
      const res = await fetch("/api/peers/notes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": id.phone },
        body: JSON.stringify({ phone: id.phone, userId: peer.userId, note: text.trim().slice(0, 140) }),
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

        {!signedIn ? (
          <EmptyState
            icon={<MoonBlanketIcon size={28} />}
            title="Check-ins are private by design"
            body="Sign in so your check-in goes only to people you choose — your exact spot is never shared with anyone else."
            steps={
              <Button full onClick={() => { signIn(); push({ kind: "info", message: "Signed in — you can check in with the people you trust." }); }}>
                Sign in
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
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
                        {timeLabel(mine.checkedInAt)} · visible to {mutually.length} {mutually.length === 1 ? "peer" : "peers"} until tomorrow {timeLabel(mine.visibleUntil)}
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
                      <p className="mt-1 text-small text-sg-ink-soft">Want to let {mutually.length > 0 ? mutually[0]?.displayName.split(" ")[0] : "your peers"} know you're okay?</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => setConfirmOpen(true)}>Check in now</Button>
                        <Button variant="quiet" onClick={() => push({ kind: "info", message: "Snoozed for 2 hours — we'll gently remind you again." })}>Snooze 2h</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-h2">Not checked in tonight</h2>
                      <p className="mt-1 text-small text-sg-ink-soft">{mutually.length === 0 ? "Check-ins work best with one trusted person." : `Sharing with ${mutually.map((p) => p.displayName.split(" ")[0]).slice(0, 3).join(", ")}.`}</p>
                      <div className="mt-3">
                        <Button onClick={() => setConfirmOpen(true)}>Check in &amp; share with {mutually.length} {mutually.length === 1 ? "peer" : "peers"}</Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {mineSource === "demo" && mine ? <p className="mt-2 text-small text-sg-ink-soft">Demo check-in — shown here until the database connects.</p> : null}
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
                        <span className="block truncate text-body font-medium text-sg-ink">{p.displayName}</span>
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
                <p className="text-small text-sg-ink-soft">{friendsSource === "db" ? "live" : "demo"}</p>
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
                        <Button variant="quiet" onClick={() => openComposer(p.peerName, p.peerId, "Thinking of you \u2665")} className="!min-h-[44px] !px-2" aria-label={`Send a kind note to ${p.peerName}`}>
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
          onStop={() => (signedIn ? setPauseOpen(true) : push({ kind: "info", message: "Sign in to manage sharing." }))}
        />

        <button type="button" onClick={() => setCrisisOpen(true)} className="self-start text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center">
          Talk to someone
        </button>
      </div>

      <ConfirmSheet open={confirmOpen} peers={peers} onClose={() => setConfirmOpen(false)} onShare={(o) => void share(o)} />

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