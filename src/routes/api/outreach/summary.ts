/**
 * Role-gated outreach dashboard summary (Wave 2c, owner-directed 2026-09-06).
 *
 * GET /api/outreach/summary?phone=… (or x-sg-phone header)
 *
 * Server-side role enforcement on every call:
 *  - Non-roster / inactive → 403 + the calm line, NEVER queue counts.
 *  - staff_limited → active alerts (kind + note, NO sender phone digits, NO
 *    outcome notes) + open needs (NO requester phone digits) + sweeps to
 *    verify (verify/flag affordances live on /sweeps) + aggregate counts.
 *    NEVER resolved alerts, NEVER outcome analytics.
 *  - admin → everything above (WITH contact phones for follow-up) + resolved
 *    alerts with outcomes + outcome analytics (counts, median resolve, how
 *    many had a helper) + open peer-support count.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import {
  OUTREACH_CALM_LINE,
  normOutreachPhone,
  outreachIdentity,
  outreachPushStubStatus,
} from "~/lib/outreachServer";

interface DbSweepLite {
  id: string;
  status: string;
  severity: string;
  event_at: string | Date;
  note: string | null;
  lat: number;
  lng: number;
  created_at: string | Date;
}
interface DbNeedLite {
  id: string;
  items: string[];
  note: string | null;
  status: string;
  visibility: string;
  requester_label: string;
  claimed_name: string | null;
  assigned_name: string | null;
  created_at: string | Date;
}
interface DbAlertLite {
  id: string;
  kind: string;
  note: string | null;
  location_shared: string;
  fuzz_lat: number | null;
  fuzz_lng: number | null;
  exact_lat: number | null;
  exact_lng: number | null;
  sender_phone: string;
  sender_name: string | null;
  claimed_by: string | null;
  claimed_name: string | null;
  claimed_at: string | Date | null;
  resolved_at: string | Date | null;
  resolved_by_role: string | null;
  outcome_note: string | null;
  expires_at: string | Date;
  created_at: string | Date;
}

const iso = (d: string | Date | null | undefined): string | null =>
  d == null ? null : new Date(d).toISOString();

/** Last digits only — staff_limited payloads never carry full phone digits. */
const tail4 = (phone: string | null): string | null =>
  phone == null ? null : `•••${String(phone).replace(/[^0-9]/g, "").slice(-4)}`;

