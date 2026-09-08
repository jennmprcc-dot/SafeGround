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
import { formatPhone, getAlertIdentity, normPhone, phoneLooksOk, setAlertIdentity } from "~/lib/alertIdentity";
import type { NeedRow } from "~/lib/hometeam";
import { needBadgeKind, needHelpingLine } from "~/lib/hometeam";
import { HandsIcon, PlusIcon, CheckIcon, PauseIcon } from "~/lib/icons";
import { cn } from "~/lib/cn";
import type { BadgeKind } from "~/components/ui";
import { useLanguage, needStatusKey } from "~/lib/i18n";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";

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
  // Labels translate; requester/time/notes stay as stored (EN fallback).
  const { t } = useLanguage();
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
        <StatusBadge kind={badgeKindFor[needBadgeKind(need.status)]}>{t(needStatusKey(need.status))}</StatusBadge>
      </div>
      {need.visibility !== "open" ? (
        <p className="mt-2 text-small text-sg-ink-soft">{t("ht_private_line")}</p>
      ) : need.note ? (
        <p className="mt-2 text-small leading-snug text-sg-ink-soft">{need.note}</p>
      ) : null}
      {helping ? (
        <p className="mt-2 flex items-center gap-1.5 text-small font-medium text-sg-sage-deep">
          <CheckIcon size={14} aria-hidden />
          {helperName ? `${helperName} ${t("ht_helping_on_it")}` : helping}
        </p>
      ) : null}
      {(canClaim || canDeliver) && !claimedByMe ? (
        <div className="mt-3">
          {canClaim ? (
            <Button full variant="secondary" disabled={busy} onClick={onClaim}>
              <HandsIcon size={18} aria-hidden /> {t("ht_claim")}
            </Button>
          ) : null}
          {canDeliver ? (
            <Button full variant="secondary" disabled={busy} onClick={onDeliver}>
              <CheckIcon size={18} aria-hidden /> {t("ht_deliver")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {claimedByMe ? (
        <div className="mt-3 rounded-[12px] border border-sg-sage bg-sg-sage-wash p-3">
          <p className="text-small font-medium text-sg-sage-deep">{t("ht_claimed_me")}</p>
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
  const { t } = useLanguage();
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
    <BottomSheet open={open} onClose={onClose} title={t("ht_join")}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-small text-sg-ink-soft">{t("ht_join_intro")}</p>
        <TextField
          label={t("ht_join_phone")}
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          inputMode="tel"
          placeholder="(415) 555-0142"
          helper={t("ht_join_phone_help")}
          error={phoneError ?? undefined}
        />
        <TextField
          label={t("ht_join_name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("ht_join_name_ph")}
          maxLength={40}
          helper={t("ht_join_name_help")}
        />
        <button
          type="button"
          role="switch"
          aria-checked={afterHours}
          onClick={() => setAfterHours((v) => !v)}
          className="flex min-h-[52px] items-center justify-between gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-left"
        >
          <span className="text-small">
            <span className="block font-medium text-sg-ink">{t("ht_ah")}</span>
            <span className="block text-sg-ink-soft">{t("ht_ah_sub")}</span>
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
          {t("ht_join")}
        </Button>
        <p className="text-small text-sg-ink-soft">{t("ht_join_no_loc")}</p>
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
  const { t } = useLanguage();
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState("");
  const [visibility, setVisibility] = useState<"open" | "assign_only" | "private">("open");
  const [busy, setBusy] = useState(false);
  /** Persistent on-screen confirmation of the need post (owner-directed 2026-09-07). */
  const [posted, setPosted] = useState<SubmitConfirmState | null>(null);
  /** Inline calm error when the phone is missing/incomplete — blocks submit. */
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setItems("");
      setNote("");
      setPickup("");
      setVisibility("open");
      setPosted(null);
      setPhoneError(null);
    }
  }, [open]);

  const save = async () => {
    const itemList = items.split(",").map((s) => s.trim()).filter(Boolean);
    if (itemList.length === 0) {
      push({ kind: "error", message: "Add at least one thing, like a tent or a bus pass — no rush." });
      return;
    }
    // Non-outreach needs are attributed to the typer's own phone; outreach
    // logs on the neighbor's behalf. Either way a real 10-digit number is
    // required — no phone means no server call (2026-09-07 dead-end fix).
    const whoPhone = isOutreach ? neighborPhone : phone;
    if (!phoneLooksOk(whoPhone)) {
      setPhoneError("Add your 10-digit phone so the need can reach the HomeTeam — it stays private.");
      return;
    }
    setPhoneError(null);
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
      // Persistent on-screen confirmation (NOT a short-lived toast): the HomeTeam
      // feed is the notice channel — no separate team push goes out here, so
      // "shared" (not "team notified") is the honest copy.
      setPosted({
        saved: true,
        kind: "saved",
        line: res.source === "db" ? "Saved — the need is shared with the HomeTeam." : "Saved on this phone — will sync when connected.",
      });
      push({ kind: "success", message: "The need is shared with the HomeTeam — thank you." });
      onLogged();
    } else {
      // Rejection ALSO gets the persistent card (PR #22) — never a silent end.
      setPosted({ saved: false, kind: "draft", line: res.error ?? "That didn't go through — nothing changed. Try again when you can." });
      push({ kind: "error", message: res.error ?? "That didn't go through — try again when you're ready." });
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={isOutreach ? t("ht_log_for") : t("ht_log")}>
      <div className="flex flex-col gap-4 pb-2">
        {isOutreach ? (
          <div className="flex flex-col gap-4">
            <TextField label={t("ht_their_phone")} value={neighborPhone} onChange={(e) => { setPhoneError(null); onNeighborPhoneChange(normPhone(e.target.value)); }} inputMode="tel" placeholder={t("ht_their_phone_ph")} helper={t("ht_their_phone_help")} error={phoneError ?? undefined} />
            <TextField label={t("ht_their_name")} value={neighborName} onChange={(e) => onNeighborNameChange(e.target.value)} maxLength={40} helper={t("ht_their_name_help")} />
          </div>
        ) : null}
        {/* Non-outreach: the phone lives on the page identity strip, so the
            required-phone error shows here inside the sheet (2026-09-07). */}
        {!isOutreach && phoneError ? (
          <p className="rounded-[12px] border border-sg-clay/40 bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {phoneError}
          </p>
        ) : null}
        <TextField label={t("ht_what")} value={items} onChange={(e) => setItems(e.target.value)} placeholder={t("ht_what_ph")} maxLength={200} helper={t("ht_what_help")} />
        <TextArea label={t("ht_else")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ht_else_ph")} maxLength={400} />
        <TextField label={t("ht_pickup")} value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder={t("ht_pickup_ph")} maxLength={200} />
        {isOutreach ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-btn font-medium">{t("ht_who")}</legend>
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
                  {v === "open" ? t("ht_vis_open") : v === "assign_only" ? t("ht_vis_assign") : t("ht_vis_private")}
                </button>
              ))}
            </div>
            <p className="text-small text-sg-ink-soft">{t("ht_priv_note")}</p>
          </fieldset>
        ) : null}
        <Button full onClick={save} disabled={busy} disabledReason={busy ? "Saving…" : undefined}>
          {t("ht_share")}
        </Button>
        {posted ? (
          <div className="flex flex-col gap-2">
            <SubmitConfirm state={posted} />
            <Button variant="quiet" full onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null}
        <p className="text-small text-sg-ink-soft">{t("ht_first_win")}</p>
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
  const { t } = useLanguage();
  const [needs, setNeeds] = useState<NeedRow[]>([]);
  const [source, setSource] = useState<"db" | "demo">("db");
  const [loading, setLoading] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** Persistent on-screen confirmation of claim / mark-delivered (owner-directed 2026-09-07). */
  const [actionConfirmed, setActionConfirmed] = useState<SubmitConfirmState | null>(null);

  /** Local supporter identity — phone-only, never shared without action.
   * Prefilled from the stored alert identity (the same number used for
   * check-ins/alerts/peer-support) so it survives reloads (2026-09-07). */
  const [phone, setPhone] = useState<string>(() => getAlertIdentity()?.phone ?? "");
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
        // Persistent on-screen confirmation (NOT a toast): first-claim-wins
        // landed server-side — the neighbor now sees you as the helper.
        setActionConfirmed({ saved: true, kind: "saved", line: res.source === "db" ? "Saved — you're on it. The neighbor can see you." : "Saved on this phone — will sync when connected." });
        push({ kind: "success", message: "You're on it — the neighbor can see you." });
        setTick((t) => t + 1);
      } else if (res.alreadyHandled) {
        setActionConfirmed({ saved: false, kind: "saved", line: "That need is already being handled — thank you for checking." });
        push({ kind: "info", message: "That need is already being handled — thank you for checking." });
        setTick((t) => t + 1);
      } else {
        setActionConfirmed({ saved: false, kind: "draft", line: res.error ?? "That didn't go through — nothing changed." });
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
        // Persistent on-screen confirmation (NOT a toast): delivery recorded
        // server-side — hometeam_complete logs who brought what.
        setActionConfirmed({ saved: true, kind: "saved", line: res.source === "db" ? "Saved — marked delivered. Thank you for bringing it." : "Saved on this phone — will sync when connected." });
        push({ kind: "success", message: "Marked delivered — thank you for bringing it." });
        setTick((t) => t + 1);
      } else {
        setActionConfirmed({ saved: false, kind: "draft", line: res.error ?? "That didn't go through — nothing changed." });
        push({ kind: "error", message: res.error ?? "That didn't go through — nothing changed." });
      }
    },
    [phone, push],
  );

  const needsPhone = (next: string) => {
    // Normalize on change (digits only) so one-digit-at-a-time entry on real
    // devices can never submit a half-formed value; persist to localStorage
    // via the shared alert identity so it prefills next time (2026-09-07).
    const p = normPhone(next);
    setPhone(p);
    if (p.length >= 10) setAlertIdentity(p, memberStatus.name ?? "Neighbor");
    if (neighborPhone === "") setNeighborPhone(p);
  };

  /** The feed sections (calm list, one card per need). */
  const Feed = () => {
    if (loading) return <SkeletonRows rows={4} />;
    if (needs.length === 0) {
      return (
        <EmptyState
          icon={<HandsIcon size={28} />}
          title={t("ht_none")}
          body={t("ht_none_body")}
          steps={
            <Button full onClick={() => setLogOpen(true)}>
              {t("ht_log")}
            </Button>
          }
        />
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {openNeeds.length ? (
          <section aria-label="Open needs">
            <h2 className="mb-2 text-small font-semibold text-sg-ink">{t("ht_now")}</h2>
            <div className="flex flex-col gap-3">
              {openNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {activeNeeds.length ? (
          <section aria-label="Needs being handled">
            <h2 className="mb-2 text-small font-semibold text-sg-ink-soft">{t("ht_handling")}</h2>
            <div className="flex flex-col gap-3">
              {activeNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {doneNeeds.length ? (
          <section aria-label="Delivered needs">
            <h2 className="mb-2 text-small font-semibold text-sg-ink-soft">{t("ht_delivered_sec")}</h2>
            <div className="flex flex-col gap-3">
              {doneNeeds.map((n) => (
                <NeedCard key={n.id} need={n} phone={phone} claimedByMe={false} busy={busyId === n.id} onClaim={() => claim(n)} onDeliver={() => deliver(n)} />
              ))}
            </div>
          </section>
        ) : null}
        {source === "demo" && needs.length > 0 ? (
          <p className="text-small text-sg-ink-soft">Offline copy — live needs arrive when the database connects.</p>
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
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("ht_sub")}</p>
          </div>
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-sg-sage text-white"
            aria-label={t("ht_log")}
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
                  {joined ? `${t("ht_supporting_as")} ${memberStatus.name ?? "you"} · ${formatPhone(phone)}` : `${t("ht_your_number")} ${formatPhone(phone)}`}
                </span>
              </div>
              {joined ? (
                <Button variant="text" onClick={() => setPauseOpen(true)} className="min-h-[40px] !px-1">
                  <PauseIcon size={16} /> {t("ht_pause")}
                </Button>
              ) : null}
            </div>
            {outreach ? <p className="mt-1.5 text-small text-sg-sky">{t("ht_outreach_line")}</p> : null}
          </Card>
        ) : (
          <Card className="!p-3">
            <div className="flex flex-col gap-2">
              <p className="text-small text-sg-ink-soft">{t("ht_add_phone")}</p>
              <div className="flex gap-2">
                <TextField label={t("ht_join_phone")} value={phone} onChange={(e) => needsPhone(e.target.value)} inputMode="tel" placeholder="(415) 555-0100" className="!min-h-[48px]" helper={t("ht_phone_req")} error={!phoneLooksOk(phone) && phone.length > 0 ? t("ps_phone_bad") : undefined} />
              </div>
            </div>
          </Card>
        )}

        {/* Persistent on-screen confirmation of claim / mark-delivered (owner-directed 2026-09-07). */}
        {actionConfirmed ? (
          <div className="flex flex-col gap-2">
            <SubmitConfirm state={actionConfirmed} />
            <p className="text-small text-sg-ink-soft">
              {actionConfirmed.kind === "draft"
                ? "Nothing changed — you can try again when you're ready."
                : "The neighbor sees the status on their side — no one else is notified beyond the HomeTeam."}
            </p>
          </div>
        ) : null}

        {/* Join CTA when not a member yet */}
        {!joined ? (
          <Button full onClick={() => setJoinOpen(true)}>
            {t("ht_join")}
          </Button>
        ) : null}

        {phone && joined ? (
          <div className="flex flex-col gap-2">
            <Button full variant="secondary" onClick={() => setLogOpen(true)}>
              {t("ht_log")}
            </Button>
          </div>
        ) : null}

        {/* feed */}
        <main className="flex flex-col gap-4">
          <Feed />
        </main>

        <p className="text-small text-sg-ink-soft">{t("ht_no_loc")}</p>
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