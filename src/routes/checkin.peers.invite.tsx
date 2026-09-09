/**
 * PEER-2 — Invite a peer by phone (spec §1.2). ONE screen, three steps:
 *  1. Their phone number (numeric keyboard, formatPhone display, "Type one
 *     number — we never look at your contacts." helper)
 *  2. Consent card (Who/What/How long/Stop)
 *  3. [Send invite] disabled until phone valid + consent checked; quiet
 *     [Use a code instead →] → PEER-3.
 *
 * Success → back to PEER-1 pending + toast "Invite sent — nothing is shared
 * until they accept." No-account → inline kind panel (NOT an error):
 * "No neighbor on that number yet." + [Share an invite code] → PEER-3 share
 * sheet (system share — the app never sends SMS).
 *
 * PEER-3 — Invite code (same route, code sub-flow): 6-char, 48h, [Copy link]
 * + [Share…], "Expires in 48h. Only share with someone you trust."
 */
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { Button, Card, ConsentReceipt, TextField, useToasts } from "~/components/ui";
import { formatPhone, getAlertIdentity, normPhone, phoneLooksOk, setAlertIdentity } from "~/lib/alertIdentity";
import { useLanguage } from "~/lib/i18n";
import { CheckCircleIcon, CopyIcon } from "~/lib/icons";

type Step = "own" | "phone" | "code" | "code-done";