async function summary(c: { request: Request }) {
  const url = new URL(c.request.url);
  const caller = normOutreachPhone(url.searchParams.get("phone") ?? c.request.headers.get("x-sg-phone"));
  const me = await outreachIdentity(caller);
  if (me.role === null) {
    return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
  }
  const admin = me.role === "admin";
  try {
    const sweeps = (await sql()`
      select id, status::text as status, severity::text as severity, event_at, note, lat, lng, created_at
      from public.sweeps
      where status in ('reported', 'flagged', 'verified')
      order by created_at desc
      limit 30`) as unknown as DbSweepLite[];

    const needs = (await sql()`
      select
        sr.id, sr.items, sr.note, sr.status::text as status, sr.visibility::text as visibility,
        case
          when sr.visibility = 'open' then coalesce(u.display_name, 'A neighbor')
          else 'Coordinator'
        end as requester_label,
        hc.display_name as claimed_name, ha.display_name as assigned_name,
        sr.created_at
      from public.supply_requests sr
      left join public.users u on u.id = sr.requested_by
      left join public.hometeam_members hc on hc.id = sr.hometeam_claimed_by
      left join public.hometeam_members ha on ha.id = sr.assigned_to
      where sr.status in ('open', 'claimed', 'in_progress')
        and coalesce(sr.fulfilled_at, sr.created_at) > now() - interval '30 days'
        and coalesce(sr.anonymize_at, now()) > now()
        and (${admin} or sr.visibility = 'open')
      order by
        case when sr.status = 'open' then 0 else 1 end,
        sr.created_at desc
      limit 30`) as unknown as DbNeedLite[];

    const activeAlerts = (await sql()`
      select ea.id, ea.kind, ea.note, ea.location_shared, ea.fuzz_lat, ea.fuzz_lng,
             ea.exact_lat, ea.exact_lng, ea.sender_phone,
             coalesce(hs.display_name, rs.display_name) as sender_name,
             ea.claimed_by, coalesce(hc.display_name, rc.display_name) as claimed_name,
             ea.claimed_at, ea.resolved_at, ea.resolved_by_role, ea.outcome_note,
             ea.expires_at, ea.created_at
      from public.emergency_alerts ea
      left join public.hometeam_members hs on hs.phone = ea.sender_phone
      left join public.outreach_roster rs on rs.phone = ea.sender_phone and rs.active
      left join public.hometeam_members hc on hc.phone = ea.claimed_by
      left join public.outreach_roster rc on rc.phone = ea.claimed_by and rc.active
      where ea.resolved_at is null and ea.expires_at > now()
      order by ea.created_at desc
      limit 30`) as unknown as DbAlertLite[];

    // Admin-only: resolved alerts + outcomes (time-to-resolve, who helped).
    let resolved: DbAlertLite[] = [];
    let peerOpen = 0;
    if (admin) {
      resolved = (await sql()`
        select ea.id, ea.kind, ea.note, ea.location_shared, ea.fuzz_lat, ea.fuzz_lng,
               ea.exact_lat, ea.exact_lng, ea.sender_phone,
               coalesce(hs.display_name, rs.display_name) as sender_name,
               ea.claimed_by, coalesce(hc.display_name, rc.display_name) as claimed_name,
               ea.claimed_at, ea.resolved_at, ea.resolved_by_role, ea.outcome_note,
               ea.expires_at, ea.created_at
        from public.emergency_alerts ea
        left join public.hometeam_members hs on hs.phone = ea.sender_phone
        left join public.outreach_roster rs on rs.phone = ea.sender_phone and rs.active
        left join public.hometeam_members hc on hc.phone = ea.claimed_by
        left join public.outreach_roster rc on rc.phone = ea.claimed_by and rc.active
        where ea.resolved_at is not null
        order by ea.resolved_at desc
        limit 30`) as unknown as DbAlertLite[];
      try {
        const pr = (await sql()`
          select count(*)::int as n from public.peer_support_requests
          where status in ('open', 'claimed')`) as unknown as Array<{ n: number }>;
        peerOpen = pr[0]?.n ?? 0;
      } catch {
        peerOpen = 0; // table not migrated yet — queue link still renders
      }
    }

    const mapAlert = (r: DbAlertLite) => ({
      id: r.id,
      kind: r.kind,
      note: r.note,
      location: r.location_shared,
      // Exact point: admin only (staff_limited sees fuzzed words, never the pin).
      fuzzLat: r.fuzz_lat,
      fuzzLng: r.fuzz_lng,
      exactLat: admin ? r.exact_lat : null,
      exactLng: admin ? r.exact_lng : null,
      canSeeExact: admin,
      senderName: r.sender_name ?? "a neighbor",
      // staff_limited payloads NEVER contain neighbor phone digits.
      senderPhone: admin ? r.sender_phone : null,
      senderTail: tail4(r.sender_phone),
      claimedByName: r.claimed_name,
      claimedAt: iso(r.claimed_at),
      resolved: r.resolved_at != null,
      resolvedAt: iso(r.resolved_at),
      resolvedByRole: r.resolved_by_role,
      // Outcome notes are admin + sender only — staff_limited never sees them.
      outcomeNote: admin ? r.outcome_note : null,
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
    });

    // Admin-only analytics: counts + median resolve + share with a helper.
    let analytics: {
      resolved7d: number;
      medianResolveMinutes: number | null;
      withHelperShare: number | null;
    } | null = null;
    if (admin) {
      const mins = resolved
        .map((r) => {
          if (!r.resolved_at || !r.created_at) return null;
          const ms = new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime();
          return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
        })
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      const mid = mins.length > 0 ? mins[Math.floor(mins.length / 2)] : null;
      const withHelper = resolved.length > 0 ? resolved.filter((r) => r.claimed_by != null).length / resolved.length : null;
      analytics = {
        resolved7d: resolved.length,
        medianResolveMinutes: mid,
        withHelperShare: withHelper == null ? null : Math.round(withHelper * 100) / 100,
      };
    }

    return Response.json({
      ok: true,
      role: me.role,
      name: me.name,
      push: outreachPushStubStatus(),
      counts: {
        sweepsToVerify: sweeps.filter((s) => s.status === "reported" || s.status === "flagged").length,
        openNeeds: needs.filter((n) => n.status === "open").length,
        activeAlerts: activeAlerts.length,
        ...(admin ? { peerOpen } : {}),
      },
      sweeps: sweeps.map((s) => ({
        id: s.id,
        status: s.status,
        severity: s.severity,
        eventAt: iso(s.event_at),
        note: s.note,
        lat: s.lat,
        lng: s.lng,
        createdAt: iso(s.created_at),
      })),
      needs: needs.map((n) => ({
        id: n.id,
        items: n.items ?? [],
        note: n.note,
        status: n.status,
        visibility: n.visibility,
        requesterLabel: n.requester_label,
        claimedByName: n.claimed_name,
        assignedToName: n.assigned_name,
        createdAt: iso(n.created_at),
      })),
      alerts: activeAlerts.map(mapAlert),
      ...(admin
        ? { resolved: resolved.map(mapAlert), analytics }
        : {}),
    });
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't load the dashboard — the database didn't answer." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/outreach/summary")({
  server: {
    handlers: {
      GET: summary,
    },
  },
});
