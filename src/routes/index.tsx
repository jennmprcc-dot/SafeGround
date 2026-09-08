/**
 * Home / Landing (WIREFRAMES §1) — calm front door, anonymous-first.
 * 3 safety jobs in ≤1 scroll; crisis link always visible, quiet.
 * Copy verbatim from WIREFRAMES §1 unless a privacy/trauma rule forced a change.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { useAuth } from "~/lib/auth";
import { BottomSheet, Button, Card, LocationOnceButton, useToasts } from "~/components/ui";
import { getHomeStatsResilient, readLocationOnce } from "~/lib/homeStatsResilience";
import type { DataSource } from "~/lib/server";
import { useLanguage } from "~/lib/i18n";
import { MoonBlanketIcon, PersonIcon } from "~/lib/icons";

/* Time-aware greeting — computed client-side so SSR never mismatches (calm default first). */
function Greeting() {
  const { t } = useLanguage();
  const [part, setPart] = useState<"m" | "a" | "e">("a");
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "m" : h < 17 ? "a" : "e");
  }, []);
  const greeting = part === "m" ? t("home_morning") : part === "e" ? t("home_evening") : t("home_afternoon");
  return (
    <h1 className="text-display text-sg-ink">
      {greeting}
      <span className="mt-1 block text-body font-normal text-sg-ink-soft">
        {t("home_greet_sub")}
      </span>
    </h1>
  );
}

/* Shared hook: Home aggregates from the live database with a 3s budget per
 * attempt + one same-budget retry; on timeout or network failure it settles on
 * the cached Marin essentials (computed on-device — nothing sent anywhere).
 * The page stays calm and honest either way — never an error wall.
 * `timedOut` drives the gentle "saved list" notice in NearYouCard. */
function useHomeStats(): { activeSweeps: number; resourceCount: number; openCount: number; source: DataSource; loading: boolean; timedOut: boolean; retry: () => void } {
  const [state, setState] = useState({ activeSweeps: 0, resourceCount: 0, openCount: 0, source: "demo" as DataSource, loading: true, timedOut: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getHomeStatsResilient()
      .then((s) => {
        if (alive) setState({ ...s, loading: false, timedOut: s.source === "demo" });
      })
      .catch(() => {
        // getHomeStatsResilient never rejects; this is belt-and-braces only.
        if (alive) setState({ activeSweeps: 0, resourceCount: 0, openCount: 0, source: "demo", loading: false, timedOut: true });
      });
    return () => {
      alive = false;
    };
  }, [tick]);
  return { ...state, retry: () => { setState((s) => ({ ...s, loading: true, timedOut: false })); setTick((t) => t + 1); } };
}

function HeadsUpCard() {
  const { t } = useLanguage();
  const { activeSweeps, source, loading } = useHomeStats();
  if (loading) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sky-wash text-sg-sky" aria-hidden>
            <MoonBlanketIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold text-sg-ink-soft">{t("home_headsup")}</p>
            <div className="mt-2 h-6 w-44 animate-pulse rounded-[8px] bg-sg-line" aria-hidden />
          </div>
        </div>
      </Card>
    );
  }
  if (activeSweeps === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sky-wash text-sg-sky" aria-hidden>
            <MoonBlanketIcon size={24} />
          </span>
          <div>
            <h2 className="text-h2">{t("home_headsup")}</h2>
            <p className="mt-1 text-body text-sg-ink-soft">{t("home_headsup_none")}</p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-clay-wash text-sg-clay" aria-hidden>
          <MoonBlanketIcon size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold text-sg-clay">{t("home_headsup")}</p>
          <h2 className="text-h2">
            {activeSweeps} {t("home_headsup_count")}
          </h2>
          <p className="mt-1 text-small text-sg-ink-soft">
            {source === "db" ? t("home_live") : t("home_demo")}
          </p>
          <div className="mt-3">
            <Link to="/sweeps" className="block">
              <Button variant="secondary">{t("home_see_sweeps")}</Button>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NearYouCard() {
  const { t } = useLanguage();
  const { push } = useToasts();
  const { resourceCount, openCount, source, loading, timedOut, retry } = useHomeStats();
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-h2">{t("home_near")}</h2>
          <p className="mt-1 text-body text-sg-ink-soft">
            {loading ? t("home_checking") : `${resourceCount} ${t("home_places")} · ${t("home_open_now")} ${openCount}`}
          </p>
          {/* 3s fetch timed out or failed after one retry → calm notice naming
           * the cached Marin essentials + one-tap retry (same budget again). */}
          {!loading && timedOut ? (
            <p className="mt-1 text-small text-sg-ink-soft">
              {t("home_slow")}{" "}
              <button
                type="button"
                onClick={retry}
                className="min-h-[44px] px-1 font-semibold text-sg-sky underline underline-offset-2"
              >
                {t("home_retry")}
              </button>
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <LocationOnceButton
          onClick={() => {
            // One-shot read, 3s budget, still user-initiated and nothing
            // stored — on timeout the list simply stays as it is.
            readLocationOnce()
              .then(() => push({ kind: "success", message: t("home_loc_ok") }))
              .catch(() => push({ kind: "info", message: t("home_loc_fail") }));
          }}
        />
        <p className="mt-3 text-small text-sg-ink-soft">
          {source === "db"
            ? t("home_live_list")
            : t("home_real_list")}
        </p>
      </div>
    </Card>
  );
}

function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn } = useAuth();
  const { push } = useToasts();
  const { t } = useLanguage();
  // A11y: BottomSheet carries the dialog's focus-move + Escape-close
  // behavior (keyboard/SR users are never stranded in the sheet).
  return (
    <BottomSheet open={open} onClose={onClose} title={t("home_si_title")}>
        <p className="text-body text-sg-ink-soft">
          {t("home_si_body")}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            full
            onClick={() => {
              signIn();
              onClose();
              push({ kind: "info", message: t("home_signed_toast") });
            }}
          >
            {t("home_signin_needed")}
          </Button>
          <Button variant="quiet" full onClick={onClose}>
            {t("home_notnow")}
          </Button>
        </div>
    </BottomSheet>
  );
}

