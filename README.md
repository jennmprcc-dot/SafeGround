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
  supply requests, resources, check-ins, with RLS policies)
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
| `DATABASE_URL` | Postgres / Supabase connection |
| `supabase_url` | Supabase project URL |
| `supabase_anon_key` | Supabase anonymous key |
| `TWILLIO_ACCOUNT_SID` | Twilio account SID (SMS dispatch). NOTE: spelled with two L's ("TWILLIO") — that's the exact name in Secrets, keep it. |
| `TWILLIO_AUTH_TOKEN` | Twilio auth token (SMS dispatch). Two L's — same note. |
| `TWILLIO_PHONE_NUMBER` | The MPRCC Twilio number that texts go out from. Two L's — same note. |
| `MPRCC_DISPATCH_PHONES` | Comma-separated verified recipient numbers for SMS dispatch (e.g. `+14158797940,+14155249090`). |

`.env*` files are gitignored. Never commit real secrets.

SMS dispatch: when a neighbor submits a request (supply request, chat
escalation) it lands in the MPRCC outreach-queue and texts the dispatch
numbers above with a short, calm notification. In-app push is the primary
free channel; SMS via Twilio is the secondary layer (uses the `TWILLIO_*`
keys above, exact spelling).

## Repo layout

- `src/` — the TanStack Start app (routes, components, styles)
- `schema.sql` — Supabase schema + RLS policies
- `PRD.md` — product requirements
- `DESIGN_SYSTEM.md` — design system (colors, spacing, typography)
- `WIREFRAMES.md` — mobile-first wireframes
- `BUILD_NOTES.md` — build notes
- `WORKFLOW.md` — team code workflow
- `SITE.md` — framework notes for the site scaffold

## Status

MVP baseline: Home + Resource Navigator (list + map views). Sweep alerts,
safe-sleeping check-ins, supply requests, peer-support chat, and the outreach
dashboard follow in waves per the business plan.
