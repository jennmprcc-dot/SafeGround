/**
 * Peer-to-peer texting (owner goal 2026-09-16, spec Part A) — the on-demand
 * trust-circle channel: a neighbor picks an intent (I need support / Unsafe
 * location / I'm OK) + an optional ≤140-char note, chooses WHO gets it
 * (Just me / All my peers / A group / chosen people — the same chips, group
 * picker and mental model as the check-in), chooses a PER-SEND location
 * (none / fuzzed ~150m / exact — never pre-selected, default none), reviews
 * an explicit consent moment on the FIRST send (texting is the point:
 * "I understand — send it"), and the server fans out by SMS (opt-in +
 * business-hours gated, NEVER emergency), push, and in-app. Replies come
 * back here as one-to-one echoes — never a group broadcast.
 *
 * Helps the older-user read too: one step per screen (Step 1 of 3), 52px
 * primary buttons, calm plain copy, no urgency, no dead ends — every step has
 * a reachable Back/Next and the success card says what happens next.
 *
 * IDENTITY: phone-keyed exactly like /checkin — the caller's own number rides
 * the x-sg-phone header; the server resolves users.id from it. No account.
 *
 * FLOORS (server-enforced; this page just asks honestly):
 *  - Never 911 / never an agency: "Unsafe location" reaches the sender's own
 *    trusted peers only, and the page copy says so.
 *  - Location is never chosen for the user: the radios start on "No location";
 *    reading a point happens only when the user picks fuzzed/exact and taps send.
 *  - First-send consent card (ptext_consent_*) previews exactly what a peer
 *    receives, reuses the nc_sms_sub disclosure verbatim, and writes the
 *    sender's own opt-in (source="peertext") before the message goes out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import {
  Button,
  Card,
  ConsentReceipt,
  EmptyState,
  ListRow,
  OfflineBanner,
  SkeletonRows,
  TextArea,
  useToasts,
} from "~/components/ui";
import { type I18nKey, useLanguage } from "~/lib/i18n";
import { CheckCircleIcon, ChevronRightIcon } from "~/lib/icons";
import { getAlertIdentity } from "~/lib/alertIdentity";
import { cn } from "~/lib/cn";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";
import { logAnonymousEvent } from "~/lib/analytics/logger";

/* ── Row shapes (mirror the check-in readers) ───────────────────── */
interface PeerListRow {
  userId: string;
  name: string;
  status: "accepted" | "pending";
  mutual: boolean;
  direction: "in" | "out";
  codeExpiresAt: string | null;
}
interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
  members: Array<{ userId: string; name: string }>;
  staleCount: number;
  createdAt: string | null;
}
type IntentKind = "need" | "unsafe" | "ok";
type LocKind = "none" | "fuzzed" | "exact";
type Audience =
  | { kind: "me" }
  | { kind: "all" }
  | { kind: "group"; groupId: string }
  | { kind: "peers"; peerIds: string[] };
interface ThreadRow {
  id: string;
  intent: IntentKind;
  note: string | null;
  audienceKind: string;
  locKind: LocKind;
  sentAt: string;
  replyCount: number;
  replies: Array<{ authorName: string; body: string; createdAt: string }>;
}
interface FetchState {
  threads: ThreadRow[];
  peers: PeerListRow[];
  groups: GroupRow[];
  senderSmsConsent: boolean;
  senderName: string | null;
}

/** Client twin of the server's business-hours floor (America/Los_Angeles,
 * Mon–Fri 8am–6pm) — drives the after-hours NOTE on step 3 only; the actual
 * gate is server-side and never client-supplied. */