function HomePage() {
  const { signedIn } = useAuth();
  const { t } = useLanguage();
  const [signInOpen, setSignInOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-6">
        <div className="flex flex-col items-center justify-center pt-2">
          <img
            src="/logo-hero.png"
            alt="SafeGround"
            width={220}
            height={160}
            className="h-40 w-auto object-contain"
          />
          <p className="mt-1 text-center text-small font-medium text-sg-ink-soft">{t("home_by_mprcc")}</p>
        </div>
        <Greeting />

        <HeadsUpCard />

        <Card className="border-sg-clay/60 bg-sg-clay-wash/40">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-clay text-white" aria-hidden>
              <PersonIcon size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-h2">{t("un_home_cta")}</h2>
              <p className="mt-1 text-body text-sg-ink">
                {t("un_home_sub")}
              </p>
              <Link to="/urgent-need" className="mt-3 block">
                <Button full>{t("un_home_cta")}</Button>
              </Link>
            </div>
          </div>
        </Card>

        <Card className="border-sg-sage/60 bg-sg-sage-wash/60">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sage text-white" aria-hidden>
              <PersonIcon size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-h2">{t("home_talk")}</h2>
              <p className="mt-1 text-body text-sg-ink">
                {t("home_talk_body")}
              </p>
              <Link to="/peer-support" className="mt-3 block">
                <Button full>{t("home_peer_cta")}</Button>
              </Link>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-2">
          <Link to="/help" className="block">
            <Button full>{t("home_find")}</Button>
          </Link>
          <Link to="/sweeps" className="block">
            <Button variant="secondary" full>
              {t("home_see_heads")}
            </Button>
          </Link>
          <Link to="/alerts/new" className="block">
            <Button variant="secondary" full>
              {t("home_get_help")}
            </Button>
          </Link>
          {signedIn ? (
            <Link to="/checkin" className="block">
              <Button variant="secondary" full>
                {t("home_checkin")}
              </Button>
            </Link>
          ) : (
            <div className="w-full">
              {/* A11y: no nested button — Button renders its own button;
               * the onClick lives on the Button itself. */}
              <Button variant="secondary" full disabledReason={t("home_signin_needed")} onClick={() => setSignInOpen(true)}>
                {t("home_checkin")}
              </Button>
            </div>
          )}
        </div>

        <NearYouCard />

        <footer className="flex flex-col items-start gap-2 pb-4">
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center"
          >
            {t("home_talk")}
          </button>
          <p className="text-small text-sg-ink-soft">{t("home_noloc")}</p>
        </footer>
      </div>

      <SignInSheet open={signInOpen} onClose={() => setSignInOpen(false)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/")({ component: HomePage });