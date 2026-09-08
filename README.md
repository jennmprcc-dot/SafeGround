# SafeGround — AI Safety Net

A mobile-first web app that helps unhoused neighbors in Marin County and MPRCC's
peer outreach team stay safe during sweeps: sweep alerts with maps, safe-sleeping
check-ins with a trusted-peer "find my friend" map, trusted-peer emergency alerts,
a resource navigator (food, shelter, clinics), supply requests claimed by the
HomeTeam community, one-tap peer-support requests, an outreach dashboard, a
community directory with group notices, and an anonymous analytics module for
grant reporting.

**Privacy pledge:** no background location tracking — all location sharing is
user-initiated. Analytics are anonymous and zero-PII: we never log phones,
locations, or device identifiers.

## Stack

- **TanStack Start** (React 19 + Vite + Tailwind CSS v4) — routes in `src/routes/`,
  page routes plus `src/routes/api/*` server routes (`createFileRoute` +
  `server.handlers`).
- **Postgres via `pg`** (`node-postgres`) over the Supavisor pooler —
  `src/db.ts` (`sql()` tagged-template helper; rewrites direct `db.<ref>` hosts
  to the pooler automatically). Schema + RLS + RPCs in `schema.sql`.
- **Firebase Cloud Messaging** for in-app push (`src/lib/pushServer.ts`,
  `src/lib/fcm.ts`, `public/firebase-messaging-sw.js`). Push is the only
  dispatch channel — SMS/Twilio keys below are reserved for a later wave.

## Quickstart

```sh
bun install
bun run dev        # dev server on :3000 (working site)
bun run build      # production build
bun run publish    # build + serve prod on :3000 (working URL)
```

Schema + seed are applied with `bun scripts/apply-schema.ts --both`
(idempotent). The same bootstrap is exposed as a gated API route
(`POST /api/admin/bootstrap`, env `ALLOW_DB_BOOTSTRAP=1`) for the live host —
see `docs/DEPLOYMENT.md`.

## Environment variables

Injected via the platform Secrets UI, **never committed** (`.env*` gitignored):

| Var | Purpose |
| --- | ------- |
| `DATABASE_URL` | Postgres connection. `src/db.ts` rewrites a direct `db.<ref>` host to the Supavisor pooler automatically. Region override: `SUPABASE_DB_REGION`. |
| `SUPABASE_URL` / `supabase_url` | Supabase project URL (read in code; both casings appear). |
| `supabase_anon_key` | Supabase anonymous key. |
| `ALLOW_DB_BOOTSTRAP` | Set to `1` (temporarily) to enable `POST /api/admin/bootstrap`. Must be **OFF/absent in prod** (403 verified). |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID` (legacy `FIREBASE_MESSENGER_SENDER_ID` also honored), `FIREBASE_VAPID_KEY` | Public web-push config served at `GET /api/push-config`. Safe for browsers by design. |
| `FIREBASE_SERVICE_ACCOUNT` | Server-only private key for FCM sends. Never leaves the server, never in any API response. |
| `TWILLIO_ACCOUNT_SID`, `TWILLIO_AUTH_TOKEN`, `TWILLIO_PHONE_NUMBER`, `MPRCC_DISPATCH_PHONES` | Reserved for a later SMS wave. **Deferred** — not used by the current build (in-app push only). |

## Docs

- `docs/API.md` — every API route: method, auth, shapes, errors.
- `docs/DEPLOYMENT.md` — build, publish path, secrets, pooler notes.
- `docs/USER_GUIDE.md` — plain-language guide for neighbors, HomeTeam, staff.
- `docs/PRIVACY.md` — the privacy model (reference for the `/privacy` page).
- `PRD.md`, `DESIGN_SYSTEM.md`, `WIREFRAMES.md`, `BUILD_NOTES.md` — product + design history.

## Repo layout

- `src/` — the TanStack Start app (routes, components, styles)
- `src/db.ts` — `pg` pool + `sql()` helper (URL repair logic)
- `src/lib/` — server helpers (`server.ts`, `outreachServer.ts`,
  `pushServer.ts`, `peerServer.ts`, `peerSupportServer.ts`, `directoryServer.ts`,
  `analytics/`)
- `src/lib/bootstrap.ts` — idempotent schema apply + demo seed
- `scripts/apply-schema.ts`, `scripts/seed.ts` — one-shot ops
- `schema.sql` — Postgres schema + RLS policies + RPCs
- `WORKFLOW.md` — team code workflow
- `SITE.md` — framework notes for the site scaffold

## Status (2026-09-08)

Live and verified: push delivery green; trusted peers; log-a-need fix;
analytics module (`/admin/analytics`, admin-only) + grant CSV export;
sweeps-moderation gate; P0 route fixes for `/checkin/peers` and
`/alerts/new`+`/alerts/mine`. Live health: `/api/health` →
`ok:true, db:reachable`. See `docs/*` for the current reality.
