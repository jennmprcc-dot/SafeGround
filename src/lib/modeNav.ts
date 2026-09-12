/**
 * 3-mode navigation (NAV_REFACTOR_SPEC §2–§5, §8).
 *
 * Client-only chrome: which MODE highlights, which 3 sub-nav chips show, and
 * the local-only `sg.mode` persistence. NEVER sends anything to the server;
 * NEVER grants data — server gates (outreach_roster, isRosterAdmin, analytics
 * 403) stay exactly as today. No backend changes.
 */
import type { I18nKey } from "~/lib/i18n";

export type Mode = "hometeam" | "neighbor" | "admin";

export const MODE_KEY = "sg.mode";

/** Spec §10 assumption 1: first visit defaults to NEIGHBOR. Flip this one
 * constant to "hometeam" if the owner wants their listed order to win. */
export const DEFAULT_MODE: Mode = "neighbor";

export interface SubTab {
  id: string;
  /** i18n key for the chip label (EN|ES in the dict, §7). */
  labelKey: I18nKey;
  /** Short emoji prefix rendered aria-hidden (labels stay text for SR). */
  icon: string;
  to: string;
  search?: Record<string, string>;
  /** Badge slot: which live count decorates this chip (fetched in shell). */
  badge?: "checkin" | "sweeps" | "alerts";
}

export interface ModeDef {
  id: Mode;
  labelKey: I18nKey;
  icon: string;
  home: { to: string; search?: Record<string, string> };
  tabs: SubTab[];
}

export const MODES: ModeDef[] = [
  {
    id: "hometeam",
    labelKey: "mode_hometeam",
    icon: "🤝",
    home: { to: "/hometeam" },
    // PASS 1 (2026-09-12): HomeTeam needs-queue UI decommissioned — the
    // "I Want to Help" mode keeps Give (money + soon items) and the Find
    // Help shortcut. PASS 2 adds the real offer forms + separate queues.
    tabs: [
      { id: "give", labelKey: "nav_ht_give", icon: "📦", to: "/hometeam", search: { view: "give" } },
      { id: "food", labelKey: "nav_ht_food", icon: "🍲", to: "/help", search: { cat: "food,daycenters" } },
    ],
  },
  {
    id: "neighbor",
    labelKey: "mode_neighbor",
    icon: "👤",
    home: { to: "/peer-support" },
    tabs: [
      { id: "peer", labelKey: "nav_nb_peer", icon: "💬", to: "/peer-support" },
      // PASS 2: "Request an item" → /help?view=request (form lifts to the top).
      { id: "itemreq", labelKey: "nav_nb_itemreq", icon: "🧦", to: "/help", search: { view: "request" } },
      { id: "requests", labelKey: "nav_nb_requests", icon: "📋", to: "/requests" },
      { id: "checkin", labelKey: "nav_nb_checkin", icon: "📍", to: "/checkin", badge: "checkin" },
    ],
  },
  {
    id: "admin",
    labelKey: "mode_admin",
    icon: "🔒",
    home: { to: "/outreach", search: { tab: "alerts" } },
    tabs: [
      { id: "dispatch", labelKey: "nav_ad_dispatch", icon: "🚨", to: "/outreach", search: { tab: "alerts" }, badge: "alerts" },
      // PASS 2: the donation queues live in /outreach (Offers/Needs tabs);
      // this sub-tab deep-links staff straight to the offers queue.
      { id: "donations", labelKey: "nav_ad_donations", icon: "🧺", to: "/outreach", search: { tab: "donations", queue: "offers" } },
      { id: "sweeps", labelKey: "nav_ad_sweeps", icon: "⚠️", to: "/sweeps", badge: "sweeps" },
      { id: "manage", labelKey: "nav_ad_resources", icon: "⚙️", to: "/help", search: { view: "manage" } },
    ],
  },
];

export function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "hometeam" || v === "neighbor" || v === "admin") return v;
  } catch {
    /* private mode / SSR — fall through to default */
  }
  return DEFAULT_MODE;
}

export function writeMode(m: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* non-fatal: highlight just won't persist */
  }
}

/* ── Route → mode highlight (spec §2 table + §5 deep-link rules) ──────
 * Pure function of (pathname, query) so pages and the shell agree.
 * Highlight-only: the caller must NOT overwrite sg.mode on deep links.
 * Global routes (/, /urgent-need, /privacy, /push-test) claim no mode
 * (return null mode → shell keeps whatever is stored). */

export interface RouteHint {
  mode: Mode | null;
  /** active sub-tab id within that mode, when the route maps to one */
  tab: string | null;
}

export function routeHint(pathname: string, query: Record<string, string | undefined>): RouteHint {
  const view = query.view;
  const tab = query.tab;
  // Admin-exclusive routes always highlight 🔒 (spec §5).
  if (
    pathname.startsWith("/outreach") ||
    pathname.startsWith("/peer-support-queue") ||
    pathname.startsWith("/admin/analytics")
  ) {
    if (pathname === "/outreach" || pathname.startsWith("/outreach/")) return { mode: "admin", tab: "dispatch" };
    return { mode: "admin", tab: null };
  }
  if (view === "manage") return { mode: "admin", tab: "manage" };
  switch (pathname) {
    case "/hometeam":
      // Needs tab is decommissioned (PASS 1); Give is the default sub-tab.
      return { mode: "hometeam", tab: "give" };
    case "/help":
      // PASS 2: ?view=request is the Neighbor mode's "Request an item" sub-tab;
      // the default /help stays the HomeTeam Food & Day Use shortcut.
      if (view === "request") return { mode: "neighbor", tab: "itemreq" };
      return { mode: "hometeam", tab: "food" };
    case "/peer-support":
      return { mode: "neighbor", tab: "peer" };
    case "/requests":
    case "/alerts":
    case "/alerts/new":
    case "/alerts/mine":
      return { mode: "neighbor", tab: "requests" };
    case "/checkin":
    case "/checkin/peers":
    case "/checkin/peers/invite":
      return { mode: "neighbor", tab: "checkin" };
    case "/sweeps":
      return { mode: "admin", tab: "sweeps" };
    default:
      // Global routes (/, /urgent-need, /privacy, /push-test, …) claim none.
      if (tab === "alerts" && pathname === "/outreach") return { mode: "admin", tab: "dispatch" };
      return { mode: null, tab: null };
  }
}

/** Resolve which mode to SHOW: stored mode when the deep-linked route is
 * reachable there, else the route's primary mode, else stored (§5). */
export function displayMode(stored: Mode, hint: RouteHint): Mode {
  if (!hint.mode) return stored;
  if (hint.mode === "admin") return "admin"; // exclusive — always claims
  if (stored === hint.mode) return stored;
  // Cross-mode deep link: highlight the route's primary mode (no overwrite).
  return hint.mode;
}
