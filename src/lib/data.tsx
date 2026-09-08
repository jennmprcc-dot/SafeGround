/**
 * SafeGround shared data layer (typed UI contract — real data only).
 *
 * Owner-directed 2026-09-07 (Option A): the live app starts with REAL data
 * only. There is NO fictional seed content in this module — no invented
 * people, places, or events. Resource rows come from the live database
 * (seeded from REAL_MARIN_RESOURCES in src/lib/marinResources.ts); sweeps,
 * needs, peers, and alerts come from their live tables. When the database is
 * unreachable, server fns return honest empty states (never fabricated rows).
 *
 * What lives here: category taxonomy, the DemoResource view type (the shape
 * the Navigator UI consumes — rows are real), pure geo math, and calm labels.
 */
import type { ReactNode } from "react";
import {
  BoltIcon,
  BowlIcon,
  CatIcon,
  DropIcon,
  HeartIcon,
  MoonBlanketIcon,
  NavigateIcon,
  PersonIcon,
  PlusIcon,
  ScalesIcon,
  ShowerIcon,
  SunIcon,
} from "~/lib/icons";

/* ── Types ─────────────────────────────────────────────────────── */

export type CategoryId =
  | "food"
  | "shelter"
  | "water"
  | "showers"
  | "clinics"
  | "charging"
  | "legal"
  | "daycenters"
  | "transportation"
  | "emergency";

export interface Category {
  id: CategoryId;
  label: string; // chip label (short)
  name: string; // full name used in meta lines
  icon: ReactNode;
  wash: string; // category-tinted wash for the icon tile
}

/** A resource as the Navigator UI consumes it. Rows are REAL — from the live
 * database (or the real-Marin offline copy); never invented. */
export interface DemoResource {
  id: string;
  name: string;
  category: CategoryId;
  address: string;
  /** Optional distance in miles — set by the "near me" lookup from the user's
   * real one-time location read. */
  distanceMi?: number;
  hours: string;
  phone?: string;
  /** What to expect — plain-language, calm. */
  note: string;
  /** Fields that haven't been confirmed yet — UI renders "Not confirmed yet — call ahead if you can". */
  unconfirmed?: Array<"address" | "hours" | "phone" | "note">;
  verifiedAt: string; // ISO date, e.g. "2026-08-28"
  verifiedBy: string; // outreach team or "outreach"
  openNow: boolean;
  /** Map pin — null/absent when the location isn't confirmed (no invented pins). */
  lat?: number;
  lng?: number;
}

/* ── Categories (10, per PRD F1 / WIREFRAMES 2a) ────────────────── */

export const CATEGORIES: Category[] = [
  { id: "food", label: "Food", name: "Food", icon: <BowlIcon size={24} />, wash: "bg-sg-sage-wash" },
  { id: "shelter", label: "Shelter", name: "Shelter & sleep", icon: <MoonBlanketIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "water", label: "Water", name: "Water", icon: <DropIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "showers", label: "Showers", name: "Restrooms & showers", icon: <ShowerIcon size={24} />, wash: "bg-sg-sage-wash" },
  { id: "clinics", label: "Clinics", name: "Health & clinics", icon: <PlusIcon size={24} />, wash: "bg-sg-clay-wash" },
  { id: "charging", label: "Charging", name: "Charging & Wi-Fi", icon: <BoltIcon size={24} />, wash: "bg-sg-gold-wash" },
  { id: "legal", label: "Legal", name: "Legal aid", icon: <ScalesIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "daycenters", label: "Day centers", name: "Day centers", icon: <SunIcon size={24} />, wash: "bg-sg-gold-wash" },
  { id: "transportation", label: "Rides", name: "Transportation & rides", icon: <NavigateIcon size={24} />, wash: "bg-sg-sky-wash" },
  // Calm burnt-clay (never alarm red) — mobile crisis teams, no police unless asked.
  { id: "emergency", label: "Crisis help", name: "Crisis response", icon: <HeartIcon size={24} />, wash: "bg-sg-clay-wash" },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

/* ── Helpers ────────────────────────────────────────────────────── */

export function categoryOf(id: CategoryId): Category {
  return CATEGORY_MAP[id];
}

/** Rough haversine-ish distance in miles between two real points.
 * Rows without a confirmed pin get undefined (never a fake distance). */
export function approxDistanceMi(a: { lat: number; lng: number }, b: { lat?: number; lng?: number }): number | undefined {
  if (b.lat === undefined || b.lng === undefined) return undefined;
  const dLat = (b.lat - a.lat) * 69;
  const dLng = (b.lng - a.lng) * 69 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function withDistances(resources: DemoResource[], from: { lat: number; lng: number }): DemoResource[] {
  return resources.map((r) => ({ ...r, distanceMi: approxDistanceMi(from, r) }));
}

/** "Verified Mar 3" style date, CALM (never "URGENT"/"stale"). */
export function verifiedLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const PAGE_TAGLINE: Record<string, string> = {
  help: "Find food, rest, and care — no account needed.",
  sweeps: "Heads-ups from neighbors, kept calm.",
  checkin: "Check in when you're ready — no rush.",
};

export const PersonGlyph = PersonIcon;
export const CatGlyph = CatIcon;
