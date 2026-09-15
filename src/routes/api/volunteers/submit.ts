/**
 * Pass 3 — Volunteer flow: submit interest (owner-directed 2026-09-12).
 * Anyone may submit (anonymous app, same as donation offers); the row is the
 * staff queue. The server fans a push out to the ACTIVE roster admins ONLY
 * (Jenn + Bambi) via registered tokens — name-or-"Volunteer" + snippet, ZERO
 * contact digits in the push, never 911, never SMS.
 *
 * POST /api/volunteers/submit
 *   { name?, contact (phone-or-email, required), interestNote? }
 * → 201 { ok, signup } | 400 { ok:false, error, field? } | 503
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { insertAnalyticsEvent } from "~/lib/analytics/server";
import {
  fanOutVolunteerAdmins,
  validateVolunteerInput,
  volunteerTableReady,
} from "~/lib/volunteerServer";

async function submitVolunteer(c: { request: Request }) {
  let body: Record<string, unknown> = {};
  try {
    body = (await c.request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: "Send a JSON body with your interest." },
      { status: 400 },
    );
  }
  const validated = validateVolunteerInput(body);
  if (!validated.ok) {
    return Response.json(
      { ok: false, error: validated.error, field: validated.field ?? null },
      { status: 400 },
    );
  }
  const v = validated.data;
  if (!(await volunteerTableReady())) {
    return Response.json(
      { ok: false, error: "Volunteer sign-ups aren't live yet — the next database update adds them. Please email the MPRCC team directly for now.", code: "no_table" },
      { status: 503 },
    );
  }
  try {
    const rows = (await sql()`
      insert into public.volunteer_signups (name, contact, interest_note)
      values (${v.name}, ${v.contact}, ${v.interestNote})
      returning id, name, contact, interest_note, status, created_at, updated_at`) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return Response.json(
        { ok: false, error: "That didn't go through — please try again in a moment." },
        { status: 503 },
      );
    }
    // Zero-PII analytics: contact-kind only (phone vs email) — never the
    // number/address itself, never the note.
    try {
      await insertAnalyticsEvent("volunteer_submit", {
        category: v.contact.includes("@") ? "email" : "phone",
        status: "new",
      });
    } catch {
      /* silent — the sign-up already succeeded */
    }
    // Push to admins only. Best-effort — never fails the submit.
    let fan = { notifiedPhones: 0, tokensSent: 0 };
    try {
      fan = await fanOutVolunteerAdmins(
        v.name ?? "Volunteer",
        v.interestNote ?? "",
      );
    } catch {
      /* best-effort */
    }
    return Response.json(
      {
        ok: true,
        signup: { id: String(row.id), status: String(row.status) },
        teamNotified: fan.notifiedPhones > 0 && fan.tokensSent > 0,
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — the database didn't answer. Try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/volunteers/submit")({
  server: {
    handlers: {
      POST: submitVolunteer,
    },
  },
});