function inBusinessHoursNow(now: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hr = parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1", 10);
    return wd !== "Sat" && wd !== "Sun" && hr >= 8 && hr < 18;
  } catch {
    return true; // unknown TZ — never block, never gate (server decides anyway)
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const INTENT_ICON: Record<IntentKind, string> = { need: "💬", unsafe: "⚠️", ok: "✅" };
const INTENT_KEY: Record<IntentKind, I18nKey> = {
  need: "ptext_intent_need",
  unsafe: "ptext_intent_unsafe",
  ok: "ptext_intent_ok",
};
const INTENT_SUB: Record<IntentKind, I18nKey> = {
  need: "ptext_intent_need_sub",
  unsafe: "ptext_intent_unsafe_sub",
  ok: "ptext_intent_ok_sub",
};

/* ── the composer — three calm one-action screens (spec §A3) ────── */
function Composer({
  peers,
  groups,
  senderName,
  sentState,
  sentConsentKnown,
  onSent,
  onBackToInbox,
}: {
  peers: PeerListRow[];
  groups: GroupRow[];
  senderName: string | null;
  sentState: SubmitConfirmState | null;
  sentConsentKnown: boolean;
  onSent: (state: SubmitConfirmState, counts: { audience: number; sms: number; push: number; inApp: number; justMe: boolean }) => void;
  onBackToInbox: () => void;
}) {
  const { t } = useLanguage();
  const { push } = useToasts();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [intent, setIntent] = useState<IntentKind | null>(null);
  const [note, setNote] = useState("");
  const [seg, setSeg] = useState<"me" | "all" | "group">("all");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [locKind, setLocKind] = useState<LocKind>("none"); // default = none, never pre-chosen
  const [consentChecked, setConsentChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(true);
  const [lastCounts, setLastCounts] = useState<{ audience: number; sms: number; push: number; inApp: number; justMe: boolean } | null>(null);

  // First-send consent is a server fact (senderHasSmsConsent) — the parent
  // passes it because it is fetched with the inbox; re-render when it changes.
  useEffect(() => {
    setNeedsConsent(!sentConsentKnown);
  }, [sentConsentKnown]);

  const mutual = useMemo(() => peers.filter((p) => p.mutual), [peers]);

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

  const audienceValid =
    seg === "me" ||
    seg === "all" ||
    (seg === "group" && (pickOpen ? picked.length > 0 : selectedGroupId != null));
  const audienceLabel = (): string => {
    if (audience.kind === "me") return t("ck_aud_me");
    if (audience.kind === "all") return t("ck_aud_all");
    if (audience.kind === "group") {
      const g = groups.find((x) => x.id === audience.groupId);
      return g ? `${g.name} · ${g.memberCount}` : t("ck_aud_group");
    }
    return `${t("ck_aud_pick")} · ${picked.length}`;
  };

  const afterHours = !inBusinessHoursNow();

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

  const locCard = (k: LocKind, title: string, sub: string, icon: string) => (
    <label
      className={cn(
        "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 bg-sg-card px-3 py-2.5 transition-colors",
        locKind === k ? "border-sg-sage bg-sg-sage-wash/50" : "border-sg-line",
      )}
    >
      <input
        type="radio"
        name="ptext-loc"
        checked={locKind === k}
        onChange={() => setLocKind(k)}
        className="h-5 w-5 shrink-0 accent-[#2F6B4F]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-body font-medium text-sg-ink">
          <span aria-hidden>{icon}</span> {title}
        </span>
        <span className="mt-0.5 block text-small text-sg-ink-soft">{sub}</span>
      </span>
    </label>
  );

  const nextDisabled =
    step === 1 ? intent == null : step === 2 ? !audienceValid : false;

  const nextStep = () => {
    if (step === 1 && intent != null) setStep(2);
    else if (step === 2 && audienceValid) setStep(3);
  };

  const sendNow = async () => {
    // Consent gate FIRST (the "I understand — send it" moment). Re-check
    // server-side so a STOP'd sender is never sent silently; the write is
    // the sender's OWN phone (x-sg-phone must match the body phone).
    if (needsConsent) {
      if (!consentChecked) {
        push({ kind: "info", message: t("ptext_consent_check").slice(0, 90) + "…" });
        return;
      }
      const identity = getAlertIdentity();
      const phone0 = identity?.phone ?? "";
      if (phone0.length < 7) return;
      try {
        const r = await fetch("/api/directory/consent", {
          method: "POST",
          headers: { "content-type": "application/json", "x-sg-phone": phone0 },
          body: JSON.stringify({ phone: phone0, afterHours: false, sms: true, source: "peertext" }),
        });
        const d = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (!r.ok || !d?.ok) {
          push({ kind: "error", message: "That choice didn't save — try again when you can." });
          return;
        }
        setNeedsConsent(false);
      } catch {
        push({ kind: "error", message: "No connection right now — your draft is saved. Try again when you can." });
        return;
      }
    }

    const identity = getAlertIdentity();
    if (!identity?.phone) {
      push({ kind: "info", message: "Add your number first — then you can text your people." });
      return;
    }
    const phone = identity.phone;
    const theIntent = intent ?? "need";
    if (intent == null) return;

    setSending(true);
    let loc: { kind: LocKind; lat?: number; lng?: number } = { kind: locKind };
    if (locKind !== "none") {
      // A REAL single user-initiated read, used once for this send. On
      // failure we fall back to none with the calm line (spec §A8) — the
      // message still goes out with words only.
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        loc = { kind: "none" };
        push({ kind: "info", message: t("un_loc_fail") });
      } else {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 0, timeout: 8000 }),
          );
          loc = { kind: locKind, lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          loc = { kind: "none" };
          push({ kind: "info", message: t("un_loc_fail") });
        }
      }
    }

    const payload = {
      phone,
      intent: theIntent,
      note,
      audience:
        audience.kind === "group"
          ? { kind: "group", groupId: audience.groupId }
          : audience.kind === "peers"
            ? { kind: "peers", peerIds: audience.peerIds }
            : { kind: audience.kind },
      location: loc,
    };
    try {
      const res = await fetch("/api/peer-messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": phone },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        threadId?: string;
        audienceCount?: number;
        smsSent?: number;
        pushSent?: number;
        inAppOnly?: number;
        ceiling?: boolean;
        error?: string;
      } | null;
      if (res.ok && data?.ok) {
        const counts = {
          audience: data.audienceCount ?? 0,
          sms: data.smsSent ?? 0,
          push: data.pushSent ?? 0,
          inApp: data.inAppOnly ?? 0,
          justMe: audience.kind === "me",
        };
        setLastCounts(counts);
        const line = counts.justMe
          ? t("ptext_done_justme")
          : counts.audience === 1 && counts.sms === 1
            ? t("ptext_done")
            : counts.audience > 1
              ? t("ptext_count")
                  .replace("{n}", String(counts.audience))
                  .replace("{sms}", String(counts.sms))
                  .replace("{app}", String(counts.inApp + counts.push))
              : t("ptext_done");
        onSent({ saved: true, kind: "saved", line }, counts);
        push({ kind: "success", message: counts.justMe ? t("ptext_done_justme") : t("ptext_done") });
        try {
          logAnonymousEvent("peer_text_send", { category: theIntent });
        } catch {
          /* silent — the message already landed */
        }
      } else {
        onSent({ saved: false, kind: "draft", line: t("sw_offline_draft") }, { audience: 0, sms: 0, push: 0, inApp: 0, justMe: false });
        push({ kind: "error", message: data?.error ?? t("sw_offline_draft") });
      }
    } catch {
      onSent({ saved: false, kind: "draft", line: t("sw_offline_draft") }, { audience: 0, sms: 0, push: 0, inApp: 0, justMe: false });
      push({ kind: "error", message: t("sw_offline_draft") });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      {/* step progress row — calm, no urgency */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-small font-medium text-sg-ink-soft">{t("ptext_step").replace("{n}", String(step))}</p>
        <div className="flex items-center gap-1" aria-hidden>
          {[1, 2, 3].map((s) => (
            <span key={s} className={cn("h-1.5 w-8 rounded-full", s <= step ? "bg-sg-sage" : "bg-sg-line")} />
          ))}
        </div>
      </div>

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-h2 text-sg-ink">{t("ptext_step_what")}</h2>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("ptext_step_what")}>
            {(Object.keys(INTENT_ICON) as IntentKind[]).map((k) => (
              <label
                key={k}
                className={cn(
                  "flex min-h-[52px] cursor-pointer items-start gap-3 rounded-[12px] border-2 bg-sg-card px-3 py-2.5 transition-colors",
                  intent === k ? "border-sg-sage bg-sg-sage-wash/50" : "border-sg-line",
                )}
              >
                <input
                  type="radio"
                  name="ptext-intent"
                  checked={intent === k}
                  onChange={() => setIntent(k)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-sg-ink">
                    <span aria-hidden className="mr-1.5">{INTENT_ICON[k]}</span>
                    {t(INTENT_KEY[k])}
                  </span>
                  <span className="mt-0.5 block text-small text-sg-ink-soft">{t(INTENT_SUB[k])}</span>
                </span>
              </label>
            ))}
          </div>
          <TextArea
            label={t("ptext_note_label")}
            maxLength={140}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("ptext_note_ph")}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-h2 text-sg-ink">{t("ptext_step_who")}</h2>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("ptext_step_who")}>
            {segBtn("me", t("ck_aud_me"))}
            {segBtn("all", t("ck_aud_all"))}
            {segBtn("group", t("ck_aud_group"))}
          </div>
          {mutual.length === 0 && seg !== "me" ? (
            <div className="rounded-[12px] border border-sg-line bg-sg-paper px-3 py-3">
              <p className="text-small text-sg-ink-soft">{t("ptext_no_peers")}</p>
              <Link to="/checkin/peers/invite" className="mt-1 inline-flex min-h-[44px] items-center text-sg-sky underline underline-offset-2">
                {t("ptext_add_peer")}
              </Link>
            </div>
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
                      onChange={() =>
                        setPicked((prev) => (prev.includes(p.userId) ? prev.filter((x) => x !== p.userId) : [...prev, p.userId]))
                      }
                      className="h-5 w-5 accent-[#2F6B4F]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-sg-ink">{p.name.split(" ")[0]}</span>
                      <span className="block text-small text-sg-ink-soft">sees your messages</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="px-2 pb-1 text-small text-sg-ink-soft">{t("ck_pick_count").replace("{n}", String(picked.length))}</p>
            </div>
          ) : null}
          <p className="rounded-[12px] bg-sg-sky-wash/60 px-3 py-2.5 text-small text-sg-ink-soft">{t("ptext_channel_note")}</p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-h2 text-sg-ink">{t("ptext_step_loc")}</h2>
          <p className="text-small text-sg-ink-soft">{t("ptext_loc_choose")}</p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("ptext_step_loc")}>
            {locCard("none", t("ptext_loc_none"), t("ptext_loc_none_sub"), "🚫")}
            {locCard("fuzzed", t("ptext_loc_fuzzed"), t("ptext_loc_fuzzed_sub"), "📍")}
            {locCard("exact", t("ptext_loc_exact"), t("ptext_loc_exact_sub"), "🎯")}
          </div>

          {/* What you're sending — ConsentReceipt (who/what/how-long/stop) */}
          <ConsentReceipt
            who={audienceLabel()}
            what={`“${intent ? t(INTENT_KEY[intent]) : t("ptext_intent_need")}”` + (note.trim() ? ` — ${note.trim().slice(0, 60)}` : "") + ` · ${locKind === "none" ? t("ptext_loc_none_sub") : locKind === "fuzzed" ? `${t("ptext_loc_fuzzed")} (~150m)` : t("ptext_loc_exact")}`}
            howLong="Location 24h — the message stays in the thread."
            stopLabel="They can reply STOP — you can remove a peer anytime."
          />

          {needsConsent ? (
            <div className="flex flex-col gap-2 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash/50 p-3">
              <p className="text-btn font-medium text-sg-sage-deep">{t("ptext_consent_title")}</p>
              <p className="text-small text-sg-ink-soft">{t("ptext_consent_body")}</p>
              {/* Preview: exactly what one peer receives (spec §A5) */}
              <div className="rounded-[12px] border border-sg-line bg-sg-card px-3 py-2.5">
                <p className="text-small text-sg-ink-soft">SafeGround</p>
                <p className="text-body text-sg-ink">
                  {senderName?.split(" ")[0] ?? "Alex"}: {intent ? t(INTENT_KEY[intent]) : t("ptext_intent_need")}
                  {note.trim() ? ` — ${note.trim().slice(0, 60)}` : ""}
                  {locKind !== "none" ? (locKind === "fuzzed" ? " — near an approximate area (~150m)" : " — with the exact spot") : ""}
                </p>
                <p className="mt-0.5 text-small text-sg-ink-soft">Reply to reach {senderName?.split(" ")[0] ?? "Alex"}. (Reply STOP to stop.)</p>
              </div>
              <label className="flex min-h-[52px] cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
                />
                <span className="text-small text-sg-ink">{t("ptext_consent_check")}</span>
              </label>
              {/* The legal disclosure — nc_sms_sub verbatim (one source of truth) */}
              <p className="px-1 text-[11px] leading-snug text-sg-ink-soft">{t("nc_sms_sub")}</p>
            </div>
          ) : null}

          {afterHours ? (
            <p className="rounded-[12px] bg-sg-gold-wash/60 px-3 py-2.5 text-small text-sg-ink-soft">{t("ptext_afterhours_note")}</p>
          ) : null}
        </div>
      ) : null}

      {/* Primary + Back — 52px primary, quiet Back */}
      {step < 3 ? (
        <div className="flex flex-col gap-2">
          <Button full disabled={nextDisabled} onClick={nextStep}>
            Next →
          </Button>
          {step > 1 ? (
            <Button variant="quiet" full onClick={() => setStep((s) => (s === 2 ? 1 : 2) as 1 | 2)}>
              Back
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button full disabled={sending || (needsConsent && !consentChecked)} onClick={() => void sendNow()}>
            {needsConsent ? t("ptext_consent_btn") : t("ptext_send")}
          </Button>
          <Button variant="quiet" full onClick={() => setStep(2)}>
            Back
          </Button>
        </div>
      )}

      {sentState ? (
        <div className="flex flex-col gap-2">
          <SubmitConfirm state={sentState} />
          {sentState.kind !== "draft" ? (
            <div className="rounded-[12px] bg-sg-sage-wash/60 px-3 py-2.5">
              <p className="text-btn font-medium text-sg-sage-deep">{t("ptext_what_next")}</p>
              <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-small text-sg-ink-soft">
                <li>{t("ptext_next_1")}</li>
                <li>{t("ptext_next_2")}</li>
                <li>{t("ptext_next_3")}</li>
              </ul>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={onBackToInbox}>
              {t("ptext_inbox")}
            </Button>
            <Button full onClick={() => resetAfterSend(setIntent, setSeg, setSelectedGroupId, setPicked, setLocKind, setStep)}>
              {t("ptext_send_another")}
            </Button>
          </div>
          {lastCounts && !lastCounts.justMe && sentState.kind !== "draft" ? (
            <p className="px-1 text-small text-sg-ink-soft">
              {t("ptext_count")
                .replace("{n}", String(lastCounts.audience))
                .replace("{sms}", String(lastCounts.sms))
                .replace("{app}", String(lastCounts.inApp + lastCounts.push))}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Reset the composer for a second send (the draft is intentionally kept —
 * the note survives so a follow-up is one tap; intent/location are re-chosen
 * per the floors: location is NEVER re-selected for the user). */
function resetAfterSend(
  setIntent: (v: IntentKind | null) => void,
  setSeg: (v: "me" | "all" | "group") => void,
  setSelectedGroupId: (v: string | null) => void,
  setPicked: (v: string[]) => void,
  setLocKind: (v: LocKind) => void,
  setStep: (v: 1 | 2 | 3) => void,
) {
  setIntent(null);
  setSeg("all");
  setSelectedGroupId(null);
  setPicked([]);
  setLocKind("none"); // never pre-selected — reset to none after every send
  setStep(1);
}

/* ── the page ───────────────────────────────────────────────────── */
function PeerTextPage() {
  const { t } = useLanguage();
  const [id] = useState(() => getAlertIdentity());
  const phone = id?.phone ?? "";
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [data, setData] = useState<FetchState>({ threads: [], peers: [], groups: [], senderSmsConsent: false, senderName: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const [sentState, setSentState] = useState<SubmitConfirmState | null>(null);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [sentConsentKnown, setSentConsentKnown] = useState(false);
  const outboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!phone) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/peer-messages?phone=${encodeURIComponent(phone)}`, { headers: { "x-sg-phone": phone } })
        .then((r) => r.json().catch(() => null))
        .catch(() => null),
      fetch(`/api/checkin?phone=${encodeURIComponent(phone)}`, { headers: { "x-sg-phone": phone } })
        .then((r) => r.json().catch(() => null))
        .catch(() => null),
    ])
      .then(([msgs, ckin]) => {
        if (!alive) return;
        const m = msgs as { ok?: boolean; threads?: ThreadRow[]; senderSmsConsent?: boolean; senderName?: string | null } | null;
        const c = ckin as { ok?: boolean; peers?: PeerListRow[]; groups?: GroupRow[] } | null;
        if (m?.ok && c?.ok) {
          setData({
            threads: m.threads ?? [],
            peers: c.peers ?? [],
            groups: c.groups ?? [],
            senderSmsConsent: m.senderSmsConsent === true,
            senderName: m.senderName ?? null,
          });
          setSentConsentKnown(m.senderSmsConsent === true);
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
  }, [phone, refreshTick]);

  const mutualCount = data.peers.filter((p) => p.mutual).length;

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("ptext_title")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("ptext_sub")}</p>
        </header>

        {!phone ? (
          /* Phone-less state — calm "add your number" prompt (spec §A8), never a dead end. */
          <Card>
            <p className="text-body text-sg-ink-soft">
              Peers are tied to a phone number you use on this device. Add it once and you can text the people you trust — and they can reply by text.
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
              <OfflineBanner message={t("sw_offline_draft")} onRetry={() => setRefreshTick((x) => x + 1)} />
            ) : null}

            <Composer
              peers={data.peers}
              groups={data.groups}
              senderName={data.senderName}
              sentState={sentState}
              sentConsentKnown={sentConsentKnown}
              onSent={(state) => {
                setSentState(state);
                setRefreshTick((x) => x + 1);
              }}
              onBackToInbox={() => outboxRef.current?.scrollIntoView({ behavior: "smooth" })}
            />

            {/* My messages — the sender's own threads + replies (spec §A9.2) */}
            <section ref={outboxRef}>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-small font-medium text-sg-ink">{t("ptext_inbox")}</p>
              </div>
              <p className="px-1 pb-2 text-small text-sg-ink-soft">
                Only you see this. Replies come back to you here — never to the group.
              </p>
              {data.threads.length === 0 ? (
                <EmptyState
                  icon={<CheckCircleIcon size={28} />}
                  title={t("ptext_thread_empty")}
                  body={t("ptext_sub")}
                />
              ) : (
                <ul className="flex flex-col">
                  {data.threads.map((th) => (
                    <ListRow key={th.id}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-sg-ink">
                          {t(INTENT_KEY[th.intent] ?? "ptext_intent_need")}
                          <span className="ml-1.5 text-small font-normal text-sg-ink-soft">· {timeLabel(th.sentAt)}</span>
                        </span>
                        {th.note ? <span className="mt-0.5 block truncate text-small text-sg-ink-soft">“{th.note}”</span> : null}
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-small text-sg-ink-soft">
                          {th.locKind === "none" ? "No location · " : th.locKind === "fuzzed" ? "Approx area (~150m) · " : "Exact spot · "}
                          {th.replyCount > 0
                            ? t("ptext_reply_badge").replace("{n}", String(th.replyCount))
                            : th.audienceKind === "me"
                              ? "Just me"
                              : "No replies yet"}
                        </span>
                        {th.replies.length > 0 ? (
                          <span className="mt-1 block rounded-[12px] bg-sg-paper px-2 py-1.5">
                            {th.replies.map((r, i) => (
                              <span key={i} className="block text-small text-sg-ink">
                                {t("ptext_reply_echo").replace("{name}", r.authorName).replace("{reply}", r.body)}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span aria-hidden className="text-sg-ink-soft">
                        <ChevronRightIcon size={16} />
                      </span>
                    </ListRow>
                  ))}
                </ul>
              )}
            </section>

            {mutualCount === 0 ? (
              <p className="text-small text-sg-ink-soft">{t("ptext_no_peers")}</p>
            ) : null}
          </>
        )}

        <button type="button" onClick={() => setCrisisOpen(true)} className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2">
          {t("crisis_title")}
        </button>
      </div>

      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/peer-text")({ component: PeerTextPage });