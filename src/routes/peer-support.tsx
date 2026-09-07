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
  phoneLooksOk,
  setAlertIdentity,
} from "~/lib/alertIdentity";
import { CheckCircleIcon } from "~/lib/icons";

type Phase = "form" | "confirm" | "done";

function RequestSupportPage() {
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
          <h1 className="text-h1">An MPRCC peer will reach out. We&apos;re here.</h1>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {teamNotified
              ? "The outreach team has your request and will contact you at the number you gave."
              : "Your request is in the team's queue — a peer will follow up as soon as they're connected."}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <Link to="/" className="block w-full">
              <Button full>Back home</Button>
            </Link>
          </div>
          <p className="text-small text-sg-ink-soft">
            This stays between you and the MPRCC outreach team — never 911, never anyone else.
          </p>
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
            <h1 className="text-h1">Ready to send?</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">Nothing has gone anywhere yet — this is still yours.</p>
          </header>
          <Card>
            <dl className="flex flex-col gap-2 text-body">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">They&apos;ll call</dt>
                <dd>{formatPhone(phoneInput)}</dd>
              </div>
              {nameInput.trim() ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Your name</dt>
                  <dd>{nameInput.trim().slice(0, 40)}</dd>
                </div>
              ) : null}
              {note.trim() ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Your note</dt>
                  <dd className="min-w-0 flex-1 break-words text-sg-ink-soft">{note.trim().slice(0, 500)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-small text-sg-ink-soft">
              Goes only to Jenn + Bambi on the MPRCC outreach team. Never 911, never anyone else.
            </p>
          </Card>
          <div className="flex flex-col gap-2">
            <Button full disabled={sending} onClick={() => void doSend()}>
              {sending ? "Sending…" : "Yes — ask for a peer"}
            </Button>
            <Button variant="quiet" full onClick={() => setPhase("form")}>
              Not yet — let me change something
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
          <h1 className="text-h1">Request peer support</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            One tap asks an MPRCC peer to reach out. Never calls 911.
          </p>
        </header>

        <Card>
          <div className="flex flex-col gap-4">
            <TextField
              label="Your phone number"
              helper="So a peer can reach you back. Stays on this device + the team's queue."
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="e.g. 415 555-0142"
              inputMode="tel"
              error={phoneInput.length > 0 && !phoneOk ? "That number looks incomplete — please check it, no rush." : undefined}
            />
            <TextField
              label="Your first name (optional)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Sam"
              maxLength={40}
            />
            <TextArea
              label="Anything you'd like them to know? (optional)"
              helper="Up to 500 characters — only the outreach team sees this"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Evenings are best, I'm near the library…"
            />
          </div>
        </Card>

        <ConsentReceipt
          who="Jenn + Bambi, MPRCC peer outreach — the only two people notified"
          what="Your phone, your name if you gave one, and your note"
          howLong="It stays in the team's queue until it's marked done"
          stopLabel="Nothing is shared until you tap below"
        />

        {error ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          full
          disabled={!phoneOk || sending}
          disabledReason={!phoneOk ? "A complete phone number first — no rush." : undefined}
          onClick={() => setPhase("confirm")}
        >
          Request peer support
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

export const Route = createFileRoute("/peer-support")({ component: RequestSupportPage });
