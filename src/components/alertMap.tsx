/**
 * Alert location visuals (Wave 2a) — calm map panes per granularity.
 * The DB never serves exact coords to non-entitled viewers; the UI here ALSO
 * refuses to render a pin or circle from exactLat/exactLng unless
 * `canSeeExact` is true — a double guard (deliverable #5).
 *
 * These are backstop panes (no Mapbox key on free tier), matching the existing
 * Sweeps/Check-Ins pattern: warm sky wash + pins over an illustrated base.
 */
import type { AlertRow } from "~/lib/alerts";
import { MapPinIcon, LockIcon } from "~/lib/icons";

/** Exact-visibility line (spec §Receive/help) — only under exact. */
export const EXACT_VISIBILITY_LINE =
  "exact — only you, your people + staff; gone when it closes";

export function AlertMapPane({ alert }: { alert: AlertRow }) {
  const { location, canSeeExact, fuzzLat, fuzzLng, exactLat, exactLng } = alert;

  if (location === "none") {
    return (
      <div className="flex h-[140px] flex-col items-center justify-center gap-1 rounded-[16px] border border-sg-line bg-sg-sky-wash px-4 text-center">
        <span className="text-sg-ink-soft" aria-hidden><LockIcon size={20} /></span>
        <p className="text-small text-sg-ink-soft">No location shared — the words above are everything.</p>
      </div>
    );
  }

  const showExactPin = location === "exact" && canSeeExact && exactLat != null && exactLng != null;
  // Fuzzed point (or exact point rounded for the viewer who may see it) drives the pin.
  const hasPoint = (location === "exact" ? showExactPin : fuzzLat != null && fuzzLng != null);

  return (
    <div className="relative flex h-[180px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(42,107,138,0.14) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)",
          backgroundSize: "26px 26px, 40px 40px, 100% 100%",
        }}
      />
      {hasPoint ? (
        <>
          {location === "fuzzed" || (location === "exact" && !showExactPin) ? (
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-sg-sage/60 bg-sg-sage/10"
            />
          ) : null}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-sg-sage shadow-md ring-2 ring-sg-sage/25"
          >
            <MapPinIcon size={14} className="text-white" />
          </span>
          {/* legend */}
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-sg-card px-3 py-1.5 text-small font-medium text-sg-ink shadow-md">
            <span className="h-2.5 w-2.5 rounded-full bg-sg-sage" aria-hidden />
            {location === "exact" && showExactPin ? "Exact spot" : "Approximate area"}
          </span>
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-sg-card px-3 py-1.5 text-small text-sg-ink-soft shadow-md">
            <LockIcon size={14} aria-hidden />
            {location === "exact" && showExactPin ? "exact, private" : "~150m"}
          </span>
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="max-w-[240px] text-center text-small text-sg-ink-soft">
            {location === "fuzzed" ? "An approximate area was shared." : "The exact spot is being kept private."}
          </p>
        </div>
      )}
    </div>
  );
}

/** Get directions — ONLY when granularity is exact AND the viewer may see it.
 * Opens the phone's own Maps app (geo:/maps.apple.com intents), never in-app nav. */
export function getDirectionsHref(lat: number, lng: number): string {
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) return `maps.apple.com/?daddr=${lat},${lng}`;
  return `geo:${lat},${lng}?q=${lat},${lng}(spot)`;
}

export function GetDirectionsButton({ alert }: { alert: AlertRow }) {
  const canNav = alert.location === "exact" && alert.canSeeExact && alert.exactLat != null && alert.exactLng != null;
  if (!canNav) return null;
  return (
    <a
      href={getDirectionsHref(alert.exactLat as number, alert.exactLng as number)}
      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[12px] bg-sg-sage px-4 text-btn text-white transition-colors hover:bg-sg-sage-deep"
      aria-label="Get directions — opens your phone's Maps with turn-by-turn"
    >
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 11 21 3l-8 18-2.5-7.5L3 11z" />
      </svg>
      Get directions
      <span className="sr-only">Opens your phone's Maps with turn-by-turn</span>
    </a>
  );
}