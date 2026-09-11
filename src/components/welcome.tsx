/**
 * SafeGround first-launch welcome overlay (WELCOME_PREFACE_SPEC Rev 1).
 * Full-screen front door mounted in __root.tsx — shows once (sg.welcomed),
 * re-readable from the menu via the "sg:open-welcome" event.
 * Owner preface copy is VERBATIM from /home/team/shared/PREFACE_COPY.md
 * (rendered without the file's enclosing quote marks).
 */
import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import { CrisisSheet } from "~/components/shell";
import { cn } from "~/lib/cn";

export const WELCOME_KEY = "sg.welcomed-v2";
export const OPEN_WELCOME_EVENT = "sg:open-welcome";

/** Byte-for-byte owner preface — do not reword, shorten, or smart-quote. */
const PREFACE =
  "At MPRCC, our team understands the challenges of homelessness, poverty, and recovery because we've been there. We're here to offer a supportive ear, a guiding hand, or just someone to listen. Feel free to reach out anytime.";

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
  // EN|ES (PR-B): the owner preface stays EN in v1 (human translator needed);
  // the toggle only adds the honest coming-soon note below it.
  const { lang } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (!reread) {
      try {
        localStorage.setItem(WELCOME_KEY, new Date().toISOString());
      } catch {
        /* private mode — welcome simply shows again next visit */
      }
    }
    setOpen(false);
    setReread(false);
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
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-sg-paper" role="dialog" aria-modal="true" aria-label="Welcome to SafeGround">
      <div ref={ref} tabIndex={-1} className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),24px)] outline-none">
        {/* Brand */}
        <div className="flex flex-col items-center gap-1 text-center">
          <img src="/logo-hero.png" alt="SafeGround" width={96} height={96} className="h-24 w-24 object-contain" />
          <p className="text-btn text-sg-ink">SafeGround</p>
          <p className="text-small text-sg-sage-deep">MPRCC — Marin Peer Resource Community Collective</p>
        </div>

        {/* Owner preface — verbatim, on paper, no card */}
        <div className="flex flex-col gap-4">
          <h1 className="text-h2">You&apos;re welcome here.</h1>
          <p className="text-body text-sg-ink">{PREFACE}</p>
          {/* v1: preface is EN-only until a human translates it — say so plainly. */}
          {lang === "es" ? (
            <p className="text-small text-sg-ink-soft">Espanol proximamente · Spanish coming soon.</p>
          ) : null}
          <p className="text-body text-sg-ink-soft">
            SafeGround is a free, private helper — find food and shelter, hear about sweeps nearby, and let your
            people know you&apos;re okay. No account needed. No background location, ever.
          </p>
        </div>

        {/* Install card — hidden when already installed */}
        {standalone ? null : (
          <Card>
            <h2 className="text-h2">Keep SafeGround on your phone</h2>
            {showIOS ? (
              <div className="mt-2">
                <p className="text-small text-sg-ink-soft">iPhone · Safari</p>
                <ol className="mt-1.5 flex list-decimal flex-col gap-1.5 pl-5 text-small text-sg-ink">
                  <li>Tap the Share button — the square with an arrow pointing up — at the bottom of Safari.</li>
                  <li>Scroll down and tap &ldquo;Add to Home Screen.&rdquo;</li>
                  <li>Tap &ldquo;Add&rdquo; — the SafeGround icon will appear with your apps.</li>
                </ol>
              </div>
            ) : (
              <div className="mt-2">
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
            <p className="mt-1 text-small text-sg-ink-soft">Installing is optional — the app works in your browser either way.</p>
          </Card>
        )}

        {/* Primary CTA */}
        <Button full onClick={close} className="min-h-[52px]">
          Get started
        </Button>
        <p className="-mt-3 text-center text-small text-sg-ink-soft">
          You can read this welcome again anytime — it&apos;s in the menu.
        </p>

        {/* Share / QR */}
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
