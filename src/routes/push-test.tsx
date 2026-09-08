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
 *
 * EN|ES (owner P0 defect 5) — all user-facing strings via t().
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, TextField, useToasts } from "~/components/ui";
import { fetchPushConfig, pushSupported, registerDevicePush } from "~/lib/fcm";
import { normPhone } from "~/lib/alertIdentity";
import { useLanguage } from "~/lib/i18n";

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
  const { t } = useLanguage();
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
      setMessage(t("pt_fail_generic"));
      setFailDetail(e instanceof Error ? e.message : t("pt_fail_generic"));
      setStep("idle");
      push({ kind: "error", message: t("pt_reg_fail") });
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
            ? t("pt_body_dry")
            : t("pt_body_real"),
          validateOnly,
        }),
      });
      const json = (await res.json()) as SendResult;
      setResult(json);
      const ok = json.ok === true;
      // Honest failure copy: per-token detail (results[].detail) is the source
      // of truth — the corrupt-key case reads clearly instead of a blank fail.
      if (ok) {
        setMessage(t("pt_handed"));
      } else {
        const detail = json.results?.find((r) => r.status === "error")?.detail ?? json.error;
        const countLine = `sent: ${json.sent ?? 0}, unregistered: ${json.unregistered ?? 0}`;
        const shown = json.results?.length
          ? `${detail ?? t("pt_fail_generic")} (${countLine})`
          : (detail ?? t("pt_fail_generic"));
        setMessage(
          /key is corrupt/i.test(shown)
            ? t("pt_corrupt")
            : shown,
        );
        setFailDetail(shown);
      }
      push({ kind: ok ? "success" : "error", message: ok ? t("pt_sent_toast") : t("pt_fail_toast") });
      setStep("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("pt_fail_generic"));
      setFailDetail(e instanceof Error ? e.message : t("pt_fail_generic"));
      setStep("registered");
    }
  }

  const supported = pushSupported();

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-6">
        <header>
          <h1 className="text-h2">{t("pt_title")}</h1>
          <p className="mt-1 text-body text-sg-ink-soft">
            {t("pt_sub")}
          </p>
        </header>

        {!supported && (
          <Card>
            <h2 className="text-h2">{t("pt_install_title")}</h2>
            <p className="mt-2 text-body text-sg-ink-soft">
              {t("pt_install_body")}
            </p>
          </Card>
        )}

        <Card>
          <h2 className="text-h2">{t("pt_s1_title")}</h2>
          <p className="mt-2 text-body text-sg-ink-soft">
            {t("pt_s1_body")}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <TextField label={t("pt_phone")} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="4155551234" inputMode="tel" />
            <TextField label={t("pt_label")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("pt_label_ph")} />
            <Button full disabledReason={canRegister ? undefined : t("pt_need_phone")} onClick={handleRegister}>
              {step === "registering" ? t("pt_requesting") : t("pt_allow")}
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
              {t("pt_not_configured")}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="text-h2">{t("pt_s2_title")}</h2>
          <p className="mt-2 text-body text-sg-ink-soft">
            {t("pt_s2_body")}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              full
              disabledReason={canSend ? undefined : t("pt_need_allow")}
              onClick={() => sendTest(false)}
            >
              {step === "sending" ? t("pt_sending") : t("pt_send")}
            </Button>
            <Button variant="quiet" full disabledReason={canSend ? undefined : t("pt_need_allow")} onClick={() => sendTest(true)}>
              {t("pt_dry")}
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
          <p>{t("pt_footer")}</p>
        </footer>
      </div>
    </AppShell>
  );
}
export const Route = createFileRoute("/push-test")({ component: PushTestPage });
