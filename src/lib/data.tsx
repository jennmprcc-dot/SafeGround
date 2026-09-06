/**
 * SafeGround demo data layer (typed, clearly labeled demo).
 * Fictional-but-plausible resources + sweeps for the MVP build wave.
 * Everything here is demo content — the real data will come from the
 * Supabase-ready schema (see /home/team/shared/schema.sql) when wired.
 */
import type { ReactNode } from "react";
import {
  BoltIcon,
  BowlIcon,
  CatIcon,
  DropIcon,
  MoonBlanketIcon,
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
  | "daycenters";

export interface Category {
  id: CategoryId;
  label: string; // chip label (short)
  name: string; // full name used in meta lines
  icon: ReactNode;
  wash: string; // category-tinted wash for the icon tile
}

export interface DemoResource {
  id: string;
  name: string;
  category: CategoryId;
  address: string;
  /** Optional distance in miles — set by simulated "near me" lookup in Build A. */
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
  lat: number;
  lng: number;
}

export type SweepStatus = "reported" | "active" | "planned" | "resolved";

export interface DemoSweep {
  id: string;
  title: string;
  status: SweepStatus;
  source: string; // e.g. "Reported by a neighbor · 2h ago"
  verified?: boolean;
  window: string; // e.g. "Happening now"
  note: string;
  lat: number;
  lng: number;
  distanceMi?: number;
  reportedMinutesAgo: number;
}

/* ── Categories (8, per PRD F1 / WIREFRAMES 2a) ─────────────────── */

export const CATEGORIES: Category[] = [
  { id: "food", label: "Food", name: "Food", icon: <BowlIcon size={24} />, wash: "bg-sg-sage-wash" },
  { id: "shelter", label: "Shelter", name: "Shelter & sleep", icon: <MoonBlanketIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "water", label: "Water", name: "Water", icon: <DropIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "showers", label: "Showers", name: "Restrooms & showers", icon: <ShowerIcon size={24} />, wash: "bg-sg-sage-wash" },
  { id: "clinics", label: "Clinics", name: "Health & clinics", icon: <PlusIcon size={24} />, wash: "bg-sg-clay-wash" },
  { id: "charging", label: "Charging", name: "Charging & Wi-Fi", icon: <BoltIcon size={24} />, wash: "bg-sg-gold-wash" },
  { id: "legal", label: "Legal", name: "Legal aid", icon: <ScalesIcon size={24} />, wash: "bg-sg-sky-wash" },
  { id: "daycenters", label: "Day centers", name: "Day centers", icon: <SunIcon size={24} />, wash: "bg-sg-gold-wash" },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

/* ── Demo resources (12, all 8 categories) ────────────────────────
   Fictional places in a fictional waterfront district. Verified dates
   are recent (within the last ~3 weeks). Demo — not real listings. */

export const DEMO_RESOURCES: DemoResource[] = [
  {
    id: "r-st-marys",
    name: "St. Mary's Kitchen",
    category: "food",
    address: "412 Harbor Ave",
    hours: "Mon–Fri 11am–7pm · Sat 12–6pm",
    phone: "(555) 014-2288",
    note: "No ID needed. Hot meal served 5:30–7pm. Dog-friendly patio and to-go bags.",
    verifiedAt: "2026-08-28",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8124,
    lng: -122.2742,
  },
  {
    id: "r-bayview-meals",
    name: "Bayview Community Meals",
    category: "food",
    address: "88 Cedar St (back entrance)",
    hours: "Daily breakfast 7–9am · dinner 5–7pm",
    phone: "(555) 014-7710",
    note: "Breakfast line starts at 6:45. No questions asked — everyone eats.",
    verifiedAt: "2026-08-30",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8101,
    lng: -122.2704,
  },
  {
    id: "r-harbor-night",
    name: "Harbor Night Shelter",
    category: "shelter",
    address: "201 Dock Rd",
    hours: "Open nightly 6pm–8am",
    phone: "(555) 014-5590",
    note: "Line forms at 6pm. Mats on a first-come basis. Storage bins available overnight. No same-sex checks — come as you are.",
    verifiedAt: "2026-08-25",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8159,
    lng: -122.2793,
  },
  {
    id: "r-crescent-inn",
    name: "Crescent Motel Vouchers",
    category: "shelter",
    address: "310 Crescent Way",
    hours: "Front desk 8am–10pm",
    phone: "(555) 014-9021",
    note: "Same-night motel vouchers when weather turns. Call ahead — vouchers go fast.",
    verifiedAt: "2026-08-20",
    verifiedBy: "Outreach Team Lena",
    openNow: false,
    lat: 37.8190,
    lng: -122.2631,
  },
  {
    id: "r-water-pavilion",
    name: "Water Pavilion",
    category: "water",
    address: "Pier 3, Harbor Ave",
    hours: "Always open",
    note: "Filtered bottle-fill station and hose tap. Outdoor only.",
    verifiedAt: "2026-08-31",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8110,
    lng: -122.2801,
  },
  {
    id: "r-bath-house",
    name: "Bath House",
    category: "showers",
    address: "1500 Riverside Way",
    hours: "Tue & Fri 3–7pm",
    phone: "(555) 014-3320",
    note: "Hot showers, towels and soap provided. No appointment needed.",
    verifiedAt: "2026-08-26",
    verifiedBy: "Outreach Team Lena",
    openNow: false,
    lat: 37.8135,
    lng: -122.2688,
  },
  {
    id: "r-open-gate-clinic",
    name: "Open Gate Clinic",
    category: "clinics",
    address: "77 Juniper Ave",
    hours: "Wed only, walk-ins 9am–3pm",
    phone: "(555) 014-4403",
    note: "Free walk-in care. Wound care, blood-pressure checks, prescription refills.",
    verifiedAt: "2026-08-24",
    verifiedBy: "Outreach Team Lena",
    openNow: false,
    lat: 37.8088,
    lng: -122.2755,
  },
  {
    id: "r-community-health-bus",
    name: "Community Health Bus",
    category: "clinics",
    address: "Parking lot, 4th & Cedar",
    hours: "Tue mornings 8–11am",
    phone: "(555) 014-1187",
    note: "Mobile clinic. Flu shots, foot care, and referrals. Bus has a ramp.",
    verifiedAt: "2026-09-02",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8095,
    lng: -122.2720,
  },
  {
    id: "r-lighthouse-charge",
    name: "Lighthouse Lounge",
    category: "charging",
    address: "960 Beacon St",
    hours: "Mon–Sat 9am–8pm",
    phone: "(555) 014-6654",
    note: "Indoor tables, phone charging lockers, free Wi-Fi. Staff are kind. Buy nothing — resting is okay.",
    verifiedAt: "2026-08-27",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8143,
    lng: -122.2660,
    unconfirmed: ["phone"],
  },
  {
    id: "r-harbor-wifi",
    name: "Harbor Library Wi-Fi Bench",
    category: "charging",
    address: "Corner of Harbor Ave & 6th",
    hours: "24h outdoor",
    note: "Library Wi-Fi reaches the benches outside. Power outlet on the east wall.",
    verifiedAt: "2026-08-29",
    verifiedBy: "Outreach Team Lena",
    openNow: true,
    lat: 37.8165,
    lng: -122.2770,
    unconfirmed: ["phone", "note"],
  },
  {
    id: "r-justice-clinic",
    name: "Justice Street Legal Clinic",
    category: "legal",
    address: "25 Justice St, 2nd floor",
    hours: "Thu 10am–2pm · no appointment",
    phone: "(555) 014-8122",
    note: "Free 15-minute advice. Helps with tickets, IDs, and housing questions. Takes a number, waits are calm.",
    verifiedAt: "2026-08-22",
    verifiedBy: "Outreach Team Maya",
    openNow: false,
    lat: 37.8117,
    lng: -122.2644,
  },
  {
    id: "r-morning-star",
    name: "Morning Star Day Center",
    category: "daycenters",
    address: "340 Harbor Ave",
    hours: "Daily 8am–4pm",
    phone: "(555) 014-9055",
    note: "A place to rest inside: chairs, coffee, laundry, and case workers who listen. No referral needed.",
    verifiedAt: "2026-09-01",
    verifiedBy: "Outreach Team Maya",
    openNow: true,
    lat: 37.8128,
    lng: -122.2711,
  },
  {
    id: "r-welcome-day",
    name: "Welcome Table Day Center",
    category: "daycenters",
    address: "500 Pine St",
    hours: "Sat–Sun 9am–3pm",
    note: "Weekend day center with board games, a warm floor, and snacks. Blankets welcome.",
    verifiedAt: "2026-08-19",
    verifiedBy: "Outreach Team Lena",
    openNow: false,
    lat: 37.8178,
    lng: -122.2692,
    unconfirmed: ["phone", "note"],
  },
];

/* ── Demo sweeps (for Home heads-up card + Sweeps tab later) ───── */

export const DEMO_SWEEPS: DemoSweep[] = [
  {
    id: "s-river-underpass",
    title: "River St underpass",
    status: "active",
    source: "Reported by a neighbor · 2h ago",
    verified: false,
    window: "Happening now",
    note: "Officers posted notices for Thursday cleanup along the underpass.",
    lat: 37.8100,
    lng: -122.2760,
    distanceMi: 0.6,
    reportedMinutesAgo: 120,
  },
  {
    id: "s-park-side",
    title: "Parkside, Friday 8am",
    status: "planned",
    source: "Verified by outreach · Team Maya · 1h ago",
    verified: true,
    window: "Planned · Fri 8am",
    note: "Planned clearance of the east lawn. Outreach will be on site Thursday evening with storage help.",
    lat: 37.8180,
    lng: -122.2680,
    distanceMi: 1.1,
    reportedMinutesAgo: 60,
  },
  {
    id: "s-resolved-cedar",
    title: "Cedar & 4th corner",
    status: "resolved",
    source: "Verified by outreach · Team Lena · 3d ago",
    verified: true,
    window: "Resolved",
    note: "Cleanup complete; outreach confirmed the area is clear.",
    lat: 37.8089,
    lng: -122.2704,
    distanceMi: 0.9,
    reportedMinutesAgo: 3 * 24 * 60,
  },
];

export const ACTIVE_SWEEP_COUNT = DEMO_SWEEPS.filter((s) => s.status === "active" || s.status === "planned").length;

/* ── Helpers ────────────────────────────────────────────────────── */

export function categoryOf(id: CategoryId): Category {
  return CATEGORY_MAP[id];
}

export function resourceOpenCount(resources: DemoResource[]): number {
  return resources.filter((r) => r.openNow).length;
}

/** Simulated "use my location once" — returns a synthetic near-me point. */
export function demoNearMePoint() {
  return { lat: 37.8135, lng: -122.2731 };
}

/** Rough haversine-ish distance in miles for demo points (Build A stands in for real geocoding). */
export function approxDistanceMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 69;
  const dLng = (b.lng - a.lng) * 69 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function withDemoDistances(resources: DemoResource[], from: { lat: number; lng: number }): DemoResource[] {
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