/**
 * HomeTeam (Wave 2b) — MPRCC's community supporter loop.
 * Join (phone + name + consent, after-hours DEFAULT OFF) → needs feed →
 * "I got that" (first-claim-wins server-side) → "Mark delivered".
 * Neighbors log needs for themselves; outreach staff log on someone's behalf.
 * No background location, no auth-account requirement, calm copy throughout.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { BottomSheet, Button, Card, ConsentReceipt, Dialog, EmptyState, SkeletonRows, StatusBadge, TextArea, TextField, useToasts } from "~/components/ui";
import { isOutreachPhone, logNeed, joinHomeTeam, claimNeed, markNeedDelivered, listNeeds, getHomeTeamStatus } from "~/lib/server";
import { formatPhone, normPhone, phoneLooksOk } from "~/lib/alertIdentity";
import type { NeedRow } from "~/lib/hometeam";
import { NEED_STATUS_LABEL, needBadgeKind, needHelpingLine } from "~/lib/hometeam";
import { HandsIcon, PlusIcon, CheckIcon, PauseIcon } from "~/lib/icons";
import { cn } from "~/lib/cn";
import type { BadgeKind } from "~/components/ui";

export const Route = createFileRoute("/hometeam")({ component: HomeTeamPage });

/** Calm relative time: "5h ago" / "just now". */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
/** Badge palette mapper for the need status (Open/Progress/Delivered/Done). */
const badgeKindFor: Record<ReturnType<typeof needBadgeKind>, BadgeKind> = {
  Open: "Planned",
  Progress: "Active",
  Delivered: "Okay",
  Done: "Resolved",
};

/** One need as a calm card — item chips, requester (first name only), note,
 * status, helper line, action button (claims/delivers per state + identity). */
function NeedCard({
  need,
  phone,
  claimedByMe,
  busy,
  onClaim,
  onDeliver,
}: {
  need: NeedRow;
  phone: string;
  claimedByMe: boolean;
  busy: boolean;
  onClaim: () => void;
  onDeliver: () => void;
}) {
  const isOpen = need.status === "open";
  // NO public claim button on sensitive (assign_only) needs — server also gates.
  const canClaim = isOpen && need.visibility === "open" && !!phone;
  const canDeliver = (need.status === "in_progress" || need.status === "claimed") && !!phone;
  // First-name-only helper line; null-safe for the type checker.
  const helping = (needHelpingLine(need) ?? "").trim();
  const helperName = helping.split(" ")[0] ?? "";
  return (
    <article className="rounded-[16px] border border-sg-line bg-sg-card p-4 shadow-[0_1px_2px_rgba(30,42,50,0.08)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-body font-semibold text-sg-ink">
            {need.items.length > 0 ? need.items.join(" · ") : "A need"}
          </h3>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            {need.requesterLabel} · {timeAgo(need.createdAt)}
          </p>
        </div>
        <StatusBadge kind={badgeKindFor[needBadgeKind(need.status)]}>{NEED_STATUS_LABEL[need.status]}</StatusBadge>
      </div>
      {need.visibility !== "open" ? (
        <p className="mt-2 text-small text-sg-ink-soft">Arranged privately by the team — thank you for checking.</p>
      ) : need.note ? (
        <p className="mt-2 text-small leading-snug text-sg-ink-soft">{need.note}</p>
      ) : null}
      {helping ? (
        <p className="mt-2 flex items-center gap-1.5 text-small font-medium text-sg-sage-deep">
          <CheckIcon size={14} aria-hidden />
          {helperName ? `${helperName} is on it` : helping}
        </p>
      ) : null}
      {(canClaim || canDeliver) && !claimedByMe ? (
        <div className="mt-3">
          {canClaim ? (
            <Button full variant="secondary" disabled={busy} onClick={onClaim}>
              <HandsIcon size={18} aria-hidden /> I got that
            </Button>
          ) : null}
          {canDeliver ? (
            <Button full variant="secondary" disabled={busy} onClick={onDeliver}>
              <CheckIcon size={18} aria-hidden /> Mark delivered
            </Button>
          ) : null}
        </div>
      ) : null}
      {claimedByMe ? (
        <div className="mt-3 rounded-[12px] border border-sg-sage bg-sg-sage-wash p-3">
          <p className="text-small font-medium text-sg-sage-deep">You're on it — the neighbor can see you.</p>
        </div>
      ) : null}
    </article>
  );
}

