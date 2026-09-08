/**
 * Urgent-need action (owner-directed 2026-09-08): "I need help now".
 *
 * One calm page: pick one of the owner's five categories (Help, Advocacy,
 * ER ride, ER supplies, Support) + phone + optional name/note + the sender's explicit
 * location choice (none / fuzzed / exact, NEVER pre-selected) -> confirm ->
 * POST /api/urgent-need -> the MPRCC team has it.
 *
 * Consent-first: nothing leaves the device until the neighbor taps Send.
 * Trusted peers/friends are NEVER notified of urgent needs (their channel
 * stays the existing check-in / trusted-peers safety visibility). Never 911.
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
import { useLanguage, type I18nKey } from "~/lib/i18n";
import { NoticeConsentOptIn } from "~/components/noticeConsent";

type UrgentCategory = "help" | "advocacy" | "er_ride" | "er_supplies" | "support";
type UrgentLocation = "none" | "fuzzed" | "exact";
type Phase = "form" | "confirm" | "done";

const CATEGORIES: ReadonlyArray<{
  value: UrgentCategory;
  labelKey: I18nKey;
  subKey: I18nKey;
}> = [
  { value: "help", labelKey: "un_cat_help", subKey: "un_cat_help_sub" },
  { value: "advocacy", labelKey: "un_cat_advocacy", subKey: "un_cat_advocacy_sub" },
  { value: "er_ride", labelKey: "un_cat_er_ride", subKey: "un_cat_er_ride_sub" },
  { value: "er_supplies", labelKey: "un_cat_er_supplies", subKey: "un_cat_er_supplies_sub" },
  { value: "support", labelKey: "un_cat_support", subKey: "un_cat_support_sub" },
];

const LOCATIONS: ReadonlyArray<{
  value: UrgentLocation;
  labelKey: I18nKey;
  subKey: I18nKey;
}> = [
  { value: "none", labelKey: "un_loc_none", subKey: "un_loc_none_sub" },
  { value: "fuzzed", labelKey: "un_loc_fuzzed", subKey: "un_loc_fuzzed_sub" },
  { value: "exact", labelKey: "un_loc_exact", subKey: "un_loc_exact_sub" },
];

function readDevicePoint(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
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
}

function UrgentNeedPage() {
  const { t } = useLanguage();
  const [identity] = useState(() => getAlertIdentity());
  const [category, setCategory] = useState<UrgentCategory | null>(null);
  const [location, setLocation] = useState<UrgentLocation | null>(null);
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [nameInput, setNameInput] = useState(identity?.name === "Neighbor" ? "" : (identity?.name ?? ""));
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner A&B: staff are notified BY DEFAULT; the sender keeps the choice
  // via a visible checkbox. Starts ON, never pre-fills anything else.
  const [notifyStaff, setNotifyStaff] = useState(true);
  const [teamNotified, setTeamNotified] = useState(true);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const phoneOk = phoneLooksOk(phoneInput);
  const ready = category != null && location != null && phoneOk;

  const doSend = async () => {
    if (!category || !location) return;
    setSending(true);
    setError(null);
    let fuzzLat: number | null = null;
    let fuzzLng: number | null = null;
    let exactLat: number | null = null;
    let exactLng: number | null = null;
    if (location === "fuzzed" || location === "exact") {
      // Single one-time device read, user-initiated for THIS request. No
      // stored fallback, no invented point: the read is taken at send time so
      // the choice reflects where the neighbor is now.
      try {
        const p = await readDevicePoint();
        if (location === "exact") {
          exactLat = p.lat;
          exactLng = p.lng;
        } else {
          fuzzLat = p.lat;
          fuzzLng = p.lng;
        }
      } catch {
        setError(t("un_loc_fail"));
        setSending(false);
        return;
      }
    }
    try {
      const res = await fetch("/api/urgent-need/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: phoneInput,
          name: nameInput.trim(),
          note: note.trim(),
          category,
          location,
          fuzzLat,
          fuzzLng,
          exactLat,
          exactLng,
          // Owner A&B: unchecked suppresses the staff push ONLY — the
          // request still records in the queue either way.
          notifyStaff,
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
          <h1 className="text-h1">{t("un_done")}</h1>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {teamNotified ? t("un_done_a") : t("un_done_b")}
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <NoticeConsentOptIn phone={phoneInput} source="urgent-need" />
            <Link to="/" className="block w-full">
              <Button full>{t("un_home")}</Button>
            </Link>
          </div>
          <p className="text-small text-sg-ink-soft">{t("un_done_privacy")}</p>
        </div>
      </AppShell>
    );
  }

  /* ---- Confirm: one more calm breath before anything is sent ---- */
  if (phase === "confirm" && category && location) {
    const cat = CATEGORIES.find((c) => c.value === category)!;
    const loc = LOCATIONS.find((l) => l.value === location)!;
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">{t("un_ready")}</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("un_ready_sub")}</p>
          </header>
          <Card>
            <dl className="flex flex-col gap-2 text-body">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{t("un_cat_label")}</dt>
                <dd>{t(cat.labelKey)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium">{t("un_loc_label")}</dt>
                <dd>{t(loc.labelKey)}</dd>
              </div>
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
            <p className="mt-3 text-small text-sg-ink-soft">{t("un_scope")}</p>
          </Card>
          {/* Owner A&B: staff notified BY DEFAULT; the sender keeps the
              choice here on the confirm screen, before anything is sent. */}
          <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[12px] border border-sg-line bg-sg-card px-3 py-2.5">
            <input
              type="checkbox"
              checked={notifyStaff}
              onChange={(e) => setNotifyStaff(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[#2f6b4f]"
            />
            <span>
              <span className="block text-btn font-semibold text-sg-ink">{t("un_notify")}</span>
              <span className="block text-small text-sg-ink-soft">{t("un_notify_sub")}</span>
            </span>
          </label>
          <div className="flex flex-col gap-2">
            <Button full disabled={sending} onClick={() => void doSend()}>
              {sending ? "Sending…" : t("un_yes")}
            </Button>
            <Button variant="quiet" full onClick={() => setPhase("form")}>
              {t("un_notyet")}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  /* ---- Form: category + phone + location (nothing pre-selected) ---- */
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("un_title")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("un_sub")}</p>
        </header>

        <fieldset>
          <legend className="sr-only">{t("un_cat_label")}</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("un_cat_label")}>
            {CATEGORIES.map((c) => {
              const on = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCategory(c.value)}
                  className={`flex min-h-[76px] flex-col items-start justify-center gap-0.5 rounded-[12px] border-2 px-3 py-2 text-left transition-colors ${
                    on ? "border-sg-clay bg-sg-clay-wash/40" : "border-sg-line bg-sg-card"
                  }`}
                >
                  <span className="text-btn font-semibold text-sg-ink">{t(c.labelKey)}</span>
                  <span className="text-small leading-snug text-sg-ink-soft">{t(c.subKey)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <Card>
          <div className="flex flex-col gap-4">
            <TextField
              label={t("un_phone")}
              helper={t("un_phone_help")}
              value={phoneInput}
              onChange={(e) => setPhoneInput(normPhone(e.target.value))}
              placeholder="e.g. 415 555-0142"
              inputMode="tel"
              error={phoneInput.length > 0 && !phoneOk ? t("un_phone_bad") : undefined}
            />
            <TextField
              label={t("un_name")}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("un_name_ph")}
              maxLength={40}
            />
            <TextArea
              label={t("un_note")}
              helper={t("un_note_help")}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("un_note_ph")}
            />
          </div>
        </Card>

        <fieldset>
          <legend className="mb-2 text-btn font-medium text-sg-ink">{t("un_loc_title")}</legend>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("un_loc_title")}>
            {LOCATIONS.map((o) => {
              const on = location === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setLocation(o.value)}
                  className={`flex min-h-[64px] items-center gap-3 rounded-[12px] border-2 px-3 py-2 text-left transition-colors ${
                    on ? "border-sg-sage bg-sg-sage-wash/40" : "border-sg-line bg-sg-card"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      on ? "border-sg-sage" : "border-sg-line"
                    }`}
                  >
                    {on ? <span className="h-3 w-3 rounded-full bg-sg-sage" /> : null}
                  </span>
                  <span>
                    <span className="block text-btn font-semibold text-sg-ink">{t(o.labelKey)}</span>
                    <span className="block text-small text-sg-ink-soft">{t(o.subKey)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <ConsentReceipt
          who={t("un_who")}
          what={t("un_what")}
          howLong={t("ps_how")}
          stopLabel={t("ps_stop")}
        />
        <p className="text-small text-sg-ink-soft">{t("un_peers_note")}</p>

        {error ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          full
          disabled={!ready || sending}
          disabledReason={
            !category ? t("un_need_cat") : !location ? t("un_need_loc") : !phoneOk ? t("un_need_phone") : undefined
          }
          onClick={() => setPhase("confirm")}
        >
          {t("un_submit")}
        </Button>

        <button
          type="button"
          onClick={() => setCrisisOpen(true)}
          className="inline-flex min-h-[48px] items-center self-start text-sg-sky underline underline-offset-2"
        >
          {t("crisis_title")}
        </button>
      </div>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/urgent-need")({ component: UrgentNeedPage });
