/**
 * SafeGround app shell (WIREFRAMES §0 + NAV_REFACTOR_SPEC §4): sticky header
 * Row 1 (brand + lang + urgent + info + More), Row 2 (3-segment MODE selector),
 * Row 3 (sub-nav chips for the active mode), privacy microcopy, offline banner,
 * toast stack. Crisis-resources sheet stays one tap away from every mode.
 *
 * Mode state: derived from the URL via routeHint() + localStorage["sg.mode"]
 * (readMode/writeMode). Deep links only HIGHLIGHT — sg.mode is overwritten on
 * user tap only (spec §5). Server gates untouched; this is client chrome only.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate, useRouterState } from "@tanstack/react-router";
import { cn } from "~/lib/cn";
import { useAuth } from "~/lib/auth";
import { useLanguage } from "~/lib/i18n";
import { listSweeps, getMyCheckIn, listTrustedPeers, demoUserId } from "~/lib/server";
import { BellMoonIcon, CheckIcon, InfoIcon, MenuIcon } from "~/lib/appIcons";
import { BottomSheet, ToastStack, useToasts } from "~/components/ui";
import { OPEN_WELCOME_EVENT } from "~/components/welcome";
import type { ToastState } from "~/components/ui";
import { MODES, displayMode, readMode, routeHint, writeMode } from "~/lib/modeNav";
import type { Mode, ModeDef, SubTab } from "~/lib/modeNav";

/* ── EN|ES segmented toggle (PR-B) — calm two-state control in the
 * header, persisted to localStorage (`sg.lang`). EN is always the
 * fallback so nothing ever renders blank. */
export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <div
      className="flex items-center rounded-full border border-sg-line bg-sg-card p-0.5"
      role="group"
      aria-label="Language / Idioma"
    >
      {(["en", "es"] as const).map((l) => {
        const on = lang === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={on}
            aria-label={l === "en" ? "English" : "Español"}
            className={cn(
              "flex min-h-[40px] min-w-[44px] items-center justify-center rounded-full px-2.5 text-small font-semibold transition-colors",
              on ? "bg-sg-sage text-white" : "text-sg-ink-soft hover:text-sg-ink",
            )}
          >
            {l === "en" ? "EN" : "ES"}
          </button>
        );
      })}
    </div>
  );
}

/* ── Roving tablist (spec §6 — ViewTabs pattern from help.tsx) ──────────
 * ArrowLeft/Right (+Up/Down, Home/End) moves selection+focus on keyboard;
 * pointer/tap activates via onClick WITHOUT moving focus — EXCEPT the mode
 * selector, where switching modes replaces the whole sub-nav + content
 * region, so focus moves to the new sub-nav's selected tab (spec §6). */

/* ── Mode navigation (Rows 2 + 3) ─────────────────────────────────────── */

function TabAnchor({
  refCb,
  tabId,
  active,
  tabIndex,
  onSelect,
  onKey,
  chip,
  to,
  search,
  children,
}: {
  refCb: (el: HTMLAnchorElement | null) => void;
  tabId: string;
  active: boolean;
  tabIndex: number;
  onSelect: () => void;
  onKey: (e: ReactKeyboardEvent<HTMLAnchorElement>) => void;
  chip?: boolean;
  to: string;
  search?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Link
      ref={refCb}
      id={tabId}
      to={to}
      search={search}
      role="tab"
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKey}
      className={cn(
        chip
          ? "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-btn font-medium transition-colors"
          : "flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-[10px] px-1 text-btn font-medium transition-colors",
        active
          ? chip
            ? "border-sg-sage bg-sg-sage text-white"
            : "bg-sg-sage text-white"
          : chip
            ? "border-sg-line bg-sg-card text-sg-ink-soft hover:text-sg-ink"
            : "text-sg-ink-soft hover:text-sg-ink",
      )}
    >
      {children}
    </Link>
  );
}

