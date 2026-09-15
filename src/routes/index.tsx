/**
 * Home / Landing (PASS 3 §2, NAV_RESTRUCTURE_SPEC) — the "What is SafeGround"
 * page: calm, short, plain words (7 blocks per §2.2, order is the spec; an
 * 8th block — share/QR "Pass it along" card — was added 2026-09-15 on the
 * owner's request, ported from the welcome overlay §8).
 * Routes by intent through three mode entries; quiet sweeps + crisis links;
 * privacy line. The AppShell footer (Terms · Privacy · ©) renders as today.
 *
 * Returning users get a ONE-TIME cold-start redirect to their stored mode's
 * home (see AppShell in shell.tsx — reads sg.welcomed-v3 + sg.mode, pathname
 * exactly "/", replace-style). SPA navigation to "/" (the logo) always lands
 * here and stays. Fresh visitors are never redirected — the safety gate +
 * welcome overlay own their first visit, then they land on this page.
 *
 * CSS only — zero data fetch, zero server calls, zero new storage keys (the
 * mode cards write sg.mode exactly like the welcome doors, nothing else).
 */
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import qrcode from "qrcode-generator";
import { AppShell, CrisisSheet } from "~/components/shell";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import { MODE_KEY, writeMode } from "~/lib/modeNav";
import type { Mode } from "~/lib/modeNav";
import { cn } from "~/lib/cn";

/* Share/QR helpers — duplicated from components/welcome.tsx §8 (owner request
 * 2026-09-15: the landing page needs the same pass-it-along mechanics without
 * importing the overlay module; welcome.tsx keeps these module-private). Keep
 * in sync if the welcome overlay's QR rendering ever changes. */
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

/** Mode entry card — the welcome doors' exact choose() mechanics (writeMode +
 * synthetic StorageEvent so the header highlight stays honest + navigate),
 * no new event channel (spec §2.4). One-tap, 52px target. */
function ModeCard({
  mode,
  to,
  search,
  icon,
  label,
  accent,
}: {
  mode: Mode;
  to: string;
  search?: Record<string, string>;
  icon: string;
  label: string;
  accent: "sky" | "sage" | "ink";
}) {
  const navigate = useNavigate();
  const choose = () => {
    writeMode(mode);
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: MODE_KEY, newValue: mode }));
    } catch {
      /* non-fatal — route-driven highlighting covers the destination page */
    }
    void navigate({ to, search }).then(() => {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    });
  };
  const hover =
    accent === "sky"
      ? "hover:border-sg-sky hover:bg-sg-sky-wash/40 active:bg-sg-sky-wash"
      : accent === "sage"
        ? "hover:border-sg-sage hover:bg-sg-sage-wash/40 active:bg-sg-sage-wash"
        : "hover:border-sg-ink/30 hover:bg-sg-card active:bg-sg-paper";
  return (
    <button
      type="button"
      onClick={choose}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-3 rounded-[12px] border bg-sg-card px-4 py-3 text-left transition-colors",
        accent === "sky"
          ? "border-sg-sky/50"
          : accent === "sage"
            ? "border-sg-sage/50"
            : "border-sg-line/70",
        hover,
      )}
    >
      <span aria-hidden className="text-[22px] leading-none">
        {icon}
      </span>
      <span className="text-body font-semibold text-sg-ink">{label}</span>
    </button>
  );
}

