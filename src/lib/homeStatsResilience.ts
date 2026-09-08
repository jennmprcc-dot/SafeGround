/**
 * Owner audit item 1 (2026-09-08): the home page's resource aggregate fetch
 * + geolocation can hang with no timeout and no retry.
 *
 * Minimal, client-safe resilience for the home page (`/`):
 * - 3s budget on the `getHomeStats` server call; on timeout OR network
 *   failure, fall back to the cached Marin essentials (`realMarinAsDemoResources`,
 *   computed on-device — nothing sent anywhere on this path, no location logged).
 * - Exactly one retry with the same 3s budget before settling on the fallback.
 * - 3s budget on the one-shot geolocation read (`timeout: 3000` — the only
 *   geolocation change; still user-initiated, still nothing stored).
 *
 * Client-safe by construction: imports only `getHomeStats` (a server fn —
 * TanStack Start routes it over HTTP, never bundles server code) plus the
 * static Marin copy. `~/db` / `pg` are never touched here (P0 lesson).
 */
import { getHomeStats } from "~/lib/server";
import type { DataSource } from "~/lib/server";
import { realMarinAsDemoResources } from "~/lib/marinFallback";

/** 3-second budget for each attempt (fetch + geolocation alike). */
export const HOME_STATS_TIMEOUT_MS = 3000;

/** Single retry after the first 3s attempt fails (same budget again). */
export const HOME_STATS_RETRIES = 1;

export interface HomeStats {
  activeSweeps: number;
  resourceCount: number;
  openCount: number;
  source: DataSource;
}

/** Race a promise against a timeout — rejects on timeout, clears the timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out — showing the saved list instead.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Cached Marin essentials → the same HomeStats shape the home page consumes.
 * Computed entirely on-device from the static copy; no network, no logging,
 * no location involved. Labeled `demo` so the UI keeps its honest
 * "Real Marin County listings" copy.
 */
export function cachedMarinHomeStats(): HomeStats {
  const rows = realMarinAsDemoResources();
  return {
    activeSweeps: 0,
    resourceCount: rows.length,
    openCount: rows.filter((r) => r.openNow).length,
    source: "demo",
  };
}

/**
 * `getHomeStats` with a 3s budget per attempt + exactly one same-budget retry.
 * Resolves to the cached Marin fallback (never rejects) on timeout or network
 * failure — callers keep rendering; they never see an error wall.
 */
export async function getHomeStatsResilient(
  timeoutMs: number = HOME_STATS_TIMEOUT_MS,
  retries: number = HOME_STATS_RETRIES,
): Promise<HomeStats> {
  let attempt = 0;
  for (;;) {
    try {
      return await withTimeout(getHomeStats(), timeoutMs);
    } catch {
      if (attempt >= retries) return cachedMarinHomeStats();
      attempt += 1;
    }
  }
}

/**
 * One-shot geolocation read with a 3s budget. Promise-shaped wrapper around
 * `getCurrentPosition` (which has no abort signal) — still user-initiated,
 * still nothing stored; rejects on timeout/unavailability so the caller keeps
 * the list as-is.
 */
export function readLocationOnce(timeoutMs: number = HOME_STATS_TIMEOUT_MS): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Location isn't available here."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out — the list stays as it is."));
      }
    }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Couldn't fetch location."));
      },
      { maximumAge: 0, timeout: timeoutMs },
    );
  });
}