function InvitePage() {
  const { push } = useToasts();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState(() => getAlertIdentity());
  // Owner QA 2026-09-09: when no number is stored on-device, ask for the
  // inviter's OWN number first — never bind the friend's number as identity.
  const [step, setStep] = useState<Step>(() => (getAlertIdentity()?.phone ? "phone" : "own"));
  const [ownInput, setOwnInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [consented, setConsented] = useState(false);
  const [textMe, setTextMe] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [codeExpires, setCodeExpires] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const displayPhone = formatPhone(phoneInput);
  const phoneOk = phoneLooksOk(phoneInput);
  const canSend = phoneOk && consented && !sending;

  const doInvite = async () => {
    const myPhone = identity?.phone ?? "";
    if (myPhone.length < 10) {
      setError("Add your number first — then the invite comes from you.");
      setStep("own");
      return;
    }
    setSending(true);
    setError(null);
    setNoAccount(false);
    try {
      const res = await fetch("/api/peers/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": myPhone },
        body: JSON.stringify({ phone: myPhone, targetPhone: phoneInput }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        status?: string | null;
        displayName?: string | null;
        noAccount?: boolean;
        error?: string;
      } | null;
      if (res.ok && data?.ok) {
        if (data.noAccount) {
          setNoAccount(true);
          setSending(false);
          return;
        }
        if (!identity?.phone) { setSending(false); return; }
        // SMS opt-in for the inviter's OWN phone only (explicit checkbox).
        // identity.phone is guaranteed here (stored or captured in step "own").
        if (textMe) {
          try {
            const mine = normPhone(identity?.phone ?? "");
            await fetch("/api/directory/consent", {
              method: "POST",
              headers: { "content-type": "application/json", "x-sg-phone": mine },
              body: JSON.stringify({ phone: mine, afterHours: false, sms: true, source: "peer-invite" }),
            });
          } catch {
            /* opt-in save is best-effort — the invite already went out */
          }
        }
        push({ kind: "success", message: "Invite sent — nothing is shared until they accept." });
        navigate({ to: "/checkin/peers" });
      } else {
        setError(data?.error ?? "That didn't go through — nothing was sent. No rush to try again.");
        setSending(false);
      }
    } catch {
      setError("No connection right now — nothing was sent. Your words are still here when you're back.");
      setSending(false);
    }
  };

  /* ---- PEER-3: mint + share an invite code (system share — never SMS) ---- */
  const makeCode = async () => {
    const myPhone = identity?.phone ?? "";
    if (myPhone.length < 10) {
      setError("Add your number first — then the code comes from you.");
      setStep("own");
      return;
    }
    setCodeBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/peers/codes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": myPhone },
        body: JSON.stringify({ phone: myPhone }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; expiresAt?: string | null; error?: string } | null;
      if (res.ok && data?.ok && data.code) {
        setCode(data.code);
        setCodeExpires(data.expiresAt ?? null);
        setStep("code-done");
      } else {
        setError(data?.error ?? "That didn't go through — try again in a moment.");
      }
    } catch {
      setError("No connection right now — try again when you can.");
    } finally {
      setCodeBusy(false);
    }
  };

  const shareCode = async () => {
    if (!code) return;
    const url = typeof location !== "undefined" ? `${location.origin}/checkin/peers?code=${code}` : `SafeGround invite code: ${code}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "SafeGround invite", text: `I'd like you to be a trusted peer on SafeGround. Open SafeGround and enter this code within 48h: ${code}` });
      } catch {
        /* user cancelled the share sheet — code stays on screen */
      }
    } else if (typeof navigator !== "undefined" && "clipboard" in navigator) {
      try {
        await navigator.clipboard.writeText(code);
        push({ kind: "success", message: "Code copied — send it to someone you trust." });
      } catch {
        push({ kind: "error", message: "Couldn't copy — long-press to select the code." });
      }
    }
  };

  const copyLink = async () => {
    if (!code) return;
    try {
      if (typeof navigator !== "undefined" && "clipboard" in navigator) {
        await navigator.clipboard.writeText(`${location.origin}/checkin/peers?code=${code}`);
        push({ kind: "success", message: "Link copied." });
      } else {
        push({ kind: "info", message: `Open SafeGround and enter ${code} within 48h.` });
      }
    } catch {
      push({ kind: "error", message: "Couldn't copy — long-press to select the link." });
    }
  };

  /* ---- Step "own": inviter's OWN number first (never the friend's) ---- */
  const ownOk = phoneLooksOk(ownInput);
  const doOwnContinue = () => {
    if (!ownOk) return;
    setAlertIdentity(ownInput, identity?.name ?? "Neighbor");
    setIdentity(getAlertIdentity());
    setStep("phone");
  };
  if (step === "own") {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">{t("invite_own_title")}</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("invite_own_sub")}</p>
          </header>
          <Card>
            <TextField
              label={t("invite_own")}
              helper={ownInput && ownOk ? undefined : t("invite_own_help")}
              value={ownInput}
              onChange={(e) => setOwnInput(e.target.value)}
              placeholder="(415) 555-0142"
              inputMode="tel"
              autoComplete="off"
              maxLength={16}
              error={
                ownInput.length > 3 && !ownOk ? t("invite_own_bad") : undefined
              }
            />
          </Card>
          <Button full disabled={!ownOk} onClick={doOwnContinue}>
            {t("invite_own_continue")}
          </Button>
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2"
          >
            Talk to someone
          </button>
        </div>
        <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
      </AppShell>
    );
  }

  /* ---- PEER-3 code-done: the share sheet the inviter sees ---- */
  if (step === "code-done" && code) {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-4 px-4 pt-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sg-sage-wash text-sg-sage" aria-hidden>
            <CheckCircleIcon size={32} />
          </span>
          <h1 className="text-h1">Your invite code</h1>
          <div
            className="rounded-[16px] border border-sg-line bg-sg-card px-6 py-5 text-3xl font-bold tracking-[0.3em] text-sg-ink select-all"
            aria-label="Invite code"
          >
            {code}
          </div>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {codeExpires ? `Expires in 48h. Only share with someone you trust.` : "Only share with someone you trust."}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <Button full onClick={() => void shareCode()}>
              Share&hellip;
            </Button>
            <Button variant="secondary" full onClick={() => void copyLink()}>
              <CopyIcon size={18} aria-hidden /> Copy link
            </Button>
            <Link to="/checkin/peers" className="block w-full">
              <Button variant="quiet" full>
                Back to peers
              </Button>
            </Link>
          </div>
          <p className="text-small text-sg-ink-soft">
            The app never sends this for you — you share it yourself, your way.
          </p>
        </div>
        <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
      </AppShell>
    );
  }

  /* ---- PEER-2: the one screen ---- */
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Invite a peer</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">One person you trust, one number you type.</p>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <TextField
              label="Their phone number"
              helper={displayPhone && phoneOk ? undefined : "Type one number — we never look at your contacts."}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="(415) 555-0142"
              inputMode="tel"
              autoComplete="off"
              maxLength={16}
              error={
                phoneInput.length > 3 && !phoneOk
                  ? "That number looks incomplete — check it and try again, no rush."
                  : undefined
              }
            />
            {/* no-account: a kind panel, not an error (spec §1.2) */}
            {noAccount ? (
              <div className="rounded-[12px] border border-sg-sage/40 bg-sg-sage-wash/50 p-3">
                <p className="text-body font-medium text-sg-ink">No neighbor on that number yet.</p>
                <p className="mt-1 text-small text-sg-ink-soft">
                  They join SafeGround by opening it once. Until then, share an invite code they can use in 48h.
                </p>
                <Button variant="secondary" full className="mt-3" onClick={() => void makeCode()}>
                  Share an invite code
                </Button>
              </div>
            ) : null}
          </div>
        </Card>

        <ConsentReceipt
          who="Only this person, after they accept"
          what="Your approximate area (~150m) + time + note, only when you check in"
          howLong="Each check-in lasts 24h"
          stopLabel="Remove them anytime"
        />

        <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-[12px] bg-sg-paper px-3 text-small text-sg-ink">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
          />
          <span>I understand only this person will get my invite, and nothing is shared until they accept.</span>
        </label>
        <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-[12px] bg-sg-paper px-3 text-small text-sg-ink">
          <input
            type="checkbox"
            checked={textMe}
            onChange={(e) => setTextMe(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
          />
          <span>Text me updates. We only text when you opt in — reply STOP anytime.</span>
        </label>

        {error ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          full
          aria-busy={sending}
          disabled={!canSend}
          disabledReason={!phoneOk ? "A complete phone number first — no rush." : !consented ? "The consent box needs a tap — it explains exactly what's shared." : undefined}
          onClick={() => void doInvite()}
        >
          {sending ? "Sending&hellip;" : "Send invite"}
        </Button>

        <button
          type="button"
          onClick={() => void makeCode()}
          disabled={codeBusy}
          className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2 disabled:opacity-50"
        >
          Use a code instead &rarr;
        </button>

        <button
          type="button"
          onClick={() => setCrisisOpen(true)}
          className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2"
        >
          Talk to someone
        </button>
      </div>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/checkin/peers/invite")({ component: InvitePage });