function useModeNavBadges(activeMode: Mode) {
  const { signedIn, displayName } = useAuth();
  const [openNeeds, setOpenNeeds] = useState<number | null>(null);
  const [sweepCount, setSweepCount] = useState<number | null>(null);
  const [selfOverdue, setSelfOverdue] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    // Needs Queue badge (HomeTeam ❤️) + alerts badge (Admin 🚨) share the
    // outreach summary counts; sweeps badge is the public listSweeps read.
    // Everything degrades silently when the DB is unreachable (spec §8).
    if (activeMode === "hometeam" || activeMode === "admin") {
      fetch("/api/outreach/summary?phone=")
        .then((r) => (r.ok ? r.json().catch(() => null) : null))
        .then((d: { ok?: boolean; counts?: { openNeeds?: number; activeAlerts?: number } } | null) => {
          if (!alive || !d?.ok) return;
          if (typeof d.counts?.openNeeds === "number") setOpenNeeds(d.counts.openNeeds);
          if (typeof d.counts?.activeAlerts === "number") setActiveAlerts(d.counts.activeAlerts);
        })
        .catch(() => undefined);
    }
    if (activeMode === "admin") {
      listSweeps()
        .then((r) => {
          if (alive) setSweepCount(r.rows.filter((s) => s.status === "active" || s.status === "planned").length);
        })
        .catch(() => undefined);
    }
    if (activeMode === "neighbor" && signedIn) {
      const userId = demoUserId(displayName, deviceToken());
      getMyCheckIn({ data: { userId } })
        .then((r) => {
          if (alive) setSelfOverdue(r.row?.overdue ?? false);
        })
        .catch(() => undefined);
      listTrustedPeers({ data: { userId } })
        .then((r) => {
          if (alive) setIncomingInvite(r.rows.some((p) => p.status === "pending" && p.direction === "in"));
        })
        .catch(() => undefined);
    } else {
      setSelfOverdue(false);
      setIncomingInvite(false);
    }
    return () => {
      alive = false;
    };
  }, [activeMode, signedIn, displayName]);

  return { openNeeds, sweepCount, selfOverdue, incomingInvite, activeAlerts };
}