/** Join sheet: phone + name + consent (after-hours toggle DEFAULT OFF). */
function JoinSheet({
  open,
  phone,
  onClose,
  onJoined,
}: {
  open: boolean;
  phone: string;
  onClose: () => void;
  onJoined: () => void;
}) {
  const { push } = useToasts();
  const [name, setName] = useState("");
  const [afterHours, setAfterHours] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState(phone);
  useEffect(() => {
    if (open) {
      setName("");
      setAfterHours(false);
      setPhoneError(null);
      setPhoneDraft(phone);
    }
  }, [open, phone]);

  const save = async () => {
    const p = normPhone(phoneDraft);
    if (!phoneLooksOk(p)) {
      setPhoneError("That number looks incomplete — please check it when you're ready.");
      return;
    }
    setBusy(true);
    const res = await joinHomeTeam({ data: { phone: p, name, consentsToAfterHours: afterHours } });
    setBusy(false);
    if (res.ok) {
      push({ kind: "success", message: afterHours ? "You're on the HomeTeam — thank you. After-hours alerts are on." : "You're on the HomeTeam — thank you for being there." });
      onJoined();
      onClose();
    } else {
      push({ kind: "error", message: res.error ?? "That didn't go through — try again in a moment." });
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Join the HomeTeam">
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-small text-sg-ink-soft">Neighbors share what they need, and supporters step in — only what's shared, only when they ask.</p>
        <TextField
          label="Your phone"
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          inputMode="tel"
          placeholder="(415) 555-0142"
          helper="Used only to match you as a supporter — never shown to strangers."
          error={phoneError ?? undefined}
        />
        <TextField
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name is fine"
          maxLength={40}
          helper="How the people you help will see you."
        />
        <button
          type="button"
          role="switch"
          aria-checked={afterHours}
          onClick={() => setAfterHours((v) => !v)}
          className="flex min-h-[52px] items-center justify-between gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-left"
        >
          <span className="text-small">
            <span className="block font-medium text-sg-ink">Also reach me after hours</span>
            <span className="block text-sg-ink-soft">Emergency alerts outside 8am–6pm Mon–Fri. Off by default.</span>
          </span>
          <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors", afterHours ? "bg-sg-sage" : "bg-sg-line")} aria-hidden>
            <span className={cn("h-5 w-5 rounded-full bg-white shadow transition-transform", afterHours ? "translate-x-5" : "translate-x-0")} />
          </span>
        </button>
        <ConsentReceipt
          who="Outreach team + the people you help"
          what="Your name, your phone, and which needs you've offered to help with"
          howLong="Until you pause or leave — pausing is one tap from this page"
          stopLabel="Pause anytime"
        />
        <Button full onClick={save} disabled={busy || !name.trim()}>
          Join the HomeTeam
        </Button>
        <p className="text-small text-sg-ink-soft">No location is ever shared, and there's no account or app to install.</p>
      </div>
    </BottomSheet>
  );
}

/** Log-a-need sheet — self (phone+name) or outreach on someone's behalf. */
function LogSheet({
  open,
  phone,
  neighborPhone,
  neighborName,
  isOutreach,
  onClose,
  onLogged,
  onNeighborPhoneChange,
  onNeighborNameChange,
}: {
  open: boolean;
  phone: string;
  neighborPhone: string;
  neighborName: string;
  isOutreach: boolean;
  onClose: () => void;
  onLogged: () => void;
  onNeighborPhoneChange: (v: string) => void;
  onNeighborNameChange: (v: string) => void;
}) {
  const { push } = useToasts();
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState("");
  const [visibility, setVisibility] = useState<"open" | "assign_only" | "private">("open");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setItems("");
      setNote("");
      setPickup("");
      setVisibility("open");
    }
  }, [open]);

  const save = async () => {
    const itemList = items.split(",").map((s) => s.trim()).filter(Boolean);
    if (itemList.length === 0) {
      push({ kind: "error", message: "Add at least one thing, like a tent or a bus pass — no rush." });
      return;
    }
    setBusy(true);
    const res = await logNeed({
      data: {
        items: itemList,
        note,
        pickup: pickup,
        neighborPhone: isOutreach ? neighborPhone : phone,
        neighborName: isOutreach ? neighborName : "",
        outreachPhone: isOutreach ? phone : "",
        visibility,
      },
    });
    setBusy(false);
    if (res.ok) {
      push({ kind: "success", message: "The need is shared with the HomeTeam — thank you." });
      onLogged();
      onClose();
    } else {
      push({ kind: "error", message: res.error ?? "That didn't go through — try again when you're ready." });
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={isOutreach ? "Log a need for someone" : "Log a need"}>
      <div className="flex flex-col gap-4 pb-2">
        {isOutreach ? (
          <div className="flex flex-col gap-4">
            <TextField label="Their phone" value={formatPhone(neighborPhone)} onChange={(e) => onNeighborPhoneChange(normPhone(e.target.value))} helper="Outreach logs on the neighbor's behalf — the need is attributed to them." />
            <TextField label="Their name" value={neighborName} onChange={(e) => onNeighborNameChange(e.target.value)} maxLength={40} helper="First name, the way they'd like it." />
          </div>
        ) : null}
        <TextField label="What's needed" value={items} onChange={(e) => setItems(e.target.value)} placeholder="tent, warm socks, bus pass" maxLength={200} helper="Comma-separated is fine — e.g. tent, sleeping bag." />
        <TextArea label="Anything else to know (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where to bring it, what works best — keep it general." maxLength={400} />
        <TextField label="Pickup preference (optional)" value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. meet near the library" maxLength={200} />
        {isOutreach ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-btn font-medium">Who may see this</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["open", "assign_only", "private"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={cn(
                    "flex min-h-[52px] items-center justify-center rounded-[12px] border-2 px-3 text-body font-medium",
                    visibility === v ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink",
                  )}
                >
                  {v === "open" ? "Anyone can help" : v === "assign_only" ? "Coordinator assigns" : "Private"}
                </button>
              ))}
            </div>
            <p className="text-small text-sg-ink-soft">Private needs stay between the neighbor and the outreach team.</p>
          </fieldset>
        ) : null}
        <Button full onClick={save} disabled={busy}>
          Share the need
        </Button>
        <p className="text-small text-sg-ink-soft">First claim wins — the neighbor sees who's helping and when it arrives.</p>
      </div>
    </BottomSheet>
  );
}

