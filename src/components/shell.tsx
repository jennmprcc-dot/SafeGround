/**
 * SafeGround app shell (WIREFRAMES §0): header (wordmark + [?] + [≡]),
 * bottom nav (4 tabs, night bar, sage underline), offline banner,
 * toast stack. Crisis-resources sheet lives here (every screen can reach it
 * through the menu — "Talk to someone" is always one tap away, never a trap).
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "~/lib/cn";
import { useAuth } from "~/lib/auth";
import { listSweeps, getMyCheckIn, demoUserId } from "~/lib/server";
import { BellMoonIcon, CheckIcon, HomeIcon, InfoIcon, MenuIcon, MoonIcon, NightLampIcon } from "~/lib/appIcons";
import { HeartIcon } from "~/lib/icons";
import { BottomSheet, ToastStack, useToasts } from "~/components/ui";
import type { ToastState } from "~/components/ui";

/* ── Icons for the shell ────────────────────────────────────────── */

function FindIcon(props: { size?: number }) {
  return (
    <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

const TABS = [
  { to: "/", label: "Home" },
  { to: "/help", label: "Find help" },
  { to: "/sweeps", label: "Sweeps" },
  { to: "/checkin", label: "Check in" },
] as const;

/* ── Header ─────────────────────────────────────────────────────── */

function Header({ menuOpen, onOpenMenu }: { menuOpen: boolean; onOpenMenu: () => void }) {
  const { signedIn, displayName } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-sg-line bg-sg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[640px] items-center justify-between gap-2 px-4">
        <Link to="/" className="flex min-h-[48px] items-center gap-2" aria-label="SafeGround home">
          <img src="/logo-header.png" alt="" width={26} height={20} className="h-5 w-7 object-contain" aria-hidden />
          <span className="text-btn font-semibold tracking-tight text-sg-ink">
            SafeGround <span className="font-normal text-sg-ink-soft">— by MPRCC</span>
          </span>
          {signedIn ? (
            <span className="ml-2 hidden rounded-full bg-sg-sage-wash px-2 py-0.5 text-small font-medium text-sg-sage-deep sm:inline" aria-hidden>
              {displayName}
            </span>
          ) : null}
        </Link>
        <nav className="flex items-center" aria-label="Site">
          <Link
            to="/privacy"
            className="flex min-h-[48px] min-w-[44px] items-center justify-center text-sg-ink-soft hover:text-sg-ink"
            aria-label="About and privacy"
            title="About and privacy"
          >
            <InfoIcon size={22} />
          </Link>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex min-h-[48px] min-w-[44px] items-center justify-center text-sg-ink-soft hover:text-sg-ink"
            aria-label="Menu"
          >
            <MenuIcon size={22} />
          </button>
        </nav>
        {/* Screen-reader-only heading for the shell — real H1s live per-page */}
        <span className="sr-only">SafeGround — a calm place to find help, rest, and people who care</span>
      </div>
    </header>
  );
}

/* ── Bottom nav ─────────────────────────────────────────────────── */

function BottomNav() {
  const { pathname } = useLocation();
  const { signedIn, displayName } = useAuth();
  const [sweepCount, setSweepCount] = useState<number | null>(null);
  const [selfOverdue, setSelfOverdue] = useState(false);

  // Live badges: sweep count (public read) + self-overdue dot (own check-in).
  // Both degrade calmly to no badge when the DB is unreachable.
  useEffect(() => {
    let alive = true;
    listSweeps()
      .then((r) => {
        if (alive) setSweepCount(r.rows.filter((s) => s.status === "active" || s.status === "planned").length);
      })
      .catch(() => undefined);
    if (!signedIn) {
      setSelfOverdue(false);
      return;
    }
    const userId = demoUserId(displayName, deviceToken());
    getMyCheckIn({ data: { userId } })
      .then((r) => {
        if (alive) setSelfOverdue(r.row?.overdue ?? false);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedIn, displayName]);

  const active = sweepCount ?? 0;
  const badgedSweeps = active > 9 ? "9+" : String(active);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sg-night/40 bg-sg-night pb-[env(safe-area-inset-bottom)] text-sg-card"
    >
      <div className="mx-auto flex max-w-[640px]">
        {TABS.map((tab) => {
          const isActive = tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-small transition-colors",
                isActive ? "text-sg-card" : "text-sg-card/70 hover:text-sg-card",
              )}
            >
              {isActive ? <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-sg-sage" aria-hidden /> : null}
              {tab.to === "/" && <HomeIcon size={22} />}
              {tab.to === "/help" && <FindIcon size={22} />}
              {tab.to === "/sweeps" && <BellMoonIcon size={22} />}
              {tab.to === "/checkin" && <MoonIcon size={22} />}
              <span>{tab.label}</span>
              {tab.to === "/sweeps" && active > 0 ? (
                <span className="absolute right-1/2 top-0.5 flex h-4 min-w-4 translate-x-1/2 items-center justify-center rounded-full bg-sg-clay px-1 text-[10px] font-bold text-white" aria-label={`${active} active sweeps`}>
                  {badgedSweeps}
                </span>
              ) : null}
              {tab.to === "/checkin" && selfOverdue ? (
                <span className="absolute right-1/2 top-0.5 h-2 w-2 translate-x-1/2 rounded-full bg-sg-clay" aria-label="Overdue for a check-in" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Crisis sheet (always reachable, quiet, never a trap) ───────── */

export function CrisisSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Talk to someone">
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-body text-sg-ink-soft">
          You're not alone tonight. These lines are free, private, and answered by people who listen.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="tel:988"
            className="flex min-h-[52px] items-center justify-between rounded-[12px] border border-sg-line bg-sg-card px-4 text-body font-medium text-sg-sky"
          >
            Call or text 988 — Suicide &amp; Crisis Lifeline
            <CheckIcon size={18} aria-hidden />
          </a>
          <a
            href="https://988lifeline.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] items-center justify-between rounded-[12px] border border-sg-line bg-sg-card px-4 text-body font-medium text-sg-sky"
          >
            Chat online at 988lifeline.org
            <CheckIcon size={18} aria-hidden />
          </a>
        </div>
        <p className="text-small text-sg-ink-soft">No pressure and no rush — this sheet stays here for whenever you need it.</p>
      </div>
    </BottomSheet>
  );
}

/* ── Menu sheet ─────────────────────────────────────────────────── */

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signedIn, displayName, signIn, signOut } = useAuth();
  const { push } = useToasts();
  const [crisisOpen, setCrisisOpen] = useState(false);

  return (
    <>
      <BottomSheet open={open && !crisisOpen} onClose={onClose} title="Menu">
        <nav className="flex flex-col gap-1" aria-label="Menu">
          <Link
            to="/hometeam"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <HeartIcon size={22} aria-hidden />
            HomeTeam — step in for a neighbor
          </Link>
          <Link
            to="/privacy"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            About &amp; privacy
          </Link>
          <Link
            to="/peer-support-queue"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            Peer-support queue (outreach)
          </Link>
          <Link
            to="/push-test"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            Notifications test (team)
          </Link>
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <NightLampIcon size={22} aria-hidden />
            Crisis resources
          </button>
          {signedIn ? (
            <>
              <p className="px-3 pt-1 text-small text-sg-ink-soft">Signed in as {displayName}</p>
              <button
                type="button"
                onClick={() => {
                  signOut();
                  onClose();
                  push({ kind: "info", message: "You're signed out — your saved list is still here." });
                }}
                className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-danger-gentle hover:bg-sg-paper"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                signIn();
                onClose();
                push({ kind: "success", message: "Welcome — you're signed in." });
              }}
              className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-sage-deep hover:bg-sg-paper"
            >
              Sign in
            </button>
          )}
        </nav>
      </BottomSheet>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </>
  );
}

/* ── Shell wrapper ──────────────────────────────────────────────── */

/** Stable per-device token for the demo auth wave (never leaves the browser). */
export function deviceToken(): string {
  if (typeof localStorage === "undefined") return "";
  let token = localStorage.getItem("sg.device") ?? "";
  if (!token) {
    token = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem("sg.device", token);
  }
  return token;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const { toasts, dismiss } = useToasts();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const onOff = () => setOffline(true);
    const onOn = () => setOffline(false);
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    return () => {
      window.removeEventListener("offline", onOff);
      window.removeEventListener("online", onOn);
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col bg-sg-paper">
      <Header menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      {offline ? (
        <div className="flex items-center gap-2 bg-sg-sky-wash px-4 py-2.5 text-small text-sg-sky">
          <InfoIcon size={16} aria-hidden />
          No connection — showing saved list.
        </div>
      ) : null}
      <main className="flex-1 pb-[calc(72px+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </div>
  );
}

export type { ToastState };