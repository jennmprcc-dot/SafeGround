# SafeGround — Build Notes (site scaffold survey, 2026-09-06)

Survey of `/home/team/shared/site` — the TanStack Start (React 19 + Vite + Tailwind v4) scaffold
served on port 3000 and published via `bun run publish`. All paths below are real file contents
read verbatim. Purpose: brief the MVP build (Resource Navigator, Sweep Alerts, Check-Ins) precisely.

## 1. Exact directory structure of `src/` (every file + one-line purpose)

`src/` contains exactly 5 files (no subdirs beyond `routes/` and `styles/`, no `public/` dir anywhere):

- `src/routes/__root.tsx` — HTML shell for every page: `<head>` meta/links, `<Outlet/>`, `<Scripts/>`; global 404.
- `src/routes/index.tsx` — Landing page `/`: static "Your site will appear here" placeholder with inline SVG globe.
- `src/router.tsx` — `getRouter()` factory: wires the generated `routeTree` into `createRouter` (preload + scroll restoration).
- `src/db.ts` — Server-only Neon Postgres handle: lazy `sql()` factory reading `process.env.DATABASE_URL`; throws until a DB is connected.
- `src/styles/app.css` — Tailwind entrypoint + base light/dark body styles.

Generated at build/dev time (gitignored, NOT checked in): `src/routeTree.gen.ts` (auto-generated route tree
imported by `src/router.tsx` as `./routeTree.gen`; see `.gitignore` line `src/routeTree.gen.ts`).

## 2. How routing works (file-based routes, `__root.tsx` shell, adding a page)

File-based routing via TanStack Start/Router: files under `src/routes/` are routes; the router tree is
generated automatically (`routeTree.gen.ts`, imported in `src/router.tsx`):

```ts
// src/router.tsx (verbatim)
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => <p>Not found</p>,
  });
}
```

Shell (`src/routes/__root.tsx`, verbatim essence): `createRootRoute({ head: ... })` sets
`charSet`, `viewport`, `<title>My site</title>`, and links the stylesheet via
`import appCss from "~/styles/app.css?url"`; `notFoundComponent: () => <div>Page not found</div>`;
`RootComponent` renders `<html><head><HeadContent/></head><body><Outlet/><Scripts/></body></html>`.
Per `SITE.md`: "Add a page by creating a new file under `src/routes/` — e.g. `about.tsx` becomes `/about`.
Files are routes; the router is generated automatically."

A page (`src/routes/index.tsx`, verbatim pattern):

```tsx
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: Home });
```

Layout/tabs example (standard TanStack Router file convention; no nested-layout example ships in the
scaffold, but the generated-tree setup supports it): create a pathless layout route
`src/routes/_tabs.tsx` exporting `createFileRoute("/_tabs")` whose component renders tab nav + `<Outlet/>`,
then nest pages as `src/routes/_tabs.resources.tsx` (`/resources`), `src/routes/_tabs.alerts.tsx`
(`/alerts`), `src/routes/_tabs.checkin.tsx` (`/checkin`). Nested dynamic detail pages follow the
`$param` convention, e.g. `src/routes/_tabs.resources.$id.tsx` → `/resources/$id`. Path alias `~/`
maps to `./src/` (see `tsconfig.json` `paths: { "~/*": ["./src/*"] }`).

## 3. Publish pipeline (each script's role, logs, env vars at build time)

- `publish.sh` (`bun run publish` — the deploy command): `bun install` (no-op when current) →
  `bun run build` (foreground, errors surface) → `setsid nohup bun run start > .run/server.log 2>&1` →
  polls `curl http://localhost:3000` up to ~10s; reports "site published; serving on port 3000" or warns
  to check `.run/server.log`. Group-writable (`umask 002`) so any teammate can republish.
- `serve.ts` (`bun run start`): production server wrapping the TanStack Start build output —
  static client assets from `dist/client` served first, everything else via SSR handler
  `dist/server/server.js`. **PORT 3000 / HOST 0.0.0.0 are pinned constants** (deliberately NOT read from
  env — Bun auto-loads `.env` files, and a stray `PORT`/`HOST` must never move the public surface).
  Frees the port cross-user via `sudo lsof … | kill` with retry (last publish wins).
- `go-live.sh` (`bun run go-live` — Vercel live deploy): requires `VERCEL_TOKEN`; optional `DATABASE_URL`
  forwarded as runtime env (`-e "DATABASE_URL=..."`); auto-resolves `VERCEL_SCOPE`/`VERCEL_TEAM_ID`;
  runs `build-vercel.sh`, then `bunx vercel deploy --prebuilt`, then PATCHes the project
  (`{"ssoProtection":null}`) so the public site has no login wall; prints `LIVE: <url>`.
- `build-vercel.sh`: `bun install` → `bun run build` → assembles `.vercel/output` (Build Output API v3:
  `dist/client` → `.vercel/output/static` minus `index.html` since SSR owns `/`; SSR bundle →
  `.vercel/output/functions/render.func/index.mjs` via `bun build vercel-entry.ts --target node`) with
  `.vc-config.json` (`runtime nodejs22.x`, `launcherType Nodejs`, streaming) and `config.json`
  (`filesystem` then `/(.*)` → `/render`). Rationale (in-file): TanStack Start's fetch handler with
  dynamic chunks is fragile under Vercel's detection, so everything is bundled into one self-contained
  function. Output `.vercel/` is gitignored.
