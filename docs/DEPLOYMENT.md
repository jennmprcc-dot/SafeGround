# SafeGround deployment

## How the site is built and shipped

The app is a TanStack Start (React + Vite + Tailwind) site in this repo.
`bun run build` (`vite build`) emits a portable server handler
(`dist/server/server.js`) plus static client assets (`dist/client`).
`bun run start` (`serve.ts`) wraps them in a Bun server pinned to port 3000.

Two environments, one repo:

| | Working site | Live site |
|---|---|---|
| Serves | dev server on `:3000` — edits hot-reload instantly | last published build |
| Ships via | `bun run publish` (from this dir: install → build → serve on :3000) | the lead's `publish_site` (builds + swaps the live copy) |

Nothing edited here is public until a publish succeeds. Never start, stop, or
rebuild the working server yourself — the platform manages it. Never put raw
URLs or `localhost` addresses in anything the owner reads.

## Secrets: `DATABASE_URL` and the live host

Env vars live in the platform Secrets UI and are injected at runtime
(`DATABASE_URL`, `SUPABASE_URL`/`supabase_url`, `supabase_anon_key`,
`ALLOW_DB_BOOTSTRAP`, `FIREBASE_*` — see README for the full table). `.env*`
files are gitignored and the dev server is configured to never serve them
(`vite.config.ts` `fs.deny`).

**Why the live host only picks up a new DB password on publish:** the running
live copy holds the environment it booted with. Rotating the secret (as on
2026-09-08) changes what the *next* boot sees — so the live host keeps
reporting the old credential until the next publish rebuilds and restarts it.
After publish, `/api/health` should return `ok:true, db:reachable` with fresh
`resources`/`sweeps` counts; a `503 db:unreachable` with the
`[YOUR-PASSWORD]` hint means the placeholder is still in effect.

**Pooler notes (from the 2026-09-08 rotation):** server DB access goes through
the Supavisor pooler (`aws-0-<region>.pooler.supabase.com`), not the direct
`db.<ref>` host — `src/db.ts` rewrites direct hosts automatically, with region
override `SUPABASE_DB_REGION`. TLS on the wire uses
`ssl.rejectUnauthorized:false` because the sandbox can't validate the pooler
cert SAN; the service credential + network wall remain the security boundary.

## `ALLOW_DB_BOOTSTRAP` must be OFF in prod

`POST /api/admin/bootstrap` applies `schema.sql` + demo seed idempotently —
but only when `ALLOW_DB_BOOTSTRAP=1` is set. With it absent (production
normal), the route returns `403` + a calm hint (verified live). Turn it on
only for a one-shot schema/seed run, then remove it.

## Push / FCM env vars (what they are — no values here)

- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
  `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID` (legacy
  `FIREBASE_MESSENGER_SENDER_ID` also honored as fallback), `FIREBASE_VAPID_KEY`
  — the **public** web config. Served at `GET /api/push-config`; safe for
  browsers by design (they ship inside every page that talks to Firebase).
- `FIREBASE_SERVICE_ACCOUNT` — the **server-only** private key used to mint
  OAuth tokens for FCM v1 sends (`src/lib/pushServer.ts`). Never returned by
  any API, never in client bundles, never committed.
- One service worker only: `public/firebase-messaging-sw.js`
  (`sg-fcm-sw/10.14.1`, vendored compat SDK under `public/firebase/`).
  PWA manifest: `public/site.webmanifest` (icons 192/512, display standalone).
  There is no offline service worker — offline behavior is the in-app
  `OfflineBanner` + `navigator.onLine` checks.

## Verifying a deploy

1. `GET /api/health` → `200 { ok:true, db:"reachable", resources, sweeps }`.
2. `POST /api/admin/bootstrap` → `403` (disabled).
3. `GET /api/push-config` → `configured:true`, exactly the 6 public keys, zero
   `private_key`/`service_account` strings.
4. Spot-check a page route + one role-gated endpoint (anon `/api/outreach/summary`
   → `403` calm line).
