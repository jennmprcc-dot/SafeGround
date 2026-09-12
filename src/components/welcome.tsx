/**
 * SafeGround first-launch welcome overlay (WELCOME_PREFACE_SPEC Rev 1 +
 * WELCOME_FRONT_DOOR_SPEC 2026-09-11).
 * Full-screen front door mounted in __root.tsx — shows once (sg.welcomed-v3),
 * re-readable from the menu / landing story card via the "sg:open-welcome"
 * event. Owner preface copy is VERBATIM from /home/team/shared/PREFACE_COPY.md
 * (rendered without the file's enclosing quote marks).
 *
 * Front-door layout (spec §1.3): brand → heading → owner preface → "what it
 * is" → mode-choice step (HomeTeam | Neighbor) → Skip → install disclosure
 * (collapsed on ≤390px) → share/QR → crisis line. On ≤390px Skip is sticky
 * under the top safe-area so an exit is never lost; on larger screens it sits
 * quietly under the choice cards.
 * Privacy contract (§1.7): dismissing writes ONLY the on-device seen-flag —
 * zero server calls, zero analytics, zero PII. Skip and both choice doors share
 * identical mechanics (§1.5); the only difference is the door also persists the
 * chosen mode (sg.mode) and navigates to its home.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import qrcode from "qrcode-generator";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import { CrisisSheet } from "~/components/shell";
import { MODE_KEY, writeMode } from "~/lib/modeNav";
import type { Mode } from "~/lib/modeNav";
import { cn } from "~/lib/cn";

export const WELCOME_KEY = "sg.welcomed-v3";
export const OPEN_WELCOME_EVENT = "sg:open-welcome";

/** Byte-for-byte owner preface — do not reword, shorten, or smart-quote. */
const PREFACE =
  "At MPRCC, we've lived the realities of homelessness, poverty, and substance use recovery in Marin. We know the cold nights, the long waits, the setbacks, and the small wins that keep you moving. When you reach out, you're connecting with people who've been through it and still show up for our neighbors every day.";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    return (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  try {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function qrDataUrl(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createDataURL(6, 2);
}

function ShareIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V4" />
      <path d="m7 8 5-4 5 4" />
      <path d="M5 12v8h14v-8" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <path d="M13.5 13.5h2.5v2.5h-2.5zM17.5 13.5h3v3h-3zM13.5 17.5h3v3h-3z" />
    </svg>
  );
}

