/**
 * SafeGround — single app-wide Safety & Liability gate (owner-directed
 * 2026-09-12). Replaces the two per-feature gates (HomeTeam helper join +
 * HomeTeam help requests) with ONE full-screen gate shown the first time a
 * device opens the app, before any feature is usable.
 *
 * Fail-closed: while unaccepted, the gate covers the whole viewport at
 * z-[70] (above the welcome overlay's z-[60]) and swallows all keyboard
 * input, so nothing beneath is reachable by pointer or keyboard.
 *
 * Shown ONCE per device: acceptance persists to localStorage under the
 * single key `sg.safetyAgree-v1` (ISO timestamp). Never bump or rotate the
 * key, and never show again for a returning device — the welcome overlay has
 * its own first-visit logic (sg.welcomed-v3) and must not be disturbed.
 *
 * Skip set (mirrors src/components/welcome.tsx ~line 135): /terms, /privacy,
 * /checkin, and /api paths never get gated, so legal pages and API routes
 * stay reachable before acceptance.
 *
 * The legal body is the owner's verbatim SafeGround-generalized disclaimer in
 * src/components/disclaimer.tsx (EN-only, immutable). UI chrome (checkbox,
 * continue button, helper lines) is i18n'd in src/lib/i18n.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui";
import {
  DisclaimerText,
  SG_SAFETY_DISCLAIMER_BLOCKS,
  SG_SAFETY_DISCLAIMER_TITLE,
} from "~/components/disclaimer";
import { LegalLinks } from "~/components/legalLinks";
import { useLanguage } from "~/lib/i18n";

/** Single acceptance key for the whole app. Written once, never bumped —
 * do NOT rotate or version this (returning users would be re-gated). */
export const SAFETY_AGREE_KEY = "sg.safetyAgree-v1";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SafetyGate() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let agreed = false;
    try {
      agreed = localStorage.getItem(SAFETY_AGREE_KEY) !== null;
    } catch {
      agreed = false; // private mode — the gate shows; acceptance just won't stick
    }
    if (agreed) return; // returning device — the gate appeared once already
    // Never gate the legal pages or API surfaces (twilio review URLs, SMS
    // opt-in flow): a first-time visitor there sees the real content.
    const p = window.location.pathname;
    if (/^\/(terms|privacy)(?:\/|$)/.test(p) || /^\/checkin/.test(p) || /^\/api/.test(p)) return;
    setOpen(true);
  }, []);

  // Own the focus while open: the welcome overlay mounts after this gate and
  // its own open-effect focuses ITS dialog — the rAF re-asserts the gate so
  // a screen reader never lands on the hidden layer beneath.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, [open]);

  // Modal keyboard: while the gate is up, nothing beneath responds to keys.
  // stopImmediatePropagation (gate's listener runs before the welcome
  // overlay's — mount order) stops the hidden welcome's trap AND its Escape
  // handler, which would otherwise close the welcome, write sg.welcomed-v3,
  // and navigate — silently skipping the welcome for a genuine first-timer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function accept() {
    try {
      localStorage.setItem(SAFETY_AGREE_KEY, new Date().toISOString());
    } catch {
      /* private mode — the gate simply shows again next visit (same privacy
         contract as the welcome overlay's seen-flag) */
    }
    setOpen(false);
    // Let the normal flow proceed: the welcome overlay takes over for genuine
    // first-timers, the app itself for returning devices.
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] overflow-y-auto bg-sg-paper outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sg-safety-title"
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),24px)]">
        <header className="flex flex-col items-center gap-1 text-center">
          <img
            src="/logo-hero.png"
            alt=""
            width={72}
            height={72}
            className="h-[72px] w-[72px] object-contain"
            aria-hidden
          />
          <h1 id="sg-safety-title" className="text-h2">
            {SG_SAFETY_DISCLAIMER_TITLE}
          </h1>
          <p className="text-small text-sg-ink-soft">{t("sg_gate_intro")}</p>
        </header>

        {/* Full legal body — scrollable, explicitly focusable (owner's
            verbatim SafeGround text; EN-only by design). */}
        <div
          className="max-h-[45vh] overflow-y-auto rounded-[12px] border border-sg-line bg-sg-card p-4"
          tabIndex={0}
          aria-label={SG_SAFETY_DISCLAIMER_TITLE}
        >
          <DisclaimerText blocks={SG_SAFETY_DISCLAIMER_BLOCKS} />
        </div>

        <label className="flex min-h-[52px] cursor-pointer items-start gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-4 py-3 text-left">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[#2F6B4F]"
          />
          <span className="text-small">
            <span className="block font-medium text-sg-ink">{t("sg_gate_agree")}</span>
          </span>
        </label>

        <Button full onClick={accept} disabled={!checked} disabledReason={!checked ? t("sg_gate_need") : undefined}>
          {t("sg_gate_continue")}
        </Button>

        <LegalLinks className="text-center" />
      </div>
    </div>
  );
}