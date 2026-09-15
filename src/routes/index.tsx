/**
 * Home / Landing (PASS 3 §2, NAV_RESTRUCTURE_SPEC) — the "What is SafeGround"
 * page: calm, short, plain words (7 blocks per §2.2, order is the spec).
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
import { AppShell, CrisisSheet } from "~/components/shell";
import { useLanguage } from "~/lib/i18n";
import { MODE_KEY, writeMode } from "~/lib/modeNav";
import type { Mode } from "~/lib/modeNav";
import { cn } from "~/lib/cn";

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

        {/* 7 · Privacy line (existing key, unchanged). */}
        <p className="pb-2 text-small text-sg-ink-soft">{t("home_noloc")}</p>
      </div>

      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/")({ component: HomePage });