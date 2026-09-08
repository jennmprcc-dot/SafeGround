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
/* Owner-directed 2026-09-07 (Option A): the DB-unreachable needs fallback is an
 * honest EMPTY list — never fabricated needs with invented names/places.
 * The feed renders its calm "No open needs right now" empty state instead
 * of fiction. Kept as a named function so the call site stays readable. */
export function demoNeeds(): NeedRow[] {
  return [];
}