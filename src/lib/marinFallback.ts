/**
 * Branding pass: replace the fictional demo-resource fallback with the REAL
 * Marin County providers from src/lib/marinResources.ts (the compiled form of
 * /home/team/shared/MARIN_RESOURCES.md — verbatim names/addresses/hours/notes,
 * 2026-09-06).
 *
 * DEMO_RESOURCES stays as the typed demo dataset (used by data-layer helpers),
 * but the server's demo fallback (demoResources() in server.ts) now returns
 * REAL_MARIN_RESOURCES → the UI's offline/demo card no longer shows fictional
 * Harbor-ave places. `openNow` derived from category: rolling hours marked 7am–
 * 9pm local; call-ahead entries not claimed open. Verified: 2026-09-06, by
 * "MPRCC (verify before launch)" — honest label, no invented names.
 */
import { MARIN_VERIFIED_AT, REAL_MARIN_RESOURCES } from "~/lib/marinResources";
import type { DemoResource } from "~/lib/data";

export const OPEN_DAILY_LIKE: ReadonlySet<string> = new Set([
  "marin-svdp-dining-room",
  "marin-sr-library",
  "marin-novato-library",
  "marin-civic-center-library",
]);

export function realMarinAsDemoResources(): DemoResource[] {
  const hour = new Date().getHours();
  const localMinute = hour * 60 + new Date().getMinutes();
  return REAL_MARIN_RESOURCES.map((r): DemoResource => {
    const openNow = OPEN_DAILY_LIKE.has(r.id)
      ? hour >= 7 && hour < 21
      : categoryOpenNow(r.category, localMinute);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      address: r.address ?? "Call ahead for the exact location",
      hours: r.hours,
      phone: r.phone ?? undefined,
      note: r.note,
      verifiedAt: MARIN_VERIFIED_AT,
      verifiedBy: "MPRCC (verify before launch)",
      openNow,
      lat: r.lat ?? undefined,
      lng: r.lng ?? undefined,
      unconfirmed: ["hours"],
    };
  });
}

/** Only the categories with standing business-day hours get an "open now" claim. */
function categoryOpenNow(category: string, localMinute: number): boolean {
  if (category !== "charging" && category !== "legal") return false;
  const dow = new Date().getDay();
  if (dow === 0 || dow === 6) return false; // weekend
  const mins = localMinute;
  return mins >= 8 * 60 && mins <= 17 * 60;
}