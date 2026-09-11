/**
 * Role-gated outreach actions (Wave 2c, owner-directed 2026-09-06).
 *
 * POST /api/outreach/act { phone, kind, id, action, note? }
 *   kind: "sweep" | "need" | "alert"
 *   - sweep verify/flag: any active roster role. resolve: ADMIN ONLY
 *     (staff_limited fails server-side with the calm line).
 *   - need claim/deliver: any active roster role (staff_limited CAN).
 *     Needs-claim attribution goes through the HomeTeam RPCs, which require
 *     an active hometeam_members row — roster staff are NOT auto-members, so
 *     the server records their staff phone as the coordinator note instead
 *     via a direct service-role update. Deliver works for any status.
 *   - alert clear (staff-override): ADMIN ONLY, requires an outcome note,
 *     and reuses the `resolve_emergency_alert` RPC — the DB itself rejects
 *     non-admin callers, so staff_limited fails server-side twice over.
 *
 * Non-roster callers → 403 + the calm line, never queue detail.
 *
 * TanStack Start v1 server-route form: createFileRoute + server.handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { OUTREACH_CALM_LINE, normOutreachPhone } from "~/lib/outreachServer";
import { pinFromRequest, pinGate } from "~/lib/staffPin";

async function outreachAct(c: { request: Request }) {
  let body: {
    phone?: unknown;
    kind?: unknown;
    id?: unknown;
    action?: unknown;
    note?: unknown;
    pin?: unknown;
  } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with phone + kind + id + action." }, { status: 400 });
  }
  const caller = normOutreachPhone(body.phone ?? c.request.headers.get("x-sg-phone"));
  // PIN LOCK (owner-directed 2026-09-11): every dashboard WRITE needs a valid
  // PIN too — phone alone no longer suffices for any outreach action.
  const me = await pinGate(caller, pinFromRequest(c, body));
  if (!me.ok) {
    return Response.json({ ok: false, error: me.error, code: me.code }, { status: 403 });
  }
  const admin = me.role === "admin";
  const kind = String(body.kind ?? "").trim().toLowerCase();
  const id = String(body.id ?? "").trim().slice(0, 64);
  const action = String(body.action ?? "").trim().toLowerCase();
  const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!id) return Response.json({ ok: false, error: "Which item? (id missing)" }, { status: 400 });

  try {
    if (kind === "sweep") {
      if (action === "verify") {
        await sql()`
          update public.sweeps set status = 'verified', verified_at = now(), verified_by = null
          where id = ${id} and status = 'reported'`;
      } else if (action === "flag") {
        await sql()`
          update public.sweeps set status = 'flagged', flagged_at = now(), flagged_by = null
          where id = ${id} and status = 'reported'`;
      } else if (action === "resolve") {
        // Admin-only: enforced HERE (never just a hidden button)…
        if (!admin) {
          return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
        }
        await sql()`
          update public.sweeps set status = 'resolved', severity = 'resolved_recent', resolved_at = now()
          where id = ${id}`;
      } else {
        return Response.json({ ok: false, error: "Unknown sweep action — use verify, flag, or resolve." }, { status: 400 });
      }
      return Response.json({ ok: true, kind, id, action });
    }

    if (kind === "need") {
      if (action === "claim") {
        // Coordinator claim: staff phone recorded in the note trail; open→in_progress.
        await sql()`
          update public.supply_requests
          set status = 'in_progress', claimed_at = coalesce(claimed_at, now()),
              note = case
                when note is null or note = '' then ${`Coordinator (${caller}) picked this up.`}
                else note
              end
          where id = ${id}::uuid and status = 'open'`;
      } else if (action === "deliver") {
        await sql()`
          update public.supply_requests
          set status = 'delivered', delivered_at = now(), fulfilled_at = coalesce(fulfilled_at, now())
          where id = ${id}::uuid and status in ('open', 'claimed', 'in_progress')`;
      } else {
        return Response.json({ ok: false, error: "Unknown need action — use claim or deliver." }, { status: 400 });
      }
      return Response.json({ ok: true, kind, id, action });
    }

    if (kind === "alert") {
      if (action !== "clear") {
        return Response.json({ ok: false, error: "Unknown alert action — use clear with an outcome note." }, { status: 400 });
      }
      // Admin-only staff override, outcome note REQUIRED (it's the staff record).
      if (!admin) {
        return Response.json({ ok: false, error: OUTREACH_CALM_LINE }, { status: 403 });
      }
      if (!note) {
        return Response.json(
          { ok: false, error: "Add a short outcome note — it's the record of what happened." },
          { status: 400 },
        );
      }
      try {
        await sql()`select public.resolve_emergency_alert(${id}, ${caller}, ${note})`;
      } catch (e) {
        // The RPC itself rejects non-admins / strangers — pass its calm words through.
        const m = String((e as { message?: string })?.message ?? "").trim().slice(0, 220);
        return Response.json(
          { ok: false, error: m || "That didn't go through — nothing changed." },
          { status: 403 },
        );
      }
      return Response.json({ ok: true, kind, id, action });
    }

    return Response.json({ ok: false, error: "Unknown kind — use sweep, need, or alert." }, { status: 400 });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/outreach/act")({
  server: {
    handlers: {
      POST: outreachAct,
    },
  },
});
