/**
 * Shared outreach-dashboard server helpers (Wave 2c, owner-directed 2026-09-06).
 *
 * SAFETY CONTRACT (non-negotiable):
 *  - Every dashboard read/write is gated on the caller's phone against the
 *    live `outreach_roster` (active rows only). Jenn + Bambi (role 'admin')
 *    see everything; Tracey-style staff (role 'staff_limited') sees ONLY
 *    active alerts + open needs + sweeps verify/flag — never resolved
 *    outcomes, never outcome analytics, never neighbor phone digits, never
 *    the roster. Non-roster callers get the calm line, never queue counts.
 *  - The gates degrade gracefully (try/catch → no role), so a missing roster
 *    table never crashes — it just renders the calm 404-equivalent.
 *  - Staff-override clear of an emergency alert reuses the EXISTING
 *    `resolve_emergency_alert` RPC, which is itself admin-gated in the DB
 *    (sender + roster-admin only) — a staff_limited caller fails
 *    server-side, not just via a hidden button.
 *  - Push dispatch here is a STUB: env placeholders for the dashboard's
 *    future group-notice send, reusing pushServer's sendFcmMessage. No new
 *    real sends beyond what exists today.
 */
import { sql } from "~/db";
import { pushPublicConfig } from "~/lib/pushServer";

export const OUTREACH_CALM_LINE = "This space is for the outreach team.";

export const normOutreachPhone = (raw: unknown): string =>
  String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 20);

export type OutreachRole = "admin" | "staff_limited" | null;

export interface OutreachIdentity {
  phone: string;
  role: OutreachRole;
  name: string | null;
}

/** Live roster lookup (active rows only) — the single source of truth. Never throws. */
export async function outreachIdentity(phone: string): Promise<OutreachIdentity> {
  const p = normOutreachPhone(phone);
  if (!p) return { phone: p, role: null, name: null };
  try {
    const rows = (await sql()`
      select display_name, role from public.outreach_roster
      where phone = ${p} and active
      limit 1`) as unknown as Array<{ display_name: string; role: string }>;
    const row = rows[0];
    if (!row) return { phone: p, role: null, name: null };
    return {
      phone: p,
      role: row.role === "admin" ? "admin" : row.role === "staff_limited" ? "staff_limited" : null,
      name: typeof row.display_name === "string" ? row.display_name : null,
    };
  } catch {
    return { phone: p, role: null, name: null };
  }
}

export const isOutreachStaff = async (phone: string): Promise<boolean> =>
  (await outreachIdentity(phone)).role !== null;

export const isOutreachAdmin = async (phone: string): Promise<boolean> =>
  (await outreachIdentity(phone)).role === "admin";

/* ── Firebase push dispatch STUB for the dashboard ───────────────
 * Env placeholders where a future group-notice send would go. Reuses the
 * existing pushPublicConfig helper for its "is push wired?" signal, and the
 * business-hours rule lives in the calling route (group notices are a later
 * wave — this stub never sends). Returns { configured } so the UI can say
 * plainly whether push is wired. */
export function outreachPushStubStatus(): { configured: boolean; note: string } {
  // pushPublicConfig().configured is the honest signal: all five public
  // Firebase values present. The service account stays server-side.
  let configured = false;
  try {
    configured = pushPublicConfig().configured;
  } catch {
    configured = false;
  }
  return {
    configured,
    note: configured
      ? "Push is wired — group notices will send through Firebase when that wave lands."
      : "Push notices aren't wired yet — the dashboard queues stay in-app for now.",
  };
}