- `vercel-entry.ts`: adapter — Vercel invokes the default export as classic Node `(req, res)`; it converts
  `IncomingMessage` → web `Request`, runs `dist/server/server.js` fetch handler, streams the web
  `Response` back; 500s log server-side, never leak stacks to visitors.
- `vite.config.ts`: plugins `tailwindcss()`, `tsConfigPaths`, `tanstackStart()`, `viteReact()`;
  dev server `port 3000, host true, allowedHosts true` (never "Blocked request" behind the proxy),
  `hmr.clientPort 443`; `fs.strict` locked to the site dir with `deny: [".env", ".env.*",
  "*.{crt,pem,key}", "**/.run/**", "**/.git/**"]` so secrets/logs are never served.
- Logs: `.run/server.log` (publish/prod server); `.run/` also holds `managed-server`. Both gitignored.
- Env vars at build time: `.env` and `.env.local` are gitignored AND denied from serving (see above).
  Bun auto-loads `.env` files at runtime (per `serve.ts` comment). Only `DATABASE_URL` is referenced in
  code (`src/db.ts`, lazy per-call so builds serve before a DB is connected). Per `SITE.md`,
  `DATABASE_URL` "is injected into this sandbox automatically once connected, and it's passed to the
  live host by `bun run go-live`". **No `MAPBOX_*`, `HUGGINGFACE_*`, or `import.meta.env.VITE_*`
  references exist anywhere** (verified by grep) — MVP must add them: server secrets via `process.env.*`
  inside `createServerFn`/API routes; any client-exposed key via `import.meta.env.VITE_*`.

## 4. Current styling setup

- Entry `src/styles/app.css` (verbatim, all 8 lines):

```css
@import "tailwindcss";

@layer base {
  html,
  body {
    @apply bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100;
  }
}
```

- Tailwind v4 wired via the `@tailwindcss/vite` plugin (`tailwindcss()` first in `vite.config.ts`
  plugins) + `tailwindcss@^4.1.18` in devDependencies — CSS-first config, no `tailwind.config.js`.
- Linked globally from `__root.tsx` head via `import appCss from "~/styles/app.css?url"`.
- Theme tokens: none custom — only the base light/dark body colors above plus ad-hoc utilities in
  `index.tsx` (`bg-white dark:bg-neutral-900`, `text-slate-900 dark:text-white/80`, `text-slate-400`).
  MVP should define SafeGround design tokens (brand colors, spacing, type) here with `@theme`.

## 5. Server capabilities out of the box (`createServerFn` + API routes)

From `SITE.md` (quoted): "The site is static today, but adding backend behavior is one file away — no
second process, no extra port, all served on the same port 3000: **Server function** — call server-only
code (DB, secrets, fetch) directly from a component (`createServerFn` from `@tanstack/react-start`
with `.handler(async () => …)`); **API route** — add `src/routes/api/<name>.ts` for a REST endpoint."
Database pattern (quoted from `SITE.md`): query from server-only code with the built-in helper —
"never from the client" — via `import { sql } from "~/db"` inside a `createServerFn().handler`,
coercing non-primitives (e.g. `created_at: String(...)`) because "timestamps come back as JS Dates,
which React will not render". No `createServerFn` or `src/routes/api/*` examples exist yet in the
scaffold — first MVP server code will be the first. `src/db.ts` docstring repeats the same pattern.

## 6. Client-side state libraries + map packages (`package.json`)

Full deps (`package.json` verbatim): `react ^19.2.4`, `react-dom ^19.2.4`,
`@tanstack/react-router ^1.158.1`, `@tanstack/react-start ^1.158.3`,
`@neondatabase/serverless ^1.1.0`; devDeps: `@tailwindcss/vite ^4.1.18`, `tailwindcss ^4.1.18`,
`vite ^7.3.1`, `@vitejs/plugin-react ^5.1.3`, `vite-tsconfig-paths ^6.0.5`, `typescript ^5.9.3`,
`@types/*`, `prettier ^3.8.1`. Scripts: `dev: vite dev`, `build: vite build`,
`start: bun run serve.ts`, `publish`, `go-live`, `format`.

- State libraries: **NONE** — no zustand/jotai/redux/valibot/zod/react-hook-form. MVP must add its pick
  (`@tanstack/react-start` ships only router/server, not a store).
- Map packages: **NONE** — no `mapbox-gl`, `maplibre-gl`, or `leaflet`. Mapbox must be added
  (`mapbox-gl` + CSS import, token as env placeholder per plan).

## 7. Favicon / branding / assets

**None.** There is no `public/` directory, no `<link rel="icon">` in `__root.tsx` head (only the
stylesheet link), and no image/font/asset files anywhere under `src/`. The only visual is the inline
SVG globe (`circle` + meridians) in the placeholder `index.tsx`. Branding source of truth is
`site.json`: `{"businessName":"SafeGround — AI Safety Net"}` — NOTE: `SITE.md` claims the headline
"reads the business name from `site.json` at request time," but the current `index.tsx` never imports
or reads `site.json` (verified: zero references) — first build should wire it or replace the placeholder.
MVP must add: favicon + app icons (`public/` dir is served as static via `serve.ts`/`dist/client`),
brand theme, and real landing content.