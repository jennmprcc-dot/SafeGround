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
import { createFileRoute, Link } from "@tanstack/react-router";
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

function PeersPage() {
  const { push } = useToasts();
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

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const { state: s, source } = await fetchPeers();
    setState(s);
    setOffline(source === "offline");
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peers = state.peers ?? [];
  const incoming = useMemo(() => peers.filter((p) => p.status === "pending" && p.direction === "in"), [peers]);
  const outgoing = useMemo(() => peers.filter((p) => p.status === "pending" && p.direction === "out"), [peers]);
  const accepted = useMemo(() => peers.filter((p) => p.status === "accepted"), [peers]);
  const needsPhone = !state.phone;

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

export const Route = createFileRoute("/checkin/peers")({ component: PeersPage });