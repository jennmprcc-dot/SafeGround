/**
 * Outreach dashboard sub-tabs — ONE source of truth (owner-reported 2026-09-16:
 * "the admin dash still glitches when i try to open the needs").
 *
 * The dashboard panel is driven by the URL query only. Both the header
 * sub-tab chips (shell.tsx / modeNav routeHint) and the in-page tab bar
 * (outreach.tsx) navigate to the canonical URL for a tab, and resolveTab()
 * turns any URL back into the panel to show. Keeping the pure mapping +
 * resolver in this module (no React, no router imports) means the page, the
 * shell chips and a test script all read the SAME table.
 *
 * Canonical URLs:
 *   sweeps     → /outreach?tab=sweeps
 *   alerts     → /outreach?tab=alerts          (Dispatch chip)
 *   offers     → /outreach?tab=donations&queue=offers   (Donations chip)
 *   needs      → /outreach?tab=donations&queue=requests (Donations chip)
 *   volunteers → /outreach?tab=volunteers
 *   more       → /outreach?tab=more
 */

export type OutreachTab = "sweeps" | "alerts" | "offers" | "needs" | "volunteers" | "more";

/** Pure resolver for the dashboard tab from the URL query. Same fallback
 * semantics as the original mount-only resolution ("sweeps" when no valid tab):
 * tab=alerts|sweeps|more|volunteers pass through; tab=offers|needs pass through
 * (Pass 2 queue deep links); tab=donations resolves to the Offers queue unless
 * queue=requests (the Needs/request queue). Module-level so first paint, the
 * URL-sync effect and the in-page nav all use the exact same function. */
export function resolveTab(search: { tab?: string; queue?: string }): OutreachTab {
  const q = search.tab;
  if (q === "alerts" || q === "sweeps" || q === "more" || q === "volunteers" || q === "offers" || q === "needs") return q;
  if (q === "donations") return search.queue === "requests" ? "needs" : "offers";
  return "sweeps";
}

/** Canonical URL search params for each in-page tab button. The in-page bar
 * NAVIGATES here (never just setTab) so the URL, the panel, the in-page
 * highlight and the header chip highlight can never disagree. */
export const DASH_TAB_URL: Record<OutreachTab, { tab: string; queue?: string }> = {
  sweeps: { tab: "sweeps" },
  alerts: { tab: "alerts" },
  offers: { tab: "donations", queue: "offers" },
  needs: { tab: "donations", queue: "requests" },
  volunteers: { tab: "volunteers" },
  more: { tab: "more" },
};
