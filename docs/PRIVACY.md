# SafeGround privacy model

This is the reference behind the `/privacy` page's promises. Rules first,
plumbing second: every claim below is enforced in code (`schema.sql` + the
server routes in `src/routes/api/*`), not just in copy.

## The short version

- **No background location, ever.** The app never watches where you are.
  Location is read only when you tap something like "Use my location once" —
  a single read for that one lookup. There is no `watchPosition` anywhere in
  the codebase (verified in `src/`, `public/`, and shipped bundles).
- **Every share names its audience, its content, and its expiry — before the
  tap.** And every share can be stopped: pause check-ins instantly, remove a
  peer anytime, clear your own alert with "I'm OK."
- **Analytics are anonymous and zero-PII.** Counts only — never phones,
  locations, or device identifiers (details below).
- **We never contact authorities on your behalf.** Sending an alert, asking
  for peer support, or testing push never calls 911, never texts an agency,
  never dispatches anyone. Help comes from people you chose, or not at all.

## Analytics: zero-PII by construction

The `analytics_events` table (`schema.sql`) has exactly 6 columns, and the
intake writes only 4 of them:

| Column | What it holds | What it never holds |
|---|---|---|
| `event_type` | one of `resource_search`, `peer_support_request`, `sweep_alert_view`, `check_in` | — |
| `category` | a service/category id, ≤40 chars (e.g. which resource category was searched) | no free text, no names |
| `status` | a broad status, ≤20 chars (e.g. `open`) | — |
| `install_id` | a random anonymous install UUID, used only for "unduplicated" counts | never a phone, IP, or device id |
| `id`, `created_at` | row id + timestamp | — |

What is deliberately absent: no phone, no IP address, no user-agent, no
headers, no coordinates, no notes, no free text. The intake
(`POST /api/analytics/log` → `insertAnalyticsEvent` in
`src/lib/analytics/server.ts`) never reads request headers, drops anything
outside the 4 columns, and always returns `200 { ok }` so a logging failure
can never break a neighbor's workflow. The admin dashboard
(`/admin/analytics`, `GET /api/admin/analytics`) aggregates counts only; the
caller's phone is used solely for the admin gate and is never logged, stored,
or returned. The grant-report CSV (`GET /api/admin/export-grant-report`)
contains counts and the distinct-`install_id` "unduplicated interactions"
number — zero row data. Peer-support need categories stay null until an admin
tags them at claim time (schema supports it; the request form has no category
field by owner decision).

## Location: user-initiated, fuzzed by default, expiring

- **Reads:** geolocation calls exist only behind explicit taps
  (`LocationOnceButton`), in `help.tsx`, `index.tsx`, `sweeps.tsx`,
  `checkin.tsx`. Denying permission breaks nothing — every flow still works.
- **Check-ins:** your exact point is visible only to you. Trusted peers see a
  fuzzed ~150m approximation (coordinates rounded server-side), and only
  while you're actively sharing. Pausing hides you instantly. Check-ins expire
  after 24 hours (`visible_until = checked_in_at + 24h`).
- **Emergency alerts:** three sender-chosen options per alert — none, fuzzed
  (~150m), or exact — never pre-selected (the selector defaults to null and
  Send stays disabled until you choose). Exact is visible only to the notified
  people plus MPRCC staff, and it expires with the alert. A database trigger
  nulls coordinates above the chosen consent level, so over-sharing is
  structurally impossible.
- **Peer-support requests, needs, push registration:** no location at all.

## Time limits everywhere

- Emergency alerts: expire 24h after creation; resolvable history is
  admin-only.
- Check-ins: visible 24h, then read as not-sharing.
- Peer invite codes: 6 characters, 48h expiry; lookup rate-limit ≤10/day.
- Peer notes: ≤140 chars, ≤20/day, mutual-peers-only.
- Peer-support + supply rows: anonymized 30 days after fulfillment
  (`anonymize_at`).

## Business hours + after-hours consent

HomeTeam members receive emergency alerts and group notices during normal
hours (8am–6pm Monday–Friday, Marin-local) UNLESS they have consented to
after-hours messages (`consents_to_after_hours`, default OFF, self-service
only — anyone may set only their own). Off-hours sends without consent drop
HomeTeam from the audience (or gently decline); sends that would reach nobody
raise instead of failing silently. After-hours consent can be changed anytime.

## Trusted peers: mutual consent, nothing automatic

Invites go by phone number with a consent card (or a 6-char code shared in
person — never SMS from the app). Accept and decline are both explicit;
declines are silent. Removing a peer deletes both directions. There is no
auto-suggest, no auto-match, no on-device contact upload — matching happens
only for numbers someone typed. Notes to peers read honestly: unsent shows as
"saved, not delivered."

## Staff roles + row-level security

- **Admin (Jenn + Bambi):** everything — all views, roster management,
  staff-override alert clear, outcome analytics, peer-support delegation,
  directory + group notices, analytics dashboard.
- **Limited staff (Tracey, `staff_limited`):** active alerts + open needs,
  sweep verify/flag, supply claim/deliver. Never: alert override-clear, admin
  settings, roster/roles, outcome analytics, analytics dashboard, directory
  phones or notice history.
- Enforcement is server-side on every call (`outreachIdentity` live-roster
  lookup, `isRosterAdmin`, DB `is_roster_admin/is_roster_staff` + RPC-internal
  gates), and directory/summary payloads are redacted server-side — never
  client-filtered. Denied callers get the calm line
  ("This space is for the outreach team."), never data.
- Tables carry phone-bound RLS (`push_tokens`, peers, alerts); RPCs are
  `SECURITY DEFINER`, phone-normalized, with calm errors.

## What we ask for, and why

- **Phone number:** so peers, supporters, and outreach can reach you back —
  typed by you, per flow, never harvested. Shown only to people entitled to
  see it (your chosen audience, roster admins for follow-up).
- **Notification permission:** exactly once, behind your "Allow" tap, so this
  device can receive the alerts and replies you asked for. Registering the
  token is a separate explicit call; the server never pushes to a phone
  without a stored token.
- **Nothing else.** No accounts, no contacts upload, no device identifiers in
  analytics, no advertising, no tracking pixels.
