# SafeGround — AI Safety Net

A mobile-first web app that helps unhoused neighbors and outreach teams stay
safe during sweeps: sweep alerts with maps, safe-sleeping check-ins with a
trusted-peer "find my friend" map, a resource navigator (food, shelter,
clinics, and more), supply requests, peer-support chat with AI triage, and an
outreach dashboard.

Privacy is a hard requirement: **no background location tracking** — all
location sharing is user-initiated. All user data is protected with
row-level security. The UX is trauma-informed and mobile-first.

## Stack

- **TanStack Start** (React 19 + Vite + Tailwind CSS v4)
- **Supabase-ready data layer** — see `schema.sql` (tables: users, sweeps,
  supply requests, resources, check-ins, trusted peers, HomeTeam members,
  emergency alerts, with RLS policies + consent-first RPCs:
  `hometeam_join/pause/resume/claim/assign/complete`,
  `send_emergency_alert` / `resolve_emergency_alert`)
- Server-side DB access uses **`pg`** (`node-postgres`) over the Supavisor
  pooler with TLS on the wire (`ssl.rejectUnauthorized: false` — the sandbox
  can't validate the pooler cert SAN; the service credential + network wall
  remain the security boundary). `@neondatabase/serverless` was removed — the
  neon driver fails TLS on this sandbox.
- Free-tier integrations via env vars: Mapbox, HuggingFace
- Served by the platform's built-in free hosting (`bun run publish`)

## Run locally

```sh
bun install
bun run dev
```

`bun run publish` builds and serves the production build on port 3000.

## Environment variables

These are **injected via the platform Secrets UI, never committed**:

| Var | Purpose |
| --- | ------- |
| `DATABASE_URL` | Postgres / Supabase connection. May be the direct `db.<ref>.supabase.co` host — `src/db.ts` rewrites it to the dual-stack Supavisor pooler (`aws-0-<region>.pooler.supabase.com`) automatically. Region override: `SUPABASE_DB_REGION`. |
| `supabase_url` | Supabase project URL |
| `supabase_anon_key` | Supabase anonymous key |
| `TWILLIO_ACCOUNT_SID` | Twilio account SID (SMS dispatch). NOTE: spelled with two L's ("TWILLIO") — that's the exact name in Secrets, keep it. |
| `TWILLIO_AUTH_TOKEN` | Twilio auth token (SMS dispatch). Two L's — same note. |
| `TWILLIO_PHONE_NUMBER` | The MPRCC Twilio number that texts go out from. Two L's — same note. |
| `MPRCC_DISPATCH_PHONES` | Comma-separated verified recipient numbers for SMS dispatch (e.g. `+14158797940,+14155249090`). |

`.env*` files are gitignored. Never commit real secrets.

Schema + demo seed are applied with `bun scripts/apply-schema.ts --both`
(idempotent). The same bootstrap is exposed as a gated API route
(`POST /api/admin/bootstrap`, env `ALLOW_DB_BOOTSTRAP=1`) for the live host.

> **Twilio / SMS is DEFERRED** until budget exists (per the business plan:
> $0 operating budget, hard constraint). In-app push (firebase) is the only
> dispatch channel in flight; the `TWILLIO_*` keys are reserved for a later
> wave and are not used by the current build.

## Repo layout

- `src/` — the TanStack Start app (routes, components, styles)
- `src/db.ts` — `pg` pool + `sql()` tagged-template helper (URL repair logic)
- `src/lib/server.ts` — server functions (resources, sweeps, check-ins)
- `src/lib/bootstrap.ts` — idempotent schema apply + demo seed
- `scripts/apply-schema.ts`, `scripts/seed.ts` — one-shot ops
- `schema.sql` — Supabase schema + RLS policies
- `PRD.md` — product requirements
- `DESIGN_SYSTEM.md` — design system (colors, spacing, typography)
- `WIREFRAMES.md` — mobile-first wireframes
- `BUILD_NOTES.md` — build notes
- `WORKFLOW.md` — team code workflow
- `SITE.md` — framework notes for the site scaffold

## Status

MVP baseline: Home + Resource Navigator (list + map views) + Sweep Alerts
(map/list/report/outreach queue) + Safe-Sleeping Check-Ins (manual check-in,
trusted peers, fuzzed find-my-friend map, 12h overdue gentles). Supply
requests, peer-support chat, and the outreach dashboard follow in Wave 2 per
the business plan.

## HomeTeam + emergency alerts (schema wave)

- **HomeTeam** — MPRCC's community supporter program (named for MPRCC's future
  housing development). Join = phone + name + explicit consent, no account, no
  location. Needs flow pending → in_progress → delivered with
  `visibility` = `open` (supporters tap "I got that") / `assign_only`
  (coordinator assigns) / `private` (outreach only). In-app push only; SMS deferred.
- **Emergency alerts** — one-tap alert to the sender's chosen groups
  (friends / peers / HomeTeam, pre-checked, uncheckable) + optional fuzzed
  ~150m location (per-alert consent). "I'm OK" resolves; 24h expiry.
  **Never contacts 911 or any agency** — outreach views active alerts to help;
  nothing auto-dispatched.
- RPCs are `SECURITY DEFINER`, phone-normalized, with calm trauma-informed
  errors. Seed: Jane + Bao (demo supporters), "Joe needs a tent at the
  skatepark" (open need, place name only, no pin), one resolved demo alert.
