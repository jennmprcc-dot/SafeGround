/**
 * SMS dispatch team — admin-only card for the outreach Team tab
 * (owner-directed 2026-09-10).
 *
 * Lists staff_sms_recipients (name + MASKED phone + consent/STOP/active chips),
 * adds/replaces a peer supporter (upsert by last-10 digits), and soft-removes
 * one (active=false — row kept for STOP integrity). Rendered only inside the
 * outreach dashboard's admin-gated Team section (Tracey/staff_limited never
 * see this component), and the API enforces the same gate server-side.
 *
 * Privacy floor: the API never returns full phone numbers — the UI only ever
 * renders the masked form it is given. Reply STOP always wins: a stopped
 * recipient shows the STOP chip and CANNOT be texted (re-adding does not clear
 * sms_unsubscribed; the API keeps it sticky).
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";

interface Recipient {
  id: string;
  name: string;
  maskedPhone: string;
  phoneTail: string;
  smsConsent: boolean;
  afterHours: boolean;
  smsUnsubscribed: boolean;
  active: boolean;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; recipients: Recipient[] }
  | { kind: "error"; message: string };

function Chip({ tone, children }: { tone: "sage" | "gold" | "clay" | "line"; children: string }) {
  const tones: Record<string, string> = {
    sage: "bg-sg-sage-wash text-sg-sage",
    gold: "bg-sg-gold-wash text-[#6B5212]",
    clay: "bg-sg-clay-wash text-sg-clay",
    line: "bg-sg-line text-sg-ink-soft",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-badge uppercase tracking-[0.04em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StaffSmsTeam({ phone }: { phone: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(true);
  const [afterHours, setAfterHours] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; line: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/staff-sms?phone=${encodeURIComponent(phone)}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; recipients?: Recipient[]; error?: string } | null;
      if (res.ok && data?.ok) {
        setState({ kind: "ready", recipients: Array.isArray(data.recipients) ? data.recipients : [] });
      } else {
        setState({ kind: "error", message: data?.error ?? "Couldn't load the dispatch list — try again in a moment." });
      }
    } catch {
      setState({ kind: "error", message: "No connection right now — the dispatch list will be here when you're back." });
    }
  }, [phone]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const digits = newPhone.replace(/[^0-9]/g, "");
    if (digits.length < 10) {
      setFeedback({ kind: "error", line: "A complete 10–11 digit phone number first — no rush." });
      return;
    }
    if (!name.trim()) {
      setFeedback({ kind: "error", line: "Give the peer supporter a name so the list stays clear." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff-sms?phone=${encodeURIComponent(phone)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: digits, name: name.trim(), smsConsent, afterHours }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setName("");
        setNewPhone("");
        setFeedback({ kind: "ok", line: t("sms_team_added") });
        await load();
      } else {
        setFeedback({ kind: "error", line: data?.error ?? t("sms_team_error") });
      }
    } catch {
      setFeedback({ kind: "error", line: t("sms_team_error") });
    } finally {
      setBusy(false);
    }
  };

  const disable = async (id: string) => {
    setRemoving(id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff-sms?phone=${encodeURIComponent(phone)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, active: false }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setFeedback({ kind: "ok", line: t("sms_team_removed") });
        await load();
      } else {
        setFeedback({ kind: "error", line: data?.error ?? t("sms_team_error") });
      }
    } catch {
      setFeedback({ kind: "error", line: t("sms_team_error") });
    } finally {
      setRemoving(null);
    }
  };

  const disabled = state.kind !== "ready";

  return (
    <Card>
      <p className="text-body font-medium">{t("sms_team_title")}</p>
      <p className="mt-0.5 text-small text-sg-ink-soft">{t("sms_team_body")}</p>

      {/* Recipient list */}
      {state.kind === "loading" ? (
        <p className="mt-3 text-small text-sg-ink-soft">…</p>
      ) : state.kind === "error" ? (
        <p className="mt-3 rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
          {state.message}
        </p>
      ) : state.recipients.length === 0 ? (
        <p className="mt-3 text-small text-sg-ink-soft">{t("sms_team_none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" aria-label={t("sms_team_title")}>
          {state.recipients.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 rounded-[12px] border border-sg-line bg-sg-paper p-3">
              <div className="min-w-0">
                <p className="text-body font-medium">{r.name}</p>
                <p className="text-small text-sg-ink-soft">{r.maskedPhone}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.active ? (
                    <Chip tone="sage">{t("sms_chip_active")}</Chip>
                  ) : (
                    <Chip tone="line">{t("sms_chip_inactive")}</Chip>
                  )}
                  {r.smsConsent ? <Chip tone="sage">{t("sms_chip_consented")}</Chip> : null}
                  {r.afterHours ? <Chip tone="gold">{t("sms_chip_after_hours")}</Chip> : null}
                  {r.smsUnsubscribed ? <Chip tone="clay">{t("sms_chip_stopped")}</Chip> : null}
                </div>
                {r.smsUnsubscribed ? (
                  <p className="mt-1 text-small text-sg-ink-soft">{t("sms_stopped_note")}</p>
                ) : null}
              </div>
              {r.active ? (
                <Button
                  variant="quiet"
                  disabled={busy || removing === r.id}
                  onClick={() => void disable(r.id)}
                  className="shrink-0 px-2"
                >
                  {t("sms_remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <p className="text-btn font-medium">{t("sms_add_title")}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-sg-ink">{t("sms_add_name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("sms_add_name_ph")}
            maxLength={40}
            className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-sg-ink">{t("sms_add_phone")}</span>
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder={t("sms_add_phone_ph")}
            inputMode="tel"
            className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
          />
        </label>
        <label className="flex items-center gap-2.5 rounded-[12px] border border-sg-line bg-sg-paper p-3">
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            className="h-5 w-5 accent-sg-sage"
          />
          <span className="flex flex-col">
            <span className="text-body">{t("sms_add_consent")}</span>
            <span className="text-small text-sg-ink-soft">{t("sms_add_consent_sub")}</span>
          </span>
        </label>
        <label className="flex items-center gap-2.5 rounded-[12px] border border-sg-line bg-sg-paper p-3">
          <input
            type="checkbox"
            checked={afterHours}
            onChange={(e) => setAfterHours(e.target.checked)}
            className="h-5 w-5 accent-sg-sage"
          />
          <span className="flex flex-col">
            <span className="text-body">{t("sms_add_after_hours")}</span>
            <span className="text-small text-sg-ink-soft">{t("sms_add_after_hours_sub")}</span>
          </span>
        </label>
        {feedback ? (
          <p
            role="status"
            className={
              feedback.kind === "ok"
                ? "rounded-[12px] bg-sg-sage-wash px-3 py-2 text-small text-sg-sage-deep"
                : "rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay"
            }
          >
            {feedback.line}
          </p>
        ) : null}
        <Button full disabled={busy || disabled} type="submit">
          {t("sms_add_submit")}
        </Button>
      </form>
    </Card>
  );
}