# SafeGround API reference

All API routes are TanStack Start v1 server routes: `createFileRoute` +
`server.handlers` in `src/routes/api/*`. (A bare `export async function GET()`
in those files is NOT picked up — requests would fall through to the SPA shell.)

**Identity model.** Most routes read the caller's phone from the
`?phone=` query param or the `x-sg-phone` request header (normalized to digits,
last-10-digit match against the live `outreach_roster`). Roles:
`admin` (Jenn + Bambi), `staff_limited` (Tracey), or non-roster.

**Calm errors.** Non-roster/denied callers get HTTP 403 with a calm,
trauma-informed line — never queue detail, never rows:
- Outreach/directory/admin-analytics: `"This space is for the outreach team."`
  (`OUTREACH_CALM_LINE`, `src/lib/outreachServer.ts`).
- Peer-support queue/claim: `"This queue is for the MPRCC outreach team."`
- DB-down reads: `503` + a calm "try again in a moment" line.

**Analytics intake double-entry note.** `POST /api/analytics/log` accepts
camelCase `{ eventType, category, status, installId }` and always returns
`200 { ok }` (a logging failure must never break a neighbor's workflow).
Snake_case bodies validate-drop to `{ ok: false }` with 200 — by design; only
the 4 known columns are ever written.

---

## Public (no identity)

### `GET /api/health`
DB health check. No row data, no credentials.
→ `200 { ok:true, db:"reachable", resources:<n>, sweeps:<n> }`
DB down → `503 { ok:false, db:"unreachable", hint }` (names the
`[YOUR-PASSWORD]` placeholder when that's the cause).

### `GET /api/push-config`
Public Firebase web-push config: exactly the 6 browser-safe keys
(`apiKey, authDomain, projectId, appId, messagingSenderId, vapidKey`) plus
`configured`. The service account / private key is never returned.

## Push (`/api/push/*`)

### `POST /api/push/register` — any phone, header/body parity
Body `{ phone, token, deviceLabel? }`. Phone must be ≥10 digits; token ≥20
chars; if the `x-sg-phone` header is present it must match the body phone.
→ `200 { ok:true, phone, registered:true }`
Errors: `400` short phone / missing token (calm lines); `403` phone mismatch;
`503` DB down. Writes `push_tokens(phone, token)` — consent is the user's
Allow tap plus this explicit store call.

### `POST /api/push/send` — self-test (own phone) or roster admin
Body `{ phone|token, title?, body, link?, validateOnly? }`.
Server gate (`gateSend`): caller may send only to their OWN phone, or — as a
roster admin — to roster recipients. `validateOnly:true` runs FCM
`validate_only` (auth + validation, no delivery) for the "Check wiring" step.
→ `200 { ok, results[], sent, unregistered, validateOnly }`; top-level `error`
carries the first real failure detail. No tokens → `404 { code:"no_tokens" }`.
Business-hours rules live in the CALLING routes, not here. Never 911.

## Peer support (`/api/peer-support/*`)

### `POST /api/peer-support/` — public, phone required
One-tap request. Body `{ phone, name?, note? }` (phone ≥10 digits; name ≤40,
note ≤500). Inserts `peer_support_requests(status 'open')`, logs an anonymous
`peer_support_request` analytics event (fire-and-forget), then fans a Firebase
push out to the two roster admins ONLY — never 911, never SMS.
→ `200 { ok:true, id, status, createdAt, teamNotified }`
(`teamNotified` is honest: true only when an admin device had a registered
token.) Errors: `400` short phone; `503` table missing / DB down.

### `GET /api/peer-support/?phone=…` — own requests only
Query `phone` or `x-sg-phone` (≥10 digits). Returns the caller's own last 20
(`id, status, note, claimed, createdAt, updatedAt`) — never anyone else's.
Errors: `400` short phone; `503` table missing / DB down.

### `GET /api/peer-support/queue[?status=open|all]` — roster ADMIN only
Working queue (`open`+`claimed`, default) or recent history (`all`). Server
gate: `isRosterAdmin` (Tracey/staff_limited and public → `403 "This queue is
for the MPRCC outreach team."`). Returns full rows incl. phones for follow-up.
Table missing → `503`.

### `POST /api/peer-support/claim` — roster ADMIN only
Body `{ phone, id, action, delegateTo?, outcomeNote? }`.
`action`: `claim` (open→claimed) | `delegate` (open/claimed→claimed +
`delegate_to_phone`) | `done` (+ optional `outcome_note`).
Same admin gate (`403` calm line). → `200 { ok:true, id, action }`.
Errors: `400` missing id / short delegate phone / unknown action; `503` DB down.

## Outreach (`/api/outreach/*`) — roster only

### `GET /api/outreach/summary?phone=…` — roster (role-split payload)
Non-roster → `403` calm line, never counts. Both roles get active sweeps
(report/flag/verify queue), open needs (labels, never requester phones for
staff_limited), active alerts. **Admin-only extras:** contact phones
(`senderPhone`), resolved alerts with outcomes, outcome analytics
(`resolved7d, medianResolveMinutes, withHelperShare`), open peer-support
count. staff_limited payloads never contain neighbor phone digits (last-4 only),
outcome notes, resolved history, or analytics — redacted server-side.

### `POST /api/outreach/act` — roster, per-action gates
Body `{ phone, kind, id, action, note? }`.
- `sweep` verify/flag: any roster role (reported→verified/flagged).
  `resolve`: **admin only** (staff_limited → `403` calm line).
- `need` claim/deliver: any roster role (coordinator claim recorded in the
  note trail; deliver works from open/claimed/in_progress).
- `alert` clear (staff override): **admin only + outcome `note` REQUIRED**
  (`400` without it); reuses the `resolve_emergency_alert` RPC, which rejects
  non-admins itself — staff_limited fails twice over.
Unknown kind/action → `400`. Non-roster → `403` calm line. DB down → `503`.

## Directory + notices (`/api/directory/*`) — roster

### `GET /api/directory/list?phone=…` — roster (role-split rows)
`sg_directory_list` returns rows server-side: admin sees full rows (phone,
kind, opt-in flags); staff_limited sees redacted rows (names + kind + active
only — zero phone digits). Non-roster → `403` calm line.

### `GET /api/directory/eligible?phone=…` — roster, counts only
Live recipient estimate for the notice composer (`sg_notice_eligible`).
Roster-only; staff_limited gets counts, never phones.

### `POST /api/directory/notice` — ADMIN only
Body `{ phone, title, body, audience }` (title ≤80 enforced client-side / ≤120
server trim, body ≤500/700, audience `hometeam|neighbors|both` — none
pre-selected). `sg_send_group_notice` enforces the admin gate +
business-hours rule (8am–6pm Mon–Fri Marin-local unless
`consents_to_after_hours`), raises on empty audience (nothing logged, zero FCM
calls). Fan-out here in the route: `sendFcmMessage` per registered token
(best-effort); `sent_count`/`skipped_no_token` written back. → `200 { ok:true,
notice_id, … }`. Non-admin → `403` calm line. Bad body → `400`.

### `GET /api/directory/notices?phone=…` — ADMIN only
Sent-notice history, newest-first (`sg_notice_history`, admin-checked in DB).

### `POST /api/directory/consent` — self-service (own phone only)
Body `{ phone, afterHours, source? }`. Body phone must equal the caller's own
`x-sg-phone` header — anyone may set ONLY their own after-hours consent, never
anyone else's. → `200 { ok:true }`.

### `POST /api/directory/pause|resume` — ADMIN only
Body `{ phone, target }`. HomeTeam member pause/resume via
`sg_hometeam_pause/resume`, which reject staff_limited in the DB too — double
gate; staff_limited fails with the calm line (`403`).

## Trusted peers (`/api/peers/*`) — phone identity, no roster needed

All routes take caller phone from body `phone` or `x-sg-phone`. Mutual consent
required before any check-in visibility. Missing phone → calm `400` (never a
leak; fixed null-guard post QA-2). RPC errors pass through as calm `400`s;
DB down → `503`.

- `GET /api/peers/?phone=…` — my peers list (invites in/out, accepted).
- `POST /api/peers/` — invite by phone `{ phone, theirPhone }`. Disabled
  client-side until phone-valid + consent checked.
- `POST /api/peers/accept` — `{ phone, inviteId|fromPhone }` → mutual row pair.
- `POST /api/peers/decline` — silent delete of the invite.
- `POST /api/peers/remove` — delete both directions.
- `POST /api/peers/notes` — save a ≤140-char note to a mutual peer
  (≤20/day; `delivered_at` NULL reads honestly as "saved, not delivered").
- `GET /api/peers/notes?phone=…` — read my notes.
- `POST /api/peers/codes` — mint a 6-char invite code (48h expiry, share via
  system share sheet — never SMS).
- `POST /api/peers/codes/use` — redeem a code.

Lookup rate-limit ≤10/day (in DB). On-device matching only, no auto-suggest.

## Analytics (anonymous, zero-PII)

### `POST /api/analytics/log` — public intake
Body camelCase `{ eventType, category?, status?, installId? }`; `eventType` ∈
`resource_search | peer_support_request | sweep_alert_view | check_in`.
Validates (category ≤40, status ≤20, installId must be UUID) and writes exactly
4 columns. Always `200 { ok }` — failures never break workflows. Never reads
headers, IP, UA, phone, coords, or free text.

### `GET /api/admin/analytics` — roster ADMIN only
Aggregates over `analytics_events` only: month counts (peer-support, check-ins,
resource searches, distinct-install active users), top categories (≤6), weekly
activity. Caller phone from `x-sg-phone` is used ONLY for the admin gate —
never logged, never in the payload. Non-admin/anon → `403` calm line;
Tracey (staff_limited) → `403`. Table missing / DB down → `503`.

### `GET /api/admin/export-grant-report[?month=YYYY-MM]` — roster ADMIN only
Grant CSV for the month window (default: current month): totals per event type,
top categories, `unduplicated` (distinct install_id) — counts only, zero row
data/phones/names/coords/notes. Same admin gate (`403` calm line).

## Admin bootstrap

### `POST /api/admin/bootstrap` — disabled unless `ALLOW_DB_BOOTSTRAP=1`
Idempotent schema apply + demo seed. Without the env var → `403` + calm hint
(live-verified disabled). With it → `{ ok:true, … }`; failure → `503`.