function HomePage() {
  const { t } = useLanguage();
  const [crisisOpen, setCrisisOpen] = useState(false);
  // Share/QR card state — same mechanics as welcome.tsx §8. `copied` is a flag
  // (not a stored string) so the label re-renders correctly on language toggle.
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [linkText, setLinkText] = useState<string | null>(null);

  async function share() {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ title: "SafeGround", text: t("home_share_text"), url });
      } catch {
        /* user cancelled — stay silent */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
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

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-6">
        {/* 1 · Brand — 72px logo (like the welcome) so the page reads short. */}
        <div className="flex flex-col items-center gap-1 pt-1 text-center">
          <img
            src="/logo-hero.png"
            alt="SafeGround"
            width={72}
            height={72}
            className="h-[72px] w-[72px] object-contain"
          />
          <p className="text-btn text-sg-ink">SafeGround</p>
          <p className="text-small font-medium text-sg-ink-soft">{t("home_by_mprcc")}</p>
        </div>

        {/* 2 · H1 + one-liner — static (no time-greeting on this page). */}
        <div className="flex flex-col gap-2">
          <h1 className="text-display text-sg-ink">{t("home_what_h1")}</h1>
          <p className="text-body text-sg-ink-soft">{t("home_what_sub")}</p>
        </div>

        {/* 3 · What it is — the same story the welcome overlay tells. */}
        <p className="text-body text-sg-ink">{t("home_what_body")}</p>

        {/* 4 · Who it's for — one plain line. */}
        <p className="text-h2 text-sg-ink">{t("home_who")}</p>

        {/* 5 · Mode entries (routing by intent) — resources first, give
            second, admin third: served population first (same call as the
            default mode). The Admin card needs no extra copy — /outreach
            shows the calm locked line for non-roster users itself. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-h2 text-sg-ink">{t("home_here_for")}</h2>
          <ModeCard mode="neighbor" to="/help" icon="👤" label={t("mode_neighbor")} accent="sky" />
          <ModeCard mode="hometeam" to="/hometeam" icon="🤝" label={t("mode_hometeam")} accent="sage" />
          <ModeCard mode="admin" to="/outreach" search={{ tab: "alerts" }} icon="🔒" label={t("mode_admin")} accent="ink" />
        </div>

        {/* 6 · Quiet "when" links — sweeps + crisis, 48px targets. */}
        <div className="flex flex-col items-start gap-1">
          <Link to="/sweeps" className="inline-flex min-h-[48px] items-center text-sg-sky underline underline-offset-2">
            {t("home_sweep_link")}
          </Link>
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="inline-flex min-h-[48px] items-center text-sg-sky underline underline-offset-2"
          >
            {t("home_crisis_link")}
          </button>
        </div>

        {/* 7 · Share / QR — pass it along (owner request 2026-09-15). Same
            mechanics as the welcome overlay §8; copy via t(). Share URL is
            window.location.origin at click time — never a hardcoded domain. */}
        <Card>
          <h2 className="text-h2 text-sg-ink">{t("home_share_h")}</h2>
          <p className="mt-1 text-body text-sg-ink-soft">{t("home_share_sub")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={share}>
              <ShareIcon />
              {copied ? t("home_share_copied") : t("home_share_btn")}
            </Button>
            <Button variant="secondary" onClick={toggleQr} aria-expanded={qrOpen} aria-controls="sg-home-qr-panel">
              <QrIcon />
              {qrOpen ? t("home_qr_hide") : t("home_qr_show")}
            </Button>
          </div>
          {linkText ? (
            <p className="mt-3 break-all text-small text-sg-ink">
              {t("home_share_link_label")} <span className="select-all">{linkText}</span>
            </p>
          ) : null}
          {qrOpen && qrUrl ? (
            <div id="sg-home-qr-panel" className="mt-4 flex flex-col items-center gap-2">
              <img
                src={qrUrl}
                alt={t("home_qr_caption")}
                width={200}
                height={200}
                className="h-[200px] w-[200px]"
              />
              <p className="text-small text-sg-ink-soft">{t("home_qr_caption")}</p>
              <Button variant="quiet" onClick={() => window.print()} className="self-center">
                {t("home_qr_print")}
              </Button>
            </div>
          ) : null}
        </Card>

        {/* 8 · Privacy line (existing key, unchanged). */}
        <p className="pb-2 text-small text-sg-ink-soft">{t("home_noloc")}</p>
      </div>

      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/")({ component: HomePage });