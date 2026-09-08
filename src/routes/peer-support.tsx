/**
 * Request peer support (owner-directed 2026-09-06) — one-tap entry point.
 *
 * Flow: tap "Request peer support" → confirm phone (prefilled from the
 * phone-identity the neighbor already uses) + optional name + optional short
 * note → confirm screen in calm voice → POST /api/peer-support →
 * "An MPRCC peer will reach out. We're here."
 *
 * Consent-first: nothing leaves the device until the neighbor taps Send.
 * Never 911, never auto-dispatch outside the two roster admins (Jenn +
 * Bambi), no SMS — the server fans a Firebase push to the admins ONLY.
 * A 503/no_table means the DB update hasn't landed yet — show the calm
 * server message, never a scary error wall.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { Button, Card, ConsentReceipt, TextArea, TextField } from "~/components/ui";
import {
  formatPhone,
  getAlertIdentity,
  normPhone,
  phoneLooksOk,
  setAlertIdentity,
} from "~/lib/alertIdentity";
import { CheckCircleIcon } from "~/lib/icons";
import { useLanguage } from "~/lib/i18n";
import { NoticeConsentOptIn } from "~/components/noticeConsent";

type Phase = "form" | "confirm" | "done";

/**
 * Peer-support queue entry (owner bug 2026-09-08: "queue doesn't open").
 *
 * Roster admins (Jenn + Bambi) get an "Open peer-support queue" card linking to
 * /peer-support-queue?phone=<on-device phone>; everyone else sees the calm line
 * "The queue is for the MPRCC outreach team only." with NO link. Membership is
 * checked on-device by last-10-digit match against the two admin keys (the same
 * normalization the server gate uses), but the queue page itself stays gated
 * server-side via isRosterAdmin — this link exposes no queue data.
 *
 * Client-safe on purpose: this must NOT import ~/lib/pushServer or ~/db (those
 * pull pg into the browser bundle — 2026-09-08 P0 lesson).
 */
/* Jenn (4158797940) + Bambi (4155249090) — last-10-digit keys, matching the
 * server gate's phoneKey() normalization. The queue page itself re-checks
 * server-side; this is only which entry hint to render. */
const ADMIN_PHONE_KEYS = ["4158797940", "4155249090"];
function QueueEntry({ phone }: { phone: string }) {
  const { t } = useLanguage();
  const digits = normPhone(phone);
  const key = digits.slice(-10);
  const isAdmin = digits.length >= 10 && ADMIN_PHONE_KEYS.includes(key);
  if (!isAdmin || digits.length < 10) {
    return (
      <p className="text-center text-small text-sg-ink-soft">
        {t("ps_queue_only")}
      </p>
    );
  }
  return (
    <Card>
      <p className="text-body font-medium">{t("ps_queue_title")}</p>
      <p className="mt-0.5 text-small text-sg-ink-soft">{t("ps_queue_body")}</p>
      <div className="mt-3">
        <a href={`/peer-support-queue?phone=${encodeURIComponent(digits)}`}>
          <Button variant="secondary" full>{t("ps_queue_open")}</Button>
        </a>
      </div>
    </Card>
  );
}