/** Pause confirmation dialog (pause = paused status; opt-out, keeps history). */
function PauseDialog({
  open,
  phone,
  onClose,
  onChanged,
}: {
  open: boolean;
  phone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { push } = useToasts();
  const doPause = async () => {
    const res = await import("~/lib/server").then((m) => m.pauseHomeTeam({ data: { phone } }));
    if (res.ok) {
      push({ kind: "info", message: "You're paused — you'll see no new needs until you resume." });
      onChanged();
      onClose();
    } else {
      push({ kind: "error", message: "That didn't go through — try again in a moment." });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Pause your HomeTeam" confirmLabel="Pause" onConfirm={doPause} destructive>
      <p className="text-body text-sg-ink-soft">Pausing means you'll stop seeing new needs. Your history stays, and one tap resumes you whenever you're ready.</p>
    </Dialog>
  );
}

/** Main page: needs feed + join/pause + log actions. */
function HomeTeamPage() {
  const { push } = useToasts();
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [source, setSource] = useState<"db" | "demo">("db");
  const [loading, setLoading] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /** Local supporter identity — phone-only, never shared without action. */
  const [phone, setPhone] = useState<string>("");
  const [memberStatus, setMemberStatus] = useState<{ status: "active" | "paused"; name: string | null; ah: boolean | null }>({
    status: "active",
    name: null,
    ah: null,
  });
  const [outreach, setOutreach] = useState(false);
  const [neighborPhone, setNeighborPhone] = useState("");
  const [neighborName, setNeighborName] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listNeeds().then((r) => {
      if (alive) {
        setNeeds(r.rows);
        setSource(r.source);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    if (!phone) return;
    let alive = true;
    getHomeTeamStatus({ data: { phone } }).then((r) => {
      if (alive) {
        setMemberStatus({ status: r.status, name: r.displayName, ah: r.consentsToAfterHours });
      }
    });
    isOutreachPhone({ data: { phone } }).then((r) => {
      if (alive) setOutreach(r.isOutreach);
    });
    return () => {
      alive = false;
    };
  }, [phone, tick]);

  const joined = memberStatus.name !== null || phone.length === 0;
  const openNeeds = useMemo(() => needs.filter((n) => n.status === "open"), [needs]);
  const activeNeeds = useMemo(() => needs.filter((n) => n.status === "claimed" || n.status === "in_progress"), [needs]);
  const doneNeeds = useMemo(() => needs.filter((n) => n.status === "delivered" || n.status === "fulfilled"), [needs]);

  /** "I got that" — first-claim-wins server-side. */
  const claim = useCallback(
    async (need: NeedRow) => {
      if (!phone) {
        push({ kind: "info", message: "Add your phone (it stays on this device) to claim a need." });
        return;
      }
      setBusyId(need.id);
      const res = await claimNeed({ data: { requestId: need.id, phone } });
      setBusyId(null);
      if (res.ok) {
        push({ kind: "success", message: "You're on it — the neighbor can see you." });
        setTick((t) => t + 1);
      } else if (res.alreadyHandled) {
        push({ kind: "info", message: "That need is already being handled — thank you for checking." });
        setTick((t) => t + 1);
      } else {
        push({ kind: "error", message: res.error ?? "That didn't go through — try again in a moment." });
      }
    },
    [phone, push],
  );

  const deliver = useCallback(
    async (need: NeedRow) => {
      if (!phone) return;
      setBusyId(need.id);
      const res = await markNeedDelivered({ data: { requestId: need.id, phone } });
      setBusyId(null);
      if (res.ok) {
        push({ kind: "success", message: "Marked delivered — thank you for bringing it." });
        setTick((t) => t + 1);
      } else {
        push({ kind: "error", message: res.error ?? "That didn't go through — nothing changed." });
      }
    },
    [phone, push],
  );

  const needsPhone = (next: string) => {
    setPhone(normPhone(next));
    if (neighborPhone === "") setNeighborPhone(normPhone(next));
  };

  /** The feed sections (calm list, one card per need). */
  const Feed = () => {
    if (loading) return <SkeletonRows rows={4} />;
    if (needs.length === 0) {
      return (
        <EmptyState
          icon={<HandsIcon size={28} />}
          title="No open needs right now"
          body="When a neighbor shares what they need, it will show here — calm and clear, with the first person to step up shown."
          steps={
            <Button full onClick={() => setLogOpen(true)}>
              Log a need
            </Button>
          }
        />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {openNeeds.length ? (
          <section aria-label="Open needs">
            <h2 className="mb-2 text-small font-semibold text-sg-ink">Needs right now</h2>
            <div className="flex flex-col gap-3">
              {openNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {activeNeeds.length ? (
          <section aria-label="Needs being handled">
            <h2 className="mb-2 text-small font-semibold text-sg-ink-soft">Being handled</h2>
            <div className="flex flex-col gap-3">
              {activeNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {doneNeeds.length ? (
          <section aria-label="Delivered needs">
            <h2 className="mb-2 text-small font-semibold text-sg-ink-soft">Delivered</h2>
            <div className="flex flex-col gap-3">
              {doneNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {source === "demo" && needs.length > 0 ? (
          <p className="text-small text-sg-ink-soft">Demo needs — shown so the shape is clear; live ones arrive when the database connects.</p>
        ) : null}
      </div>
    );
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-h1">HomeTeam</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">Neighbors share what they need — supporters step in when they can.</p>
          </div>
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-sg-sage text-white"
            aria-label="Log a need"
          >
            <PlusIcon size={20} />
          </button>
        </header>

        {/* identity strip: supporter phone + pause/resume, or join CTA */}
        {phone ? (
          <Card className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-small text-sg-ink-soft">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sg-sage-wash text-sg-sage" aria-hidden>
                  <HandsIcon size={16} />
                </span>
                <span>
                  {joined ? `Supporting as ${memberStatus.name ?? "you"} · ${formatPhone(phone)}` : `Your number: ${formatPhone(phone)}`}
                </span>
              </div>
              {joined ? (
                <Button variant="text" onClick={() => setPauseOpen(true)} className="min-h-[40px] !px-1">
                  <PauseIcon size={16} /> Pause
                </Button>
              ) : null}
            </div>
            {outreach ? <p className="mt-1.5 text-small text-sg-sky">Outreach — you can log needs for neighbors too.</p> : null}
          </Card>
        ) : (
          <Card className="!p-3">
            <div className="flex flex-col gap-2">
              <p className="text-small text-sg-ink-soft">To claim or share a need, add the number you'd like to be known by — it stays on this device.</p>
              <div className="flex gap-2">
                <TextField label="Your phone" value="" onChange={(e) => needsPhone(e.target.value)} placeholder="(415) 555-0100" className="!min-h-[48px]" />
              </div>
            </div>
          </Card>
        )}

        {/* Join CTA when not a member yet */}
        {!joined ? (
          <Button full onClick={() => setJoinOpen(true)}>
            Join the HomeTeam
          </Button>
        ) : null}

        {phone && joined ? (
          <div className="flex flex-col gap-2">
            <Button full variant="secondary" onClick={() => setLogOpen(true)}>
              Log a need
            </Button>
          </div>
        ) : null}

        {/* feed */}
        <main className="flex flex-col gap-4">
          <Feed />
        </main>

        <p className="text-small text-sg-ink-soft">Your location is never shared, and needs disappear as soon as they're delivered.</p>
      </div>

      {/* sheets + pause */}
      <JoinSheet open={joinOpen} phone={phone} onClose={() => setJoinOpen(false)} onJoined={() => setTick((t) => t + 1)} />
      <LogSheet
        open={logOpen}
        phone={phone}
        neighborPhone={neighborPhone}
        neighborName={neighborName}
        isOutreach={outreach}
        onClose={() => setLogOpen(false)}
        onLogged={() => setTick((t) => t + 1)}
        onNeighborPhoneChange={(v) => setNeighborPhone(v)}
        onNeighborNameChange={(v) => setNeighborName(v)}
      />
      <PauseDialog open={pauseOpen} phone={phone} onClose={() => setPauseOpen(false)} onChanged={() => setTick((t) => t + 1)} />
      <CrisisSheet open={false} onClose={() => undefined} />
    </AppShell>
  );
}