function ModeNav() {
  const { pathname } = useLocation();
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, string | undefined>;
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [stored, setStored] = useState<Mode>(() => readMode());
  const [focusSignal, setFocusSignal] = useState(0);
  const [announce, setAnnounce] = useState("");

  const query: Record<string, string | undefined> = {
    view: typeof search.view === "string" ? search.view : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    cat: typeof search.cat === "string" ? search.cat : undefined,
  };
  const hint = routeHint(pathname, query);
  const shown = displayMode(stored, hint);
  const modeDef = MODES.find((m) => m.id === shown) ?? MODES[1];
  const badges = useModeNavBadges(shown);

  const pickMode = (m: Mode, opts?: { moveFocus?: boolean }) => {
    setStored(m);
    writeMode(m); // persist on tap only — never on deep-link highlight (§5)
    onModeAnnounce(m);
    const def = MODES.find((d) => d.id === m);
    if (def) void navigate({ to: def.home.to, search: def.home.search });
    // Owner QA 2026-09-09: switching modes lands at the top (fixes clunk).
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
    if (opts?.moveFocus) {
      setFocusSignal((n) => n + 1);
      // Spec §6: announce the new mode + its sub-nav via role=status.
      const name = t(def?.labelKey ?? "mode_neighbor");
      const subs = def?.tabs.map((s) => t(s.labelKey)).join(", ") ?? "";
      setAnnounce(t("mode_status").replace("{mode}", `${name} — ${subs}`));
    }
  };

  const modeIds = MODES.map((m) => m.id);
  const modeRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const onModeKey = (e: ReactKeyboardEvent<HTMLAnchorElement>) => {
    const cur = modeRefs.current.indexOf(e.currentTarget);
    if (cur === -1) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % modeIds.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (cur - 1 + modeIds.length) % modeIds.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = modeIds.length - 1;
    if (next !== null) {
      e.preventDefault();
      modeRefs.current[next]?.focus();
      pickMode(modeIds[next]); // keyboard: selection follows focus (§6)
    }
  };

  // Sub-tab keyboard: selection follows focus; pointer taps don't move focus.
  const subRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const onSubKey = (e: ReactKeyboardEvent<HTMLAnchorElement>) => {
    const cur = subRefs.current.indexOf(e.currentTarget);
    if (cur === -1) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % modeDef.tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (cur - 1 + modeDef.tabs.length) % modeDef.tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = modeDef.tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      const dest = modeDef.tabs[next];
      subRefs.current[next]?.focus();
      void navigate({ to: dest.to, search: dest.search });
    }
  };
  // Spec §6: on mode switch move focus to the new sub-nav's selected tab.
  useEffect(() => {
    if (focusSignal === 0) return;
    const i = Math.max(0, modeDef.tabs.findIndex((s) => s.id === activeSubId(hint, modeDef)));
    subRefs.current[i]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const activeSub = activeSubId(hint, modeDef);

  const badgeFor = (s: SubTab): ReactNode => {
    if (s.badge === "needs" && (badges.openNeeds ?? 0) > 0) {
      const n = badges.openNeeds ?? 0;
      return (
        <>
          <span aria-hidden className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sg-clay px-1 text-[10px] font-bold text-white">
            {n > 9 ? "9+" : String(n)}
          </span>
          <span className="sr-only" role="status">{n} open needs</span>
        </>
      );
    }
    if (s.badge === "sweeps" && (badges.sweepCount ?? 0) > 0) {
      const n = badges.sweepCount ?? 0;
      return (
        <>
          <span aria-hidden className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sg-clay px-1 text-[10px] font-bold text-white">
            {n > 9 ? "9+" : String(n)}
          </span>
          <span className="sr-only" role="status">{n} active sweeps</span>
        </>
      );
    }
    if (s.badge === "alerts" && (badges.activeAlerts ?? 0) > 0) {
      const n = badges.activeAlerts ?? 0;
      return (
        <>
          <span aria-hidden className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sg-clay px-1 text-[10px] font-bold text-white">
            {n > 9 ? "9+" : String(n)}
          </span>
          <span className="sr-only" role="status">{n} active alerts</span>
        </>
      );
    }
    if (s.badge === "checkin" && (badges.selfOverdue || badges.incomingInvite)) {
      return (
        <>
          <span aria-hidden className="h-2 w-2 rounded-full bg-sg-clay" />
          <span className="sr-only" role="status">
            {badges.selfOverdue ? "Overdue for a check-in" : "New peer invite"}
          </span>
        </>
      );
    }
    return null;
  };

  return (
    <div className="border-t border-sg-line/70">
      {/* Spec §6: mode announcements (polite, sr-only). */}
      <p role="status" className="sr-only">{announce}</p>
      {/* Row 2 — mode selector */}
      <div className="mx-auto max-w-[640px] pt-2 sm:flex sm:items-center sm:gap-2 sm:px-4">
        <p id="mode-label" className="sr-only">{t("mode_label")}</p>
        <div role="tablist" aria-labelledby="mode-label" className="mx-4 flex rounded-[12px] border border-sg-line bg-sg-card p-1 sm:mx-0 sm:flex-1">
          {MODES.map((m, i) => {
            const active = m.id === shown;
            // Owner QA 2026-09-09: per-mode accent on the ACTIVE segment so
            // HomeTeam vs Neighbor vs Admin feel unmistakable at the top.
            // HomeTeam = warm green (sage), Neighbor = sky blue, Admin = dark
            // ink (all existing tokens; white text stays AA on each).
            const activeAccent =
              m.id === "hometeam"
                ? "bg-sg-sage text-white"
                : m.id === "neighbor"
                  ? "bg-sg-sky text-white"
                  : "bg-sg-night text-white";
            return (
              <Link
                key={m.id}
                ref={(el) => {
                  modeRefs.current[i] = el;
                }}
                id={`mode-tab-${m.id}`}
                to={m.home.to}
                search={m.home.search}
                role="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                tabIndex={active ? 0 : -1}
                onClick={(e) => {
                  e.preventDefault();
                  pickMode(m.id, { moveFocus: true });
                }}
                onKeyDown={onModeKey}
                className={cn(
                  "flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-[10px] px-1 text-btn font-medium transition-colors",
                  active ? activeAccent : "text-sg-ink-soft hover:text-sg-ink",
                )}
              >
                <span aria-hidden>{m.icon}</span>
                <span>{t(m.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </div>
      {/* Row 3 — sub-nav chips for the active mode */}
      <nav aria-label={t(modeDef.labelKey)} className="mx-auto max-w-[640px] sm:flex sm:justify-end sm:px-4">
        <div role="tablist" aria-label={`${t(modeDef.labelKey)} — ${t("mode_label")}`} className="flex gap-2 overflow-x-auto px-4 py-2">
          {modeDef.tabs.map((s, i) => {
            const active = s.id === activeSub;
            return (
              <TabAnchor
                key={s.id}
                refCb={(el) => {
                  subRefs.current[i] = el;
                }}
                tabId={`sub-tab-${modeDef.id}-${s.id}`}
                active={active}
                tabIndex={active ? 0 : -1}
                onSelect={() => undefined}
                onKey={onSubKey}
                chip
                to={s.to}
                search={s.search}
              >
                <span aria-hidden>{s.icon}</span>
                <span>{t(s.labelKey)}</span>
                {badgeFor(s)}
              </TabAnchor>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function activeSubId(
  hint: { mode: Mode | null; tab: string | null },
  modeDef: ModeDef,
): string {
  if (hint.tab && modeDef.tabs.some((s) => s.id === hint.tab)) return hint.tab;
  return modeDef.tabs[0].id;
}

/* ── Header ─────────────────────────────────────────────────────── */

function Header({
  menuOpen,
  onOpenMenu,
}: {
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const { signedIn, displayName } = useAuth();
  const { t } = useLanguage();
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
          <LanguageToggle />
          {/* Owner-directed 2026-09-08: calm one-tap urgent-need action in
              the header — opens /urgent-need, sends nothing by itself. */}
          <Link
            to="/urgent-need"
            className="flex min-h-[48px] items-center rounded-full bg-sg-clay px-3 text-small font-semibold text-white hover:opacity-90"
            aria-label={t("un_home_cta")}
            title={t("un_home_cta")}
          >
            {t("un_home_cta")}
          </Link>
          <Link
            to="/privacy"
            className="flex min-h-[48px] min-w-[44px] items-center justify-center text-sg-ink-soft hover:text-sg-ink"
            aria-label={t("menu_about")}
            title={t("menu_about")}
          >
            <InfoIcon size={22} />
          </Link>
          <button
            type="button"
            onClick={onOpenMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className="flex min-h-[48px] min-w-[44px] items-center justify-center text-sg-ink-soft hover:text-sg-ink"
            aria-label={t("nav_more")}
          >
            <MenuIcon size={22} />
          </button>
        </nav>
      </div>
      {/* Privacy microcopy (spec §4): one calm line, not a banner. */}
      <p className="mx-auto max-w-[640px] px-4 pb-1 text-small text-sg-ink-soft">{t("privacy_micro")}</p>
      <ModeNav />
    </header>
  );
}

/* ── Crisis sheet (always reachable, quiet, never a trap) ───────── */

export function CrisisSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("crisis_title")}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-body text-sg-ink-soft">
          {t("crisis_intro")}
        </p>
        {/* MPRCC Safe Team: one-tap in-app peer-support request — never 911. */}
        <div className="rounded-[12px] border border-sg-sage/60 bg-sg-sage-wash/60 p-4">
          <h3 className="text-h2">{t("crisis_safe_title")}</h3>
          <p className="mt-1 text-small text-sg-ink-soft">{t("crisis_safe_body")}</p>
          <Link
            to="/peer-support"
            onClick={onClose}
            className="mt-3 flex min-h-[52px] items-center justify-center rounded-[12px] bg-sg-sage px-4 text-body font-semibold text-white"
          >
            {t("crisis_safe_cta")}
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href="tel:988"
            className="flex min-h-[52px] items-center justify-between rounded-[12px] border border-sg-line bg-sg-card px-4 text-body font-medium text-sg-sky"
          >
            {t("crisis_call")}
            <CheckIcon size={18} aria-hidden />
          </a>
          <a
            href="https://988lifeline.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] items-center justify-between rounded-[12px] border border-sg-line bg-sg-card px-4 text-body font-medium text-sg-sky"
          >
            {t("crisis_chat")}
            <CheckIcon size={18} aria-hidden />
          </a>
        </div>
        <p className="text-small text-sg-ink-soft">{t("crisis_outro")}</p>
      </div>
    </BottomSheet>
  );
}

/* ── More sheet (spec §4 — replaces the menu sheet's nav role) ──────────
 * Everything not in the 3×3 grid lives here so nothing is ever unreachable:
 * /alerts/new, /alerts/mine, /privacy, welcome, /push-test, crisis resources,
 * sign-in/out block. No mode chrome changes on other routes. */

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signedIn, displayName, signIn, signOut } = useAuth();
  const { push } = useToasts();
  const { t } = useLanguage();
  const [crisisOpen, setCrisisOpen] = useState(false);

  return (
    <>
      <BottomSheet open={open && !crisisOpen} onClose={onClose} title={t("nav_more")}>
        <nav className="flex flex-col gap-1" aria-label="More">
          <Link
            to="/alerts/new"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <BellMoonIcon size={22} aria-hidden />
            Send an alert
          </Link>
          <Link
            to="/alerts/mine"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <CheckIcon size={22} aria-hidden />
            My alerts
          </Link>
          <Link
            to="/privacy"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            {t("menu_about")}
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              window.dispatchEvent(new Event(OPEN_WELCOME_EVENT));
            }}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            {t("menu_welcome")}
          </button>
          <Link
            to="/push-test"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <InfoIcon size={22} aria-hidden />
            {t("menu_notify")}
          </Link>
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-ink hover:bg-sg-paper"
          >
            <CheckIcon size={22} aria-hidden />
            {t("menu_crisis")}
          </button>
          {signedIn ? (
            <>
              <p className="px-3 pt-1 text-small text-sg-ink-soft">{t("menu_signed_in_as")} {displayName}</p>
              <button
                type="button"
                onClick={() => {
                  signOut();
                  onClose();
                  push({ kind: "info", message: "You're signed out — your saved list is still here." });
                }}
                className="flex min-h-[52px] items-center gap-3 rounded-[12px] px-3 text-body text-sg-danger-gentle hover:bg-sg-paper"
              >
                {t("menu_signout")}
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
              {t("menu_signin")}
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
      {/* A11y: skip link — first focusable element, visible on focus. */}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:min-h-[48px] focus:items-center focus:rounded-[12px] focus:bg-sg-card focus:px-4 focus:font-semibold focus:text-sg-sky focus:shadow-md">
        Skip to content
      </a>
      <Header menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      {offline ? (
        <div role="status" className="flex items-center gap-2 bg-sg-sky-wash px-4 py-2.5 text-small text-sg-sky">
          <InfoIcon size={16} aria-hidden />
          No connection — showing saved list.
        </div>
      ) : null}
      <main id="main" className="flex-1 pb-[env(safe-area-inset-bottom)]">{children}</main>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <MoreSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </div>
  );
}

export type { ToastState };