/**
 * Shared peer-support server helpers (owner-directed 2026-09-06).
 * Urgent-need action (owner-directed 2026-09-08) reuses this module: urgent
 * needs ride the same peer_support_requests queue + the same admin push fan-out.
 *
 * SAFETY CONTRACT (non-negotiable):
 *  - Push goes ONLY to the two roster admins (PEER_SUPPORT_ADMIN_PHONES —
 *    Jenn + Bambi) via the tokens they registered. Never 911, never any
 *    agency, never SMS, never the requester themself.
 *  - The queue is roster-admin-gated server-side via isRosterAdmin(caller) —
 *    never client trust. isRosterAdmin degrades gracefully (try/catch →
 *    not-admin), so a missing outreach_roster table never crashes.
 *  - The request row persists even when no admin token is registered yet
 *    (push is best-effort); the caller gets a calm confirmation either way.
 *  - Admin sends are NOT business-hours-gated (admins are on call). Any
 *    future HomeTeam-facing notice would be — not in this feature.
 */
import { sql } from "~/db";
import {
  PEER_SUPPORT_ADMIN_PHONES,
  sendFcmMessage,
  tokensForPhone,
} from "~/lib/pushServer";

export const normPhone = (raw: unknown): string =>
  String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 20);

export const MISSING_TABLE_MSG =
  "Peer-support requests aren't live in the database yet — the next database update adds them. Your tap was heard; please reach out to the MPRCC team directly for now.";

/** Graceful table check — true when peer_support_requests exists. Never throws. */
export async function peerSupportTableReady(): Promise<boolean> {
  try {
    const rows = (await sql()`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'peer_support_requests'
      limit 1`) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/* ── Fan-out: push ONLY to the two admins ─────────────────────────
 * The ONLY dispatch in this feature. Iterates the two admin phones, looks
 * up their registered tokens, sends. The requester is never a target. */
/* Owner-listed categories (2026-09-08; ER supplies added after the initial
 * brief). Must stay exactly these five strings. */
export type UrgentNeedCategory = "help" | "advocacy" | "er_ride" | "er_supplies" | "support";

export const URGENT_NEED_CATEGORIES: ReadonlyArray<UrgentNeedCategory> = [
  "help",
  "advocacy",
  "er_ride",
  "er_supplies",
  "support",
];

export function isUrgentNeedCategory(raw: unknown): raw is UrgentNeedCategory {
  return (
    raw === "help" ||
    raw === "advocacy" ||
    raw === "er_ride" ||
    raw === "er_supplies" ||
    raw === "support"
  );
}

export type UrgentNeedLocation = "none" | "fuzzed" | "exact";

export function isUrgentNeedLocation(raw: unknown): raw is UrgentNeedLocation {
  return raw === "none" || raw === "fuzzed" || raw === "exact";
}

export async function fanOutToAdmins(
  displayName: string,
  opts?: { urgentCategory?: UrgentNeedCategory | null },
): Promise<{ notifiedPhones: number; tokensSent: number }> {
  let notifiedPhones = 0;
  let tokensSent = 0;
  for (const adminPhone of PEER_SUPPORT_ADMIN_PHONES) {
    let tokens: string[] = [];
    try {
      tokens = await tokensForPhone(adminPhone);
    } catch {
      continue; // push_tokens missing/unreachable — queue still persists
    }
    if (tokens.length === 0) continue;
    notifiedPhones += 1;
    const urgent = opts?.urgentCategory ?? null;
    const body = urgent
      ? displayName
        ? `${displayName} needs help now (${urgentLabel(urgent)}). Open the queue to reach out.`
        : `A neighbor needs help now (${urgentLabel(urgent)}). Open the queue to reach out.`
      : displayName
        ? `${displayName} asked for peer support. Open the queue to reach out.`
        : `A neighbor asked for peer support. Open the queue to reach out.`;
    for (const token of tokens) {
      try {
        const r = await sendFcmMessage({
          token,
          title: urgent
            ? "SafeGround — urgent need, please reach out"
            : "SafeGround — peer support requested",
          body,
          link: "/peer-support-queue",
        });
        if (r.status === "sent") tokensSent += 1;
      } catch {
        /* best-effort per token — never fails the request */
      }
    }
  }
  return { notifiedPhones, tokensSent };
}

function urgentLabel(category: UrgentNeedCategory): string {
  switch (category) {
    case "advocacy":
      return "advocacy";
    case "er_ride":
      return "ER ride";
    case "er_supplies":
      return "ER supplies";
    case "support":
      return "support";
    case "help":
    default:
      return "help";
  }
}

/* -- Urgent-need queue shape: the queue row plus the urgent flag/category -- */
export interface UrgentQueueFields {
  isUrgent: boolean;
  needCategory: UrgentNeedCategory | null;
  location: UrgentNeedLocation | null;
  fuzzLat: number | null;
  fuzzLng: number | null;
  hasExact: boolean;
  expiresAt: string | null;
}
