/**
 * Pass 3 — Volunteer flow: the Give page's third card (owner-directed
 * 2026-09-12, Part B). Minimal form: contact (phone OR email, required),
 * name (optional), interest note (optional). Contact is staff-only
 * (roster-gated queue — no public SELECT). Success EN line is owner-verbatim;
 * ES is a ✦ candidate for the owner's copy-read.
 *
 * Client-safe: imports only ui + i18n — never ~/db or server modules.
 */
import { useState } from "react";
import { Button, Card, ConsentReceipt, TextArea, TextField } from "~/components/ui";
import { StepGuide } from "~/components/stepGuide";
import { CheckCircleIcon } from "~/lib/icons";
import { useLanguage } from "~/lib/i18n";

const CONTACT_MAX = 120;
const NAME_MAX = 80;
const NOTE_MAX = 500;

function contactLooksOk(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (v.includes("@")) {
    const at = v.indexOf("@");
    return at > 0 && v.indexOf(".", at) > at + 1;
  }
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10;
}

type Phase = "form" | "done";

export function VolunteerForm() {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const contactOk = contactLooksOk(contact);
  const canSubmit = contact.trim() !== "" && contactOk && !sending;

  const resetForm = () => {
    setName("");
    setContact("");
    setNote("");
    setTopError(null);
    setPhase("form");
  };

  const doSend = async () => {
    setSending(true);
    setTopError(null);
    try {
      const res = await fetch("/api/volunteers/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          contact: contact.trim(),
          interestNote: note.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setPhase("done");
      } else {
        setTopError(data?.error ?? t("vol_err"));
      }
    } catch {
      setTopError(t("vol_err"));
    } finally {
      setSending(false);
    }
  };

  if (phase === "done") {
    return (
      <Card className="border-sg-sage/60 bg-sg-sage-wash/40">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sg-sage text-white" aria-hidden>
            <CheckCircleIcon size={28} />
          </span>
          {/* Owner-verbatim EN (2026-09-12) — do not reword. */}
          <h2 className="text-h2">{t("vol_done")}</h2>
          <p className="text-small font-medium text-sg-sage-deep">{t("vol_done_notified")}</p>
          <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
            <Button full onClick={resetForm}>{t("dn_done_another_offer")}</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2">{t("vol_card_title")}</h2>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("vol_sub")}</p>
        </div>

        {/* Plain-language "here's how it works" (owner-directed 2026-09-16) —
            spec Part B §B3.7. "Doesn't commit you to anything" stays calm. */}
        <StepGuide
          id="volunteer"
          steps={[t("vol_step1"), t("vol_step2"), t("vol_step3"), t("vol_step4")]}
          whatNext={t("vol_whatnext")}
        />

        {topError ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {topError}
          </p>
        ) : null}

        <TextField
          label={t("vol_name")}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          maxLength={NAME_MAX}
        />

        <TextField
          label={t("vol_contact")}
          helper={t("vol_contact_help")}
          value={contact}
          onChange={(e) => setContact(e.target.value.slice(0, CONTACT_MAX))}
          placeholder="e.g. 415 555-0142 or name@email.com"
          error={contact.trim() !== "" && !contactOk ? t("vol_contact_bad") : undefined}
          maxLength={CONTACT_MAX}
        />

        <TextArea
          label={t("vol_note")}
          helper={t("vol_note_help")}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder={t("vol_note_ph")}
          maxLength={NOTE_MAX}
        />

        <ConsentReceipt
          who={t("dn_who")}
          what={t("vol_contact")}
          howLong={t("dn_how")}
          stopLabel={t("dn_stop")}
        />

        <Button
          full
          aria-busy={sending}
          disabled={!canSubmit}
          disabledReason={!canSubmit && contact.trim() === "" ? t("vol_need_contact") : undefined}
          onClick={() => void doSend()}
        >
          {sending ? t("dn_sending") : t("vol_submit")}
        </Button>
        <p className="px-1 text-small text-sg-ink-soft">{t("vol_caption")}</p>
      </div>
    </Card>
  );
}