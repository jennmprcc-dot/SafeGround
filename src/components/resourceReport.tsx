/**
 * ResourceReportForm (PR-C, owner-directed 2026-09-11) — the anonymous
 * "Something wrong? Report a change" flow for a resource listing.
 *
 * Trauma-informed copy: calm, no urgency, no blame. Anonymous-first: the
 * phone is OPTIONAL (only for follow-up); the note is the report. On success
 * the form swaps to a quiet confirmation — the listing is NOT changed by the
 * report (honest copy), the team reviews it.
 */
import { useState } from "react";
import { Button, TextArea, TextField } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";

export type ResourceReportReason = "closed" | "wrong_info" | "hours_changed" | "other";

const REASONS: ResourceReportReason[] = ["closed", "wrong_info", "hours_changed", "other"];
const REASON_KEY: Record<ResourceReportReason, "rv_reason_closed" | "rv_reason_wrong_info" | "rv_reason_hours" | "rv_reason_other"> = {
  closed: "rv_reason_closed",
  wrong_info: "rv_reason_wrong_info",
  hours_changed: "rv_reason_hours",
  other: "rv_reason_other",
};

const phoneDigits = (raw: string): string => String(raw ?? "").replace(/[^0-9]/g, "");

export function ResourceReportForm({
  resourceId,
  onCancel,
}: {
  resourceId: string;
  /** Collapse the form without reporting (Never mind). */
  onCancel?: () => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<ResourceReportReason | "">("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<"rv_reason_bad" | "rv_note_bad" | "rv_phone_bad" | "rv_error" | "rv_too_many" | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-[14px] border border-sg-sage bg-sg-sage-wash p-4">
        <p className="text-body font-semibold text-sg-sage-deep">{t("rv_done")}</p>
        <p className="text-small text-sg-ink-soft">{t("rv_done_sub")}</p>
      </div>
    );
  }

  const submit = async () => {
    setErrorKey(null);
    const reasonOk = REASONS.includes(reason as ResourceReportReason);
    if (!reasonOk) {
      setErrorKey("rv_reason_bad");
      return;
    }
    const noteTrimmed = note.replace(/\s+/g, " ").trim();
    if (noteTrimmed.length < 1) {
      setErrorKey("rv_note_bad");
      return;
    }
    const phoneTrimmed = phone.trim();
    const digits = phoneDigits(phoneTrimmed);
    if (phoneTrimmed && (digits.length < 7 || digits.length > 15)) {
      setErrorKey("rv_phone_bad");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/resources/report-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId, reason, note: noteTrimmed, phone: phoneTrimmed || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setDone(true);
        return;
      }
      setErrorKey(res.status === 429 ? "rv_too_many" : "rv_error");
    } catch {
      setErrorKey("rv_error");
    } finally {
      setBusy(false);
    }
  };

  const reasonError = errorKey === "rv_reason_bad" ? t("rv_reason_bad") : undefined;
  const noteError = errorKey === "rv_note_bad" ? t("rv_note_bad") : undefined;
  const phoneError = errorKey === "rv_phone_bad" ? t("rv_phone_bad") : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-sg-ink-soft">{t("rv_body")}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-btn font-medium">{t("rv_reason_label")}</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ResourceReportReason)}
          aria-invalid={reasonError ? true : undefined}
          className={`min-h-[52px] w-full rounded-[12px] border-2 bg-sg-card px-4 text-body text-sg-ink outline-none transition-colors focus:border-sg-ink ${
            reasonError ? "border-sg-danger-gentle" : "border-sg-line"
          }`}
        >
          <option value="" disabled>
            {t("rv_reason_label")}…
          </option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(REASON_KEY[r])}
            </option>
          ))}
        </select>
        {reasonError ? <p className="text-small text-sg-danger-gentle">{reasonError}</p> : null}
      </label>
      <TextArea
        label={t("rv_note_label")}
        placeholder={t("rv_note_ph")}
        helper={t("rv_note_help")}
        error={noteError}
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        maxLength={500}
        rows={3}
      />
      <TextField
        label={t("rv_phone_label")}
        helper={t("rv_phone_help")}
        error={phoneError}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="415 555-0142"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
      />
      {errorKey === "rv_error" || errorKey === "rv_too_many" ? (
        <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      <Button full disabled={busy} onClick={() => void submit()}>
        {t("rv_submit")}
      </Button>
      <Button variant="text" full disabled={busy} onClick={onCancel}>
        {t("rv_cancel")}
      </Button>
    </div>
  );
}