/**
 * Send an emergency alert (WAVE2_UX_SPEC §Emergency send flow) — 3-step sheet.
 * 1. Kind chips (single-select) + note ≤500 (n/500 count)
 * 2. Audience: friends + peers ALWAYS (locked, info-only); HomeTeam checkbox
 *    with dynamic business-hours line; consent receipt.
 * 3. Location none/fuzzed/exact — NEVER pre-selected; Send disabled until tapped.
 *    Exact double-confirm + "only the people you notify + MPRCC staff, disappears
 *    when the alert closes" line. Reassurance line: never calls 911.
 * Success view (not just toast): "Sent. Your people have it."
 *
 * Calm copy verbatim from spec; no WARNING/DANGER/URGENT/MISSING/siren.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { BottomSheet, Button, Card, ConsentReceipt, Dialog, TextArea, useToasts } from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { sendEmergencyAlert } from "~/lib/server";
import { getAlertIdentity, setAlertIdentity, phoneLooksOk, formatPhone } from "~/lib/alertIdentity";
import type { AlertKind, AlertLocation, AlertAudienceGroup, AlertSource } from "~/lib/alerts";
import { ALERT_LIFE_COPY } from "~/lib/alerts";
import { CheckCircleIcon } from "~/lib/icons";
import { NoticeConsentOptIn } from "~/components/noticeConsent";
import { cn } from "~/lib/cn";

/* ── Business-hours line (dynamic, Marin local) ────────────────────
 * Refreshes on mount/visibility: "HomeTeam sees this during business hours
 * Mon–Fri 8–6 unless they've opted in." When now is outside or a weekend,
 * the line explains the supporters won't see it until the window opens. */
function businessHoursLine(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;
  const inHours = ["Sat", "Sun"].includes(weekday) === false && minutes >= 8 * 60 && minutes < 18 * 60;
  if (inHours) return "HomeTeam sees this during business hours Mon–Fri 8–6 — right now, they will.";
  return "HomeTeam sees this during business hours Mon–Fri 8–6 unless they've opted in.";
}

