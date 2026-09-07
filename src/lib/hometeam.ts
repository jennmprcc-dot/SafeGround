/**
 * SafeGround — HomeTeam needs-loop client types + copy (Wave 2b).
 * Mirrors the alerts module (src/lib/alerts.ts): serializable primitives,
 * calm trauma-informed copy, no WARNING/URGENT/MISSING/siren words.
 *
 * The privacy contract lives in the DB (RLS + the hometeam_* RPCs). These
 * types reflect what the server fns expose: any supporter may see open needs
 * and claim them ("I got that"); assign-only / private needs never carry a
 * public claim button; delivery is recorded who/what/when through
 * hometeam_complete.
 */
export type NeedStatus = "open" | "claimed" | "in_progress" | "delivered" | "fulfilled";
export type NeedVisibility = "open" | "assign_only" | "private";
export type HomeTeamMemberStatus = "active" | "paused";
export type NeedSource = "db" | "demo";

/** A supply need as it reaches the HomeTeam feed. */
export interface NeedRow {
  id: string;
  /** Items (e.g. "tent", "warm socks"). May be empty — the note carries detail. */
  items: string[];
  note: string | null;
  status: NeedStatus;
  visibility: NeedVisibility;
  /** Who logged it: first name + area (calm, no exact spot). */
  requesterLabel: string;
  /** True when outreach recorded this on someone's behalf. */
  loggedByOutreach: boolean;
  /** Supporter who claimed it ("I got that") — first name, or null. */
  claimedByName: string | null;
  claimedAt: string | null; // ISO
  /** Coordinator-assigned supporter — first name, or null. */
  assignedToName: string | null;
  assignedAt: string | null; // ISO
  /** Supporter who marked it delivered — first name, or null. */
  deliveredByName: string | null;
  deliveredAt: string | null; // ISO
  createdAt: string; // ISO
  /** true when this row is clearly labeled demo content (never live). */
  source: NeedSource;
}

/** The HomeTeam join sheet: phone + name + explicit consent (R-P1). */
export interface JoinIdentity {
  phone: string; // digits-only, E.164-normalized (sg_norm_phone shape)
  name: string; // first name / how you'd like us to say it
  /** After-hours emergency-alert consent — DEFAULT OFF (owner-directed). */
  consentsToAfterHours: boolean;
}

/** HomeTeam status for the local phone (drives join/pause affordances). */
export interface MemberStatusRow {
  phone: string;
  displayName: string | null;
  status: HomeTeamMemberStatus;
  consentsToAfterHours: boolean | null;
  source: NeedSource;
}

/** Calm labels — verbatim from the HomeTeam wireframe copy bank. */
export const NEED_STATUS_LABEL: Record<NeedStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  in_progress: "Help on the way",
  delivered: "Delivered",
  fulfilled: "Done",
};
export const NEED_VISIBILITY_LABEL: Record<NeedVisibility, string> = {
  open: "Open to anyone",
  assign_only: "Coordinator assigned",
  private: "Private",
};
/** Status badge kind mapping to UI StatusBadge palette. */
export type NeedBadgeKind = "Open" | "Progress" | "Delivered" | "Done";
export function needBadgeKind(s: NeedStatus): NeedBadgeKind {
  switch (s) {
    case "open":
      return "Open";
    case "claimed":
    case "in_progress":
      return "Progress";
    case "delivered":
      return "Delivered";
    default:
      return "Done";
  }
}
/** One line summarizing who's helping, calm and specific. */
export function needHelpingLine(n: NeedRow): string | null {
  if (n.deliveredByName) return `${n.deliveredByName.split(" ")[0]} delivered this`;
  if (n.claimedByName) return `${n.claimedByName.split(" ")[0]} is on it`;
  if (n.assignedToName) return `${n.assignedToName.split(" ")[0]} was asked to take this`;
  return null;
}
/** Demo feed (clearly labeled) — the calm fallback when the DB is unreachable. */
export function demoNeeds(): NeedRow[] {
  const now = new Date();
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  return [
    {
      id: "demo-need-1",
      items: ["tent", "sleeping bag"],
      note: "A tent that closes up tight and a warm sleeping bag — rain is coming tonight.",
      status: "open",
      visibility: "open",
      requesterLabel: "Jamie · near the skatepark",
      loggedByOutreach: false,
      claimedByName: null,
      claimedAt: null,
      assignedToName: null,
      assignedAt: null,
      deliveredByName: null,
      deliveredAt: null,
      createdAt: ago(5),
      source: "demo",
    },
    {
      id: "demo-need-2",
      items: ["phone charger"],
      note: "Need to charge a phone — anywhere with an outlet helps.",
      status: "in_progress",
      visibility: "open",
      requesterLabel: "Maya · downtown",
      loggedByOutreach: false,
      claimedByName: "a HomeTeam neighbor",
      claimedAt: ago(2),
      assignedToName: null,
      assignedAt: null,
      deliveredByName: null,
      deliveredAt: null,
      createdAt: ago(9),
      source: "demo",
    },
    {
      id: "demo-need-3",
      items: ["bus pass"],
      note: "Two bus fares for a medical appointment tomorrow morning.",
      status: "delivered",
      visibility: "open",
      requesterLabel: "Rosa · by the library",
      loggedByOutreach: false,
      claimedByName: "Lee",
      claimedAt: ago(30),
      assignedToName: null,
      assignedAt: null,
      deliveredByName: "Lee",
      deliveredAt: ago(20),
      createdAt: ago(40),
      source: "demo",
    },
  ];
}