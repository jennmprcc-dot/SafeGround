/**
 * PR-C: neighbor-reported listing change (owner-directed 2026-09-11).
 *
 * POST /api/resources/report-change { resourceId, reason, note, phone? }
 *
 * Anonymous-first: NO phone required (R-P6/R-P7 — the report itself is the
 * record). Requires a valid resource id + a non-empty note; reason is one of
 * closed | wrong_info | hours_changed | other. Inserts a `pending` row into
 * resource_verifications — the outreach check-in queue — and returns ok.
 *
 * Rate-limited-ish: a small in-memory per-client cap (10 reports / 10 min) so
 * a stuck device can't flood the queue; generous enough for real use. The cap
 * lives in server memory only (fine for a 3-person team; a restart clears it).
 *
 * The route runs as the service role (like every other API route) — RLS is
 * on with no client policies, so the anon key can neither read nor write
 * these rows.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

const REASONS = ["closed", "wrong_info", "hours_changed", "other"] as const;
export type ReportReason = (typeof REASONS)[number];

/** Server-side digits-only phone (same convention as normOutreachPhone). */
const digitsOnly = (raw: unknown): string => String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 20);

/* In-memory per-client throttle: max 10 reports per 10 minutes. */
const REQUEST_WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 10;
const reportCounts = new Map<string, { n: number; until: number }>();

function clientKey(c: { request: Request }): string {
  const fwd = c.request.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}

function throttle(c: { request: Request }): boolean {
  const key = clientKey(c);
  const now = Date.now();
  const rec = reportCounts.get(key);
  if (!rec || rec.until <= now) {
    reportCounts.set(key, { n: 1, until: now + REQUEST_WINDOW_MS });
    return true;
  }
  if (rec.n >= MAX_PER_WINDOW) return false;
  rec.n += 1;
  return true;
}

async function reportChange(c: { request: Request }) {
  let body: { resourceId?: unknown; reason?: unknown; note?: unknown; phone?: unknown } = {};
  try {
    body = (await c.request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body with the listing and what changed." }, { status: 400 });
  }
  const resourceId = String(body.resourceId ?? "").trim().toLowerCase();
  const reason = String(body.reason ?? "").trim().toLowerCase();
  const note = String(body.note ?? "").replace(/\s+/g, " ").trim();
  const phone = digitsOnly(body.phone);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(resourceId)) {
    return Response.json({ ok: false, error: "Which listing? (a valid listing id is needed)" }, { status: 400 });
  }
  if (!(REASONS as readonly string[]).includes(reason)) {
    return Response.json({ ok: false, error: "Please choose what changed — closed, info wrong, hours, or something else." }, { status: 400 });
  }
  if (note.length < 1) {
    return Response.json({ ok: false, error: "A word or two helps outreach know what changed." }, { status: 400 });
  }
  if (note.length > 500) {
    return Response.json({ ok: false, error: "Please keep the note to 500 characters so it stays quick to read." }, { status: 400 });
  }
  if (!throttle(c)) {
    return Response.json({ ok: false, error: "That's a lot of reports in a short time — the team will review the ones already sent." }, { status: 429 });
  }

  try {
    const id = (await sql()`
      insert into public.resource_verifications (resource_id, reported_by, reason, note)
      select r.id, ${phone || null}, ${reason}, ${note}
      from public.resources r
      where r.id = ${resourceId}::uuid
      returning id`) as unknown as Array<{ id: string }>;
    if (id.length === 0) {
      return Response.json({ ok: false, error: "That listing is no longer on the board — nothing was saved." }, { status: 404 });
    }
    return Response.json({ ok: true, id: id[0]?.id });
  } catch {
    return Response.json(
      { ok: false, error: "That didn't go through — try again in a moment." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/resources/report-change")({
  server: {
    handlers: {
      POST: reportChange,
    },
  },
});