/* ── Step 1: kind chips + note ───────────────────────────────────── */
function KindStep({ kind, setKind, note, setNote, onNext }: {
  kind: AlertKind | null;
  setKind: (k: AlertKind) => void;
  note: string;
  setNote: (n: string) => void;
  onNext: () => void;
}) {
  const options: Array<{ value: AlertKind; label: string; blurb: string }> = [
    { value: "unsafe_place", label: "Unsafe place", blurb: "A place feels unsafe right now" },
    { value: "police_nearby", label: "Police nearby", blurb: "Police are nearby and it matters" },
    { value: "help_needed", label: "Help needed (not police)", blurb: "Would like a hand — not police" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-btn font-medium">What's going on?</legend>
        {options.map((o) => {
          const on = kind === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => setKind(o.value)}
              className={cn(
                "flex min-h-[56px] items-center gap-3 rounded-[12px] border-2 px-3 text-left transition-colors",
                on ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink hover:bg-sg-paper",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-current text-[13px] font-bold" aria-hidden>
                {on ? "✓" : ""}
              </span>
              <span>
                <span className="block text-body font-medium">{o.label}</span>
                <span className="block text-small text-sg-ink-soft">{o.blurb}</span>
              </span>
            </button>
          );
        })}
      </fieldset>
      <TextArea
        label="A short note (optional)"
        helper="What would help your people know — up to 500 characters"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. The bench by the library, phone at 8%…"
      />
      <Button full disabled={!kind} disabledReason={kind ? undefined : "Choose one first — no rush."} onClick={onNext}>
        Continue
      </Button>
    </div>
  );
}

/* ── Step 2: audience + consent receipt ─────────────────────────── */
function AudienceStep({ hometeam, setHometeam, onNext, onBack }: {
  hometeam: boolean;
  setHometeam: (b: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const bizLine = useMemo(() => businessHoursLine(), []);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-sg-ink-soft">Friends + peers are always included — you can't send to no one.</p>
      <div className="flex flex-col gap-2" role="list" aria-label="Who sees this">
        <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-sage/40 bg-sg-sage-wash/40 px-3 opacity-90">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sg-sage text-white">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
          </span>
          <span className="text-body">
            Your friends &amp; peers
            <span className="block text-small text-sg-ink-soft">always on — the people you already check in with</span>
          </span>
        </label>
        <label
          className={cn(
            "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 px-3 transition-colors",
            hometeam ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink",
          )}
        >
          <input
            type="checkbox"
            checked={hometeam}
            onChange={(e) => setHometeam(e.target.checked)}
            className="h-6 w-6 shrink-0 accent-sg-sage"
          />
          <span className="text-body">
            HomeTeam supporters
            <span className="block text-small text-sg-ink-soft">{bizLine}</span>
          </span>
        </label>
      </div>

      <ConsentReceipt
        who="Your friends + peers (always) · HomeTeam if you tick it"
        what="Your kind, your note, and the location you choose"
        howLong={ALERT_LIFE_COPY}
        stopLabel="You clear it with “I'm OK”"
      />

      <Button full onClick={onNext}>
        Continue
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

/* ── Step 3: location — NEVER pre-selected ──────────────────────── */
function LocationStep({ location, setLocation, onSend, onBack, sending, exactConfirmOpen, setExactConfirmOpen, exactReady }: {
  location: AlertLocation | null;
  setLocation: (l: AlertLocation) => void;
  onSend: () => void;
  onBack: () => void;
  sending: boolean;
  exactConfirmOpen: boolean;
  setExactConfirmOpen: (b: boolean) => void;
  exactReady: boolean;
}) {
  const options: Array<{ value: AlertLocation; label: string; blurb: string }> = [
    { value: "none", label: "No location", blurb: "Just the words" },
    { value: "fuzzed", label: "Approximate area (~150m)", blurb: "A rough circle, not the exact spot" },
    { value: "exact", label: "Exact spot", blurb: "Only your notified people + staff" },
  ];
  return (
    <>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-btn font-medium">How much location do your people have?</legend>
          {options.map((o) => {
            const on = location === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => setLocation(o.value)}
                className={cn(
                  "flex min-h-[56px] items-center gap-3 rounded-[12px] border-2 px-3 text-left transition-colors",
                  on ? "border-sg-sage bg-sg-sage-wash text-sg-sage-deep" : "border-sg-line bg-sg-card text-sg-ink hover:bg-sg-paper",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-current" aria-hidden>
                  {on ? <span className="h-2.5 w-2.5 rounded-full bg-current" /> : null}
                </span>
                <span>
                  <span className="block text-body font-medium">{o.label}</span>
                  <span className="block text-small text-sg-ink-soft">{o.blurb}</span>
                </span>
              </button>
            );
          })}
        </fieldset>

        <p className="text-small text-sg-ink-soft">
          Never calls 911 or any agency — help comes from your people unless you ask for more.
        </p>

        <Button
          full
          disabled={!location}
          disabledReason={location ? undefined : "Choose one first — nothing is chosen until you tap it."}
          onClick={() => {
            if (location === "exact") {
              setExactConfirmOpen(true);
            } else {
              onSend();
            }
          }}
        >
          {sending ? "Sending…" : "Send to my people"}
        </Button>
        <Button variant="quiet" full onClick={onBack}>
          Back
        </Button>
      </div>

      <Dialog
        open={exactConfirmOpen}
        title="Share your exact spot?"
        confirmLabel="Yes — share exact"
        onConfirm={() => {
          setExactConfirmOpen(false);
          onSend();
        }}
        onClose={() => setExactConfirmOpen(false)}
      >
        <p>
          Exact means {exactReady ? "your notified people + outreach staff" : "your notified people + MPRCC staff"} see your spot
          until this closes. Nobody else — and it disappears when the alert closes.
        </p>
        <p className="mt-2 text-small text-sg-ink-soft">
          Never calls 911 or any agency — help comes from your people unless you ask for more.
        </p>
      </Dialog>
    </>
  );
}

/* ── Send page ──────────────────────────────────────────────────── */
function SendAlertPage() {
  const { signedIn, displayName, signIn } = useAuth();
  const { push } = useToasts();

  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<AlertKind | null>(null);
  const [note, setNote] = useState("");
  const [hometeam, setHometeam] = useState(false);
  const [location, setLocation] = useState<AlertLocation | null>(null);
  const [exactConfirmOpen, setExactConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ id: string; source: AlertSource } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [crisisOpen, setCrisisOpen] = useState(false);

  const identity = getAlertIdentity();

  useEffect(() => {
    if (identity) {
      setPhoneInput(identity.phone);
      setNameInput(identity.name);
    }
  }, [identity]);

  const phoneOk = phoneLooksOk(phoneInput);
  const needsIdentity = !identity || !phoneOk;

  const doSend = async () => {
    if (!kind || !location) return;
    setSending(true);
    setError(null);
    let fuzzLat: number | null = null;
    let fuzzLng: number | null = null;
    let exactLat: number | null = null;
    let exactLng: number | null = null;

    if (location === "fuzzed" || location === "exact") {
      // The SEPARATE fuzz point the sender chose (server fuzzes exact internally;
      // we never send exact unless location === "exact").
      // REAL location only: a single one-time device read, user-initiated for
      // this alert. No stored fallback, no invented point — if the read fails,
      // the location choice can't be honored and the sender sees a calm error.
      let p: { lat: number; lng: number } | null = null;
      try {
        p = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
          if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            reject(new Error("no geolocation"));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => reject(new Error("denied")),
            { maximumAge: 0, timeout: 8000 },
          );
        });
      } catch {
        setError("Couldn't read your location — pick “No location” to send with words only, or try again when you can.");
        setSending(false);
        return;
      }
      if (location === "exact") {
        exactLat = p.lat;
        exactLng = p.lng;
      } else {
        fuzzLat = p.lat;
        fuzzLng = p.lng;
      }
    }

    const audience: AlertAudienceGroup[] = ["friends", "peers"];
    if (hometeam) audience.push("hometeam");

    const res = await sendEmergencyAlert({
      data: {
        senderPhone: phoneInput,
        kind,
        note,
        location,
        fuzzLat,
        fuzzLng,
        exactLat,
        exactLng,
        audience,
      },
    });
    setSending(false);
    if (res.ok) {
      // The success view IS the persistent confirmation (owner-directed) —
      // it stays on screen, no short-lived toast. "Notified" copy: this path
      // queues the alert for the audience; the push channel reaches the team /
      // HomeTeam when configured, so the honest line is "Sent. Your people
      // have it." — the existing success view already carries it.
      setSent({ id: res.alertId ?? "", source: res.source });
    } else {
      setError(res.error ?? "That didn't go through — nothing was sent. No rush to try again.");
    }
  };

  /* ---- Signed-out gate (phone + name, same as Check-Ins sign-in shape) ---- */
  if (!signedIn) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">Get help from my people</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">A one-tap heads-up to the people you trust. Never calls 911.</p>
          </header>
          <Card>
            <h2 className="text-h2">Tell us who you are</h2>
            <p className="mt-1 text-small text-sg-ink-soft">
              Your name isn't shown anywhere — your people just need to know it's you. Same phone you check in with.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-btn font-medium">Your first name</span>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your first name"
                  className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-btn font-medium">Your phone number</span>
                <input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="e.g. 415 555-0142"
                  inputMode="tel"
                  className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
                {phoneInput.length > 0 && !phoneOk ? (
                  <p className="text-small text-sg-danger-gentle">That number looks incomplete — please check it and try again, no rush.</p>
                ) : null}
              </label>
              <p className="text-small text-sg-ink-soft">Stays on this device. Your people see the name + the alert, never your number.</p>
              <Button
                full
                disabled={!phoneOk || nameInput.trim().length === 0 || nameInput.trim().length > 40}
                disabledReason={!phoneOk ? "A complete phone number first — no rush." : undefined}
                onClick={() => {
                  setAlertIdentity(phoneInput, nameInput);
                  signIn(nameInput.trim());
                  push({ kind: "info", message: "Signed in — your people will know it's you." });
                }}
              >
                Continue
              </Button>
            </div>
          </Card>
          <button type="button" onClick={() => setCrisisOpen(true)} className="self-start text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center">
            Talk to someone
          </button>
        </div>
        <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
      </AppShell>
    );
  }

  /* ---- Success view (not just a toast) ---- */
  if (sent) {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-4 px-4 pt-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sg-sage-wash text-sg-sage" aria-hidden>
            <CheckCircleIcon size={32} />
          </span>
          <h1 className="text-h1">Sent. Your people have it.</h1>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {sent.source === "demo"
              ? "Demo draft kept here — will sync when the connection returns."
              : "They'll see it in their alerts. You can clear it anytime you're okay."}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <NoticeConsentOptIn phone={getAlertIdentity()?.phone ?? ""} source="alert-sent" />
            <Link to="/alerts/mine" className="block w-full">
              <Button full>See my alert</Button>
            </Link>
            <Link to="/alerts" className="block w-full">
              <Button variant="secondary" full>I'm OK — all clear</Button>
            </Link>
          </div>
          <p className="text-small text-sg-ink-soft">Never calls 911 or any agency — help comes from your people unless you ask for more.</p>
        </div>
      </AppShell>
    );
  }

  /* ---- The 3-step sheet ---- */
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Get help from my people</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">A one-tap heads-up to the people you trust. Never calls 911.</p>
        </header>

        {needsIdentity ? (
          <Card>
            <h2 className="text-h2">Your number, so your people know it's you</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-btn font-medium">Your phone number</span>
                <input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="e.g. 415 555-0142"
                  inputMode="tel"
                  className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
                {phoneInput.length > 0 && !phoneOk ? (
                  <p className="text-small text-sg-danger-gentle">That number looks incomplete — please check it and try again, no rush.</p>
                ) : null}
              </label>
              <Button full disabled={!phoneOk} onClick={() => { setAlertIdentity(phoneInput, nameInput || displayName); push({ kind: "info", message: "Number saved on this device." }); }}>
                Save &amp; continue
              </Button>
            </div>
          </Card>
        ) : (
          <BottomSheet open title="Send to your people" peek={false} onClose={() => undefined}>
            <div className="flex flex-col gap-4 pb-2">
              <p className="text-small text-sg-ink-soft">Step {step} of 3 — no rush, every choice is yours.</p>

              {step === 1 && (
                <KindStep kind={kind} setKind={setKind} note={note} setNote={setNote} onNext={() => setStep(2)} />
              )}
              {step === 2 && (
                <AudienceStep
                  hometeam={hometeam}
                  setHometeam={setHometeam}
                  onNext={() => setStep(3)}
                  onBack={() => setStep(1)}
                />
              )}
              {step === 3 && (
                <LocationStep
                  location={location}
                  setLocation={setLocation}
                  onSend={() => void doSend()}
                  onBack={() => setStep(2)}
                  sending={sending}
                  exactConfirmOpen={exactConfirmOpen}
                  setExactConfirmOpen={setExactConfirmOpen}
                  exactReady={hometeam}
                />
              )}

              {error ? (
                <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay">{error}</p>
              ) : null}
            </div>
          </BottomSheet>
        )}

        <p className="text-small text-sg-ink-soft">
          {identity ? `Sending as ${identity.name} (${formatPhone(identity.phone)})` : ""}
        </p>
      </div>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/alerts/new")({ component: SendAlertPage });