function RequestSupportPage() {
  const { t } = useLanguage();
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [nameInput, setNameInput] = useState(identity?.name === "Neighbor" ? "" : (identity?.name ?? ""));
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamNotified, setTeamNotified] = useState(true);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const phoneOk = phoneLooksOk(phoneInput);

  const doSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/peer-support/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: phoneInput,
          name: nameInput.trim(),
          note: note.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        teamNotified?: boolean;
      } | null;
      if (res.ok && data?.ok) {
        setAlertIdentity(phoneInput, nameInput || identity?.name || "Neighbor");
        // 3-mode nav v1 fallback (spec §10.2): no peer-status read endpoint
        // exists, so the done screen stamps a local receipt the /requests
        // page shows. Local only — never sent, never logged.
        try {
          localStorage.setItem(
            "sg.peer_receipt",
            JSON.stringify({ at: new Date().toISOString(), note: note.trim().slice(0, 500) }),
          );
        } catch {
          /* private mode — receipt just won't show */
        }
        setTeamNotified(data.teamNotified !== false);
        setPhase("done");
      } else {
        setError(
          data?.error ?? "That didn't go through — nothing was sent. No rush to try again.",
        );
        setPhase("form");
      }
    } catch {
      setError("No connection right now — nothing was sent. Your words are still here when you're back.");
      setPhase("form");
    } finally {
      setSending(false);
    }
  };

  /* ---- Done: calm confirmation (not just a toast) ---- */
  if (phase === "done") {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-4 px-4 pt-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sg-sage-wash text-sg-sage" aria-hidden>
            <CheckCircleIcon size={32} />
          </span>
          <h1 className="text-h1">{t("ps_done")}</h1>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {teamNotified
              ? t("ps_done_a")
              : t("ps_done_b")}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <NoticeConsentOptIn phone={phoneInput} source="peer-support" />
            <Link to="/" className="block w-full">
              <Button full>{t("ps_home")}</Button>
            </Link>
            <Link to="/requests" className="block w-full">
              <Button variant="secondary" full>{t("nav_nb_requests")}</Button>
            </Link>
          </div>
          <p className="text-small text-sg-ink-soft">
            {t("ps_done_privacy")}
          </p>
          <div className="mt-2 w-full max-w-xs">
            <QueueEntry phone={phoneInput} />
          </div>
        </div>
      </AppShell>
    );
  }

  /* ---- Confirm: one more calm breath before anything is sent ---- */
  if (phase === "confirm") {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">{t("ps_ready")}</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("ps_ready_sub")}</p>
          </header>
          <Card>
            <dl className="flex flex-col gap-2 text-body">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{t("ps_call")}</dt>
                <dd>{formatPhone(phoneInput)}</dd>
              </div>
              {nameInput.trim() ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">{t("ps_yourname")}</dt>
                  <dd>{nameInput.trim().slice(0, 40)}</dd>
                </div>
              ) : null}
              {note.trim() ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">{t("ps_yournote")}</dt>
                  <dd className="min-w-0 flex-1 break-words text-sg-ink-soft">{note.trim().slice(0, 500)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-small text-sg-ink-soft">
              {t("ps_scope")}
            </p>
          </Card>
          <div className="flex flex-col gap-2">
            <Button full disabled={sending} aria-busy={sending} onClick={() => void doSend()}>
              {sending ? "Sending…" : t("ps_yes")}
            </Button>
            <Button variant="quiet" full onClick={() => setPhase("form")}>
              {t("ps_notyet")}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  /* ---- Form: the one-tap entry (phone confirm + optional note) ---- */
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("ps_title")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            {t("ps_sub")}
          </p>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <TextField
              label={t("ps_phone")}
              helper={t("ps_phone_help")}
              value={phoneInput}
              onChange={(e) => setPhoneInput(normPhone(e.target.value))}
              placeholder="e.g. 415 555-0142"
              inputMode="tel"
              error={phoneInput.length > 0 && !phoneOk ? t("ps_phone_bad") : undefined}
            />
            <TextField
              label={t("ps_name")}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("ps_name_ph")}
              maxLength={40}
            />
            <TextArea
              label={t("ps_note")}
              helper={t("ps_note_help")}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("ps_note_ph")}
            />
          </div>
        </Card>

        <ConsentReceipt
          who={t("ps_who")}
          what={t("ps_what")}
          howLong={t("ps_how")}
          stopLabel={t("ps_stop")}
        />

        {error ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          full
          aria-busy={sending}
          disabled={!phoneOk || sending}
          disabledReason={!phoneOk ? t("ps_need_phone") : undefined}
          onClick={() => setPhase("confirm")}
        >
          {t("ps_submit")}
        </Button>

        <button
          type="button"
          onClick={() => setCrisisOpen(true)}
          className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2"
        >
          {t("crisis_title")}
        </button>
        <QueueEntry phone={phoneInput} />
      </div>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/peer-support")({ component: RequestSupportPage });
