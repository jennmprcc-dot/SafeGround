/**
 * Push wiring self-test page (owner + staff only, consent-first).
 *
 * Two calm steps:
 *  1. Register this phone for notifications (Allow → token → stored server-side)
 *  2. "Send me a test notification" → /api/push/send to THIS phone only.
 * Plus a "Check wiring" dry-run that validates the full auth chain with FCM
 * validate_only (no delivery) — useful before the real phone test.
 *
 * When the send fails, the FIRST result's detail (results[].detail — the
 * per-token truth from PR #21) is shown PROMINENTLY with the count pattern
 * ("sent: 0, unregistered: 0") so the owner sees the actual reason on screen,
 * e.g. the corrupt Firebase service-account key.
 *
 * iOS Safari: web push only works after Add to Home Screen (the app icon) —
 * the page explains this. Never touches 911/agencies; sends are server-gated
 * to the caller's own phone. Emergency alerts stay as they are — this page is
 * a consent-first diagnostic for the dispatch channel itself.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, TextField, useToasts } from "~/components/ui";
import { fetchPushConfig, pushSupported, registerDevicePush } from "~/lib/fcm";
import { normPhone } from "~/lib/alertIdentity";

type Step = "idle" | "registering" | "registered" | "sending" | "done";

/** The send result the page actually needs — parsed from /api/push/send. */
interface SendResult {
  ok?: boolean;
  error?: string;
  sent?: number;
  unregistered?: number;
  results?: Array<{ status: string; detail?: string }>;
}

function PushTestPage() {
  const { push } = useToasts();
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [failDetail, setFailDetail] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const cleanPhone = normPhone(phone);
  const canRegister = cleanPhone.length >= 10;
  const canSend = step === "registered" || step === "done";

  async function handleRegister() {
    if (!canRegister) return;
    setStep("registering");
    setResult(null);
    setFailDetail(null);
    try {
      const status = await registerDevicePush(cleanPhone, label.trim() || undefined);
      setConfigured((await fetchPushConfig()).configured);
      // Honest empty-token reason (backlog fe17dcaf): the iOS worker may still
      // be starting — say what's happening instead of a vague failure.
      setMessage(status.message);
      setFailDetail(status.emptyTokenReason ?? null);
      setStep(status.registered ? "registered" : "idle");
      push({
        kind: status.registered ? "success" : "info",
        message: status.message,
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Registration failed.");
      setFailDetail(e instanceof Error ? e.message : "Registration failed.");
      setStep("idle");
      push({ kind: "error", message: "Registration didn't complete — see the note below." });
    }
  }

  async function sendTest(validateOnly: boolean) {
    if (!canSend || !cleanPhone) return;
    setStep("sending");
    setResult(null);
    setMessage("");
    setFailDetail(null);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": cleanPhone },
        body: JSON.stringify({
          phone: cleanPhone,
          title: "SafeGround test",
          body: validateOnly
            ? "Wiring check — this is not delivered."
            : "It's you. This is a SafeGround test notification from this phone.",
          validateOnly,
        }),
      });
      const json = (await res.json()) as SendResult;
      setResult(json);
      const ok = json.ok === true;
      // Honest failure copy: per-token detail (results[].detail) is the source
      // of truth — the corrupt-key case reads clearly instead of a blank fail.
      if (ok) {
        setMessage("The notification was handed to FCM — it should appear on this device now.");
      } else {
        const detail = json.results?.find((r) => r.status === "error")?.detail ?? json.error;
        const countLine = `sent: ${json.sent ?? 0}, unregistered: ${json.unregistered ?? 0}`;
        const shown = json.results?.length
          ? `${detail ?? "The send didn't complete."} (${countLine})`
          : (detail ?? "The send didn't complete.");
        setMessage(
          /key is corrupt/i.test(shown)
            ? "The Firebase service-account key is corrupt — an admin needs to re-save it in Settings, then try again."
            : shown,
        );
        setFailDetail(shown);
      }
      push({ kind: ok ? "success" : "error", message: ok ? "Test notification sent." : "Test send failed — see the note." });
      setStep("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Send failed.");
      setFailDetail(e instanceof Error ? e.message : "Send failed.");
      setStep("registered");
    }
  }

  const supported = pushSupported();

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-6">
        <header>
          <h1 className="text-h2">Notifications test</h1>
          <p className="mt-1 text-body text-sg-ink-soft">
            This page is for the SafeGround team — it sends a push only to <em>this</em> phone, after you choose to allow it.
          </p>
        </header>

        {!supported && (
          <Card>
            <h2 className="text-h2">Install SafeGround first</h2>
            <p className="mt-2 text-body text-sg-ink-soft">
              On iPhone, Safari only allows web notifications after the app is added to the home screen. Open this site, tap the
              share button (⎋), choose <strong>Add to Home Screen</strong>, open SafeGround from your home screen, then come back here.
              On Android/Chrome, tap the install icon in the address bar.
            </p>
          </Card>
        )}

        <Card>
          <h2 className="text-h2">1 · Allow notifications for this phone</h2>
          <p className="mt-2 text-body text-sg-ink-soft">
            Your phone number is used only to know which device this is. Pressing Allow is the only consent — nothing is ever sent
            without it.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <TextField label="Phone (digits)" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="4155551234" inputMode="tel" />
            <TextField label="Device name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My phone" />
            <Button full disabledReason={canRegister ? undefined : "Enter a 10+ digit phone first"} onClick={handleRegister}>
              {step === "registering" ? "Requesting…" : "Allow notifications"}
            </Button>
          </div>
          {message && <p className="mt-3 text-small text-sg-ink-soft">{message}</p>}
          {failDetail && (
            <p className="mt-2 rounded-[12px] border border-sg-clay/40 bg-sg-clay-wash px-3 py-2 text-small font-medium text-sg-clay">
              {failDetail}
            </p>
          )}
          {configured === false && (
            <p className="mt-3 text-small text-sg-sky">
              Push isn't configured here (no Firebase keys in this environment) — this page works once the keys are set.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="text-h2">2 · Send me a test notification</h2>
          <p className="mt-2 text-body text-sg-ink-soft">
            Sends only to the phone above, from the server, through Firebase. It never contacts anyone else.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              full
              disabledReason={canSend ? undefined : "Allow notifications first (step 1)"}
              onClick={() => sendTest(false)}
            >
              {step === "sending" ? "Sending…" : "Send me a test notification"}
            </Button>
            <Button variant="quiet" full disabledReason={canSend ? undefined : "Allow notifications first (step 1)"} onClick={() => sendTest(true)}>
              Check wiring (dry-run — no delivery)
            </Button>
          </div>
          {message && <p className="mt-3 text-small text-sg-ink-soft">{message}</p>}
          {failDetail && (
            <p className="mt-2 rounded-[12px] border border-sg-clay/40 bg-sg-clay-wash px-3 py-2 text-small font-medium text-sg-clay" role="alert">
              {failDetail}
            </p>
          )}
          {result && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-[10px] bg-sg-paper p-3 text-[11px] leading-relaxed text-sg-ink-soft">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </Card>

        <footer className="pb-6 text-small text-sg-ink-soft">
          <p>No background location. No SMS. This test push goes to this phone only — the send route refuses anything else.</p>
        </footer>
      </div>
    </AppShell>
  );
}
export const Route = createFileRoute("/push-test")({ component: PushTestPage });