export function WelcomeOverlay() {
  const [open, setOpen] = useState(false);
  const [reread, setReread] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [showIOS, setShowIOS] = useState(true);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share SafeGround");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [linkText, setLinkText] = useState<string | null>(null);
  // Install disclosure (§1.3 item 7): collapsed by default on ≤390px, open by
  // default on larger screens where vertical space is not scarce.
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 390px)").matches : false,
  );
  const [installOpen, setInstallOpen] = useState(true);
  const narrowApplied = useRef(false);
  // EN|ES (PR-B): the owner preface stays EN in v1 (human translator needed);
  // the toggle only adds the honest coming-soon note below it.
  const { lang, t } = useLanguage();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(WELCOME_KEY) !== null;
    } catch {
      seen = false; // private mode: show the welcome, it just won't stick
    }
    if (!seen) {
      // Never overlay the reviewer-facing pages (Twilio toll-free form URLs,
      // legal pages, the SMS opt-in flow): a first-time visitor there should
      // see the actual content, not a welcome modal.
      const p = window.location.pathname;
      if (!/^\/(terms|privacy)(?:\/|$)/.test(p) && !/^\/checkin/.test(p) && !/^\/api/.test(p)) {
        setOpen(true);
      }
    }
    setStandalone(isStandalone());
    setShowIOS(isIOS());
    const onOpen = () => {
      setReread(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_WELCOME_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WELCOME_EVENT, onOpen);
  }, []);

  // Viewport-class tracking for the ≤390px default (sticky skip is pure CSS;
  // this only decides the install disclosure's default state).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 390px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    // One-shot default: collapse the install disclosure on first measurement
    // when ≤390px; never fight the reader after they've toggled it.
    if (!narrowApplied.current) {
      narrowApplied.current = true;
      if (narrow) setInstallOpen(false);
    }
  }, [narrow]);

  // Open focus: save the trigger (menu re-open path) and focus the dialog.
  useEffect(() => {
    if (!open) {
      prevFocusRef.current = null;
      return;
    }
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
  }, [open]);

  // Focus trap (§1.6): Tab / Shift+Tab cycle within the overlay; the page
  // behind never receives focus while open. If the nested crisis sheet holds
  // focus, the trap scopes to the sheet so focus never falls behind its scrim.
  // Escape always closes (§1.6, existing behavior).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const active = document.activeElement as HTMLElement | null;
      let scope: HTMLElement = root;
      if (crisisOpen && active) {
        const nested = active.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
        if (nested && nested !== root) scope = nested;
      }
      const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        e.preventDefault();
        scope.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (active === first || !scope.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !scope.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, crisisOpen]);

  /** Dismissal mechanics shared by Skip, Escape, and the mode-choice doors
   * (§1.5/§1.7): writes only the on-device seen-flag (first visit), never a
   * server call — zero analytics. */
  function markSeen() {
    if (reread) return; // menu re-read never re-writes or re-navigates
    try {
      localStorage.setItem(WELCOME_KEY, new Date().toISOString());
    } catch {
      /* private mode — welcome simply shows again next visit */
    }
  }

  /** The two mode-choice doors: seen-flag + chosen-mode persist (sg.mode) +
   * client-side navigation to the mode's home. The only difference from Skip
   * is the mode write and the destination — same privacy contract otherwise. */
  function choose(mode: Mode, to: string) {
    markSeen();
    prevFocusRef.current = null;
    setOpen(false);
    setReread(false);
    writeMode(mode);
    // ModeNav seeds its highlight from localStorage once; tell it the mode
    // changed so the highlight stays honest after the door lands us elsewhere.
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: MODE_KEY, newValue: mode }));
    } catch {
      /* non-fatal — route-driven highlighting covers the destination page */
    }
    void navigate({ to }).then(() => {
      // Focus handoff: land on the destination page's h1 (#main), same pattern
      // as the CTA's first-visit exit — double rAF so the new route has painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const main = document.querySelector<HTMLElement>("#main");
          const title = main?.querySelector<HTMLElement>("h1") ?? main;
          title?.focus?.({ preventScroll: true });
          window.scrollTo(0, 0);
        }),
      );
    });
  }

  /** Calm exit — Skip, Escape, and the old CTA share one handoff:
   * first visit lands at the top of "/" (home greeting focus); menu re-open
   * returns to the trigger. Never writes the mode. */
  function close() {
    const wasReread = reread;
    markSeen();
    // Capture the return target BEFORE clearing the ref — the rAF below runs
    // one frame later, after the synchronous null-out would have lost it.
    const returnTo = prevFocusRef.current;
    prevFocusRef.current = null;
    setOpen(false);
    setReread(false);
    if (wasReread) {
      requestAnimationFrame(() => returnTo?.focus?.());
      return;
    }
    // First visit: Skip/Escape always land at the top of "/" — no mode write.
    void navigate({ to: "/" }).then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const main = document.querySelector<HTMLElement>("#main");
          const title = main?.querySelector<HTMLElement>("h1") ?? main;
          title?.focus?.({ preventScroll: true });
          window.scrollTo(0, 0);
        }),
      );
    });
  }

  async function share() {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ title: "SafeGround", text: "A calm place to find help — from MPRCC.", url });
      } catch {
        /* user cancelled — stay silent */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareLabel("Link copied — pass it along.");
    } catch {
      setLinkText(url); // clipboard blocked: show the URL as selectable text
    }
  }

  function toggleQr() {
    if (!qrOpen && qrUrl === null) {
      try {
        setQrUrl(qrDataUrl(window.location.origin));
      } catch {
        setLinkText(window.location.origin);
        return;
      }
    }
    setQrOpen((v) => !v);
  }

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[60] overflow-y-auto bg-sg-paper outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to SafeGround"
      aria-labelledby="welcome-title"
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),24px)]">
        {/* 1 · Brand — 72px logo on ≤390px, 96px larger (§1.3). Driven by the
         * same `narrow` state as the install disclosure: Tailwind's
         * max-[390px] variant compiles to a strict <390px media query, which
         * would skip exactly-390px devices. */}
        <div className="flex flex-col items-center gap-1 text-center">
          <img
            src="/logo-hero.png"
            alt="SafeGround"
            width={96}
            height={96}
            className={cn("object-contain", narrow ? "h-[72px] w-[72px]" : "h-24 w-24")}
          />
          <p className="text-btn text-sg-ink">SafeGround</p>
          <p className="text-small text-sg-sage-deep">MPRCC — Marin Peer Resource Community Collective</p>
        </div>

        {/* 2–4 · Heading, owner preface (verbatim), what-it-is — on paper, no card */}
        <div className="flex flex-col gap-4">
          <h1 id="welcome-title" className="text-h2">
            You&apos;re welcome here.
          </h1>
          <p className="text-body text-sg-ink">{PREFACE}</p>
          {/* v1: preface is EN-only until a human translates it — say so plainly. */}
          {lang === "es" ? (
            <p className="text-small text-sg-ink-soft">Espanol proximamente · Spanish coming soon.</p>
          ) : null}
          <p className="text-body text-sg-ink-soft">
            SafeGround is your free, private helper.
            <br />
            Find food and shelter fast. Get heads-up alerts about sweeps. Let your people know you're okay with one
            tap. No account. No background tracking. Just real help when you need it.
          </p>
        </div>

        {/* 5 · Mode choice — one calm step, two equal doors (owner copy):
         * HomeTeam (sage hint) or Neighbor (sky hint). Each door is a button
         * card: seen-flag + mode write + navigate; zero server calls. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-h2">{t("welcome_choice_title")}</h2>
          <button
            type="button"
            onClick={() => choose("hometeam", "/hometeam")}
            className="flex min-h-[52px] w-full flex-col items-start justify-center gap-0.5 rounded-[12px] border border-sg-sage/50 bg-sg-card px-4 py-3 text-left transition-colors hover:border-sg-sage hover:bg-sg-sage-wash/40 active:bg-sg-sage-wash"
          >
            <span className="text-body font-semibold text-sg-sage-deep">{t("welcome_choice_help")}</span>
            <span className="text-small text-sg-ink-soft">{t("welcome_choice_help_sub")}</span>
          </button>
          <button
            type="button"
            onClick={() => choose("neighbor", "/peer-support")}
            className="flex min-h-[52px] w-full flex-col items-start justify-center gap-0.5 rounded-[12px] border border-sg-sky/50 bg-sg-card px-4 py-3 text-left transition-colors hover:border-sg-sky hover:bg-sg-sky-wash/40 active:bg-sg-sky-wash"
          >
            <span className="text-body font-semibold text-sg-sky">{t("welcome_choice_neighbor")}</span>
            <span className="text-small text-sg-ink-soft">{t("welcome_choice_neighbor_sub")}</span>
          </button>
        </div>

        {/* 6 · Calm always-available Skip — sticky on ≤390px (never lost while
         * scrolling, bg-sg-paper/95 so text never collides); static under the
         * CTA on larger screens. Same mechanics as Get started (§1.5). */}
        <div
          className={cn(
            narrow &&
              "sticky top-[env(safe-area-inset-top)] z-20 -mx-4 flex justify-end bg-sg-paper/95 px-4 py-1",
          )}
        >
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-[48px] items-center px-1 text-small font-semibold text-sg-sky underline underline-offset-2"
          >
            Skip for now
          </button>
        </div>
        <p className="-mt-3 text-center text-small text-sg-ink-soft">
          You can read this welcome again anytime — it&apos;s in the menu.
        </p>

        {/* 7 · Install disclosure — hidden when already installed; collapsed
         * by default on ≤390px, open on larger (§1.3 item 7). */}
        {standalone ? null : (
          <Card>
            <Button
              variant="quiet"
              onClick={() => setInstallOpen((v) => !v)}
              aria-expanded={installOpen}
              aria-controls="sg-install-panel"
              className="self-start px-0"
            >
              How to add SafeGround to your phone
            </Button>
            {installOpen ? (
              <div id="sg-install-panel" className="mt-2">
                {showIOS ? (
                  <div>
                    <p className="text-small text-sg-ink-soft">iPhone · Safari</p>
                    <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-5 text-small text-sg-ink">
                      <li>Tap the Share button — the square with an arrow pointing up — at the bottom of Safari.</li>
                      <li>Scroll down and tap &ldquo;Add to Home Screen.&rdquo;</li>
                      <li>Tap &ldquo;Add&rdquo; — the SafeGround icon will appear with your apps.</li>
                    </ol>
                  </div>
                ) : (
                  <div>
                    <p className="text-small text-sg-ink-soft">Android · Chrome</p>
                    <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-5 text-small text-sg-ink">
                      <li>Tap the three-dot menu at the top of Chrome.</li>
                      <li>Tap &ldquo;Add to Home screen&rdquo; or &ldquo;Install app.&rdquo;</li>
                      <li>Tap &ldquo;Install&rdquo; — the SafeGround icon will appear with your apps.</li>
                    </ol>
                  </div>
                )}
                <Button variant="quiet" onClick={() => setShowIOS((v) => !v)} className="mt-1 self-start">
                  {showIOS ? "Show Android steps" : "Show iPhone steps"}
                </Button>
                <p className="mt-1 text-small text-sg-ink-soft">
                  Installing is optional — the app works in your browser either way.
                </p>
              </div>
            ) : null}
          </Card>
        )}

        {/* 8 · Share / QR — unchanged */}
        <Card>
          <h2 className="text-h2">Pass it along</h2>
          <p className="mt-1 text-body text-sg-ink-soft">Know someone who could use this? Share SafeGround.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={share}>
              <ShareIcon />
              {shareLabel}
            </Button>
            <Button variant="secondary" onClick={toggleQr} aria-expanded={qrOpen} aria-controls="sg-qr-panel">
              <QrIcon />
              {qrOpen ? "Hide QR code" : "Show QR code"}
            </Button>
          </div>
          {linkText ? (
            <p className="mt-3 break-all text-small text-sg-ink">
              Copy this link: <span className="select-all">{linkText}</span>
            </p>
          ) : null}
          {qrOpen && qrUrl ? (
            <div id="sg-qr-panel" className="mt-4 flex flex-col items-center gap-2">
              <img src={qrUrl} alt="QR code linking to SafeGround" width={200} height={200} className="h-[200px] w-[200px]" />
              <p className="text-small text-sg-ink-soft">Point a camera at this to open SafeGround.</p>
              <Button variant="quiet" onClick={() => window.print()} className={cn("self-center")}>
                Print the QR code
              </Button>
            </div>
          ) : null}
        </Card>

        {/* 9 · Crisis — last, quiet, always present */}
        <div className="pb-2 text-center">
          <Button variant="text" onClick={() => setCrisisOpen(true)}>
            In crisis? Talk to someone
          </Button>
        </div>
      </div>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </div>
  );
}