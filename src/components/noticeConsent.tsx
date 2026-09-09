/**
 * Group-updates opt-in checkbox (spec §2.1 M2) — shared by the alert-sent and
 * peer-support success screens.
 *
 * Renders a calm opt-in ("MPRCC can send me group updates by app
 * notification") + an after-hours sub-checkbox (default OFF, with the
 * "Most people leave this off — that's fine." line). On toggle it POSTs
 * /api/directory/consent with the caller's own phone (body phone must match
 * the x-sg-phone device header — nobody can opt anyone else in). No row = no
 * notices, ever; unchecking removes consent server-side? No — unchecking
 * simply doesn't create the row; an existing row is left alone unless the
 * member asks the team (pause = opt-out). The box starts unchecked and only
 * writes when the neighbor taps.
 */
import { useState } from "react";
import { normPhone } from "~/lib/alertIdentity";
import { useLanguage } from "~/lib/i18n";
import { LegalLinks } from "~/components/legalLinks";

export function NoticeConsentOptIn({ phone, source }: { phone: string; source: string }) {
  const { t } = useLanguage();
  const clean = normPhone(phone);
  const [checked, setChecked] = useState(false);
  const [afterHours, setAfterHours] = useState(false);
  const [textMe, setTextMe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (optIn: boolean, ah: boolean, sms: boolean) => {
    if (!optIn || clean.length < 7) {
      setChecked(optIn);
      setAfterHours(ah);
      setTextMe(sms);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/directory/consent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": clean },
        body: JSON.stringify({ phone: clean, afterHours: ah, sms, source }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setChecked(true);
        setAfterHours(ah);
        setTextMe(sms);
        setSaved(true);
      } else {
        setError(data?.error ?? "That choice didn't save — try again when you can.");
      }
    } catch {
      setError("No connection — that choice didn't save yet.");
    } finally {
      setSaving(false);
    }
  };

  if (clean.length < 7) return null;

  return (
    <div className="rounded-[12px] border border-sg-line bg-sg-card p-3 text-left">
      <label className="flex min-h-[48px] cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          aria-busy={saving}
          onChange={(e) => void save(e.target.checked, afterHours, textMe)}
          className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
        />
        <span className="text-small">
          MPRCC can send me group updates by app notification.
          {saved ? <span className="text-sg-sage"> Saved — you can stop anytime.</span> : null}
        </span>
      </label>
      {checked ? (
        <>
        <label className="ml-8 mt-1 flex min-h-[48px] cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={afterHours}
            disabled={saving}
            aria-busy={saving}
            onChange={(e) => void save(true, e.target.checked, textMe)}
            className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
          />
          <span className="text-small text-sg-ink-soft">
            Yes, reach me for urgent community updates after hours too. Most people leave this off — that&apos;s fine.
          </span>
        </label>
        <label className="ml-8 mt-1 flex min-h-[48px] cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={textMe}
            disabled={saving}
            aria-busy={saving}
            onChange={(e) => void save(true, afterHours, e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
          />
          <span className="text-small">
            <span className="block font-medium text-sg-ink">{t("nc_sms")}</span>
            <span className="block text-sg-ink-soft">{t("nc_sms_sub")}</span>
          </span>
        </label>
        <LegalLinks className="ml-8 mt-1" />
        </>
      ) : null}
      {error ? (
        <p className="ml-8 mt-1 text-small text-sg-clay" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
