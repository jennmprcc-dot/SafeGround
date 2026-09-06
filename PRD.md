# SafeGround — AI Safety Net · Product Requirements Document (PRD)

**Status:** Team working draft · Rev 1 · 2026-09-06 · Owner: product-designer · Not owner-ratified
**Scope:** MVP (Navigator + Sweep Alerts + Check-Ins) fully specified; Wave 2 (Supply Requests, Peer Chat + AI triage, Outreach Dashboard) specified as brief stories + acceptance sketches.
**Platform:** Mobile-first web app, single public URL. Mobile is PRIMARY; desktop is optional enhancement.
**Stack reality (for requirements context):** Supabase-ready data layer (tables: users, sweeps, supply_requests, resources, check_ins). Mapbox-style maps via env-var placeholder (no real key in app yet — UI must degrade gracefully). Free-tier hosting.

---

## 1. Product Overview

**What it is.** SafeGround is a calm, mobile-first safety companion for people experiencing homelessness and the outreach workers and trusted peers who support them. It answers three urgent questions:

1. *Where can I get help nearby?* → Resource Navigator
2. *Is it safe to stay where I am tonight?* → Sweep Alerts
3. *Will someone notice if I don't check in?* → Safe Sleeping Check-Ins

**What it is not.** Not a surveillance tool. Not a social network. Not a crisis hotline replacement. No background location tracking, ever. Every location share is a deliberate, visible, revocable user action.

**MVP definition of done.** A hosted build at the public URL where a first-time user on a phone can, without creating friction or fear: find a nearby resource (list + map + detail), view sweep alerts on a map, file a sweep report, check in for the night with at least one trusted peer, and have an overdue (12h+) check-in surface a gentle alert to those peers. Works on poor connectivity for list views (cached/text-first).

---

## 2. Who It's For (Personas)

### P1 — Unhoused neighbor (primary user)
- Phone: low-end Android, prepaid data, intermittent connectivity, small storage. May share a device.
- Goals: find food/shelter/clinic fast; know if a sweep is coming; let one trusted person know "I'm okay."
- Constraints: low battery anxiety, low trust in institutions, possible low literacy / English as second language, possible trauma history.
- Needs: big touch targets, plain language, works offline-ish, no account wall for read-only safety info, private by default.

### P2 — Outreach worker / volunteer (secondary)
- Phone + occasional desktop. Verifies sweep reports, updates resource listings, watches dashboard.
- Goals: push accurate sweep info, keep resource data fresh, see who is overdue without violating privacy.
- Needs: quick verify/flag actions, bulk-friendly dashboard, clear data provenance (who reported what, when).

### P3 — Trusted peer (friend, family, mutual-aid buddy)
- Added by P1 via invite code/link. Sees only what P1 explicitly shares (latest check-in point + status), nothing else.
- Goals: know their friend is okay; get a gentle nudge (not an alarm) if friend is overdue.
- Needs: consent receipt ("Maya shares check-ins with you. She can stop anytime."), one-tap "I'm here if you need" response.

### Non-users we protect
- People who never sign up must still be able to **view** sweep alerts and resources without an account. Account required only for: posting reports, check-ins, peer links, supply requests, chat.

---

## 3. Principles (normative — engineer must follow)

1. **Consent-first:** no location leaves the device without an explicit tap on a clearly-labeled action. Sharing scope + duration stated before the tap.
2. **Calm, non-judgmental language:** no sirens, no red flashing, no "WARNING/DANGER/URGENT" metaphors. "Heads-up" not "Alert!". "Overdue for a check-in" not "MISSING".
3. **Privacy legible:** the UI always answers "who sees this, and for how long?" at the point of sharing.
4. **Read without fear:** safety-critical info (sweeps, resources) viewable with zero account, zero location permission.
5. **Offline-tolerant:** list views render from cache; maps degrade to lists; every failed action explains what happened and what to try, gently.

---

## 4. MVP Feature Specifications

### F1 — Resource Navigator
**Purpose:** Find food, shelter, water, restrooms, clinics, charging/Wi-Fi, legal aid, day centers nearby.

**User stories:**
- [N-1] As an unhoused neighbor, I can browse resources by category without signing in or sharing location, so I can get help without fear.
- [N-2] As a user with poor signal, I can still see a text list of resources (cached) even when the map won't load, so I'm not stranded.
- [N-3] As a user, I can optionally center results near me with one tap ("Use my location once"), understanding it's a one-time lookup, so results are relevant.
- [N-4] As a user, I can open a resource detail showing hours, address, phone (tap-to-call), what to expect ("ID needed? line forms at 6pm?"), and last-verified date, so I don't waste a trip.
- [N-5] As an outreach worker (signed in), I can suggest a correction to a listing, so data stays fresh.

**MVP scope:** 8 categories: Food, Shelter & Sleep, Water, Restrooms & Showers, Health & Clinics, Charging & Wi-Fi, Legal Aid, Day Centers. Seed list (fictional-but-plausible demo data acceptable). Search-by-name + category filter. Sort: nearest (if one-time location granted) else A–Z. Detail screen per §WIREFRAMES.

**Acceptance criteria:**
- [AC-N1] Categories → list loads in ≤3 taps from Home with no login and no location permission prompt.
- [AC-N2] Location permission is requested ONLY after tapping "Use my location once"; copy states one-time use, nothing stored (see Privacy Req R-P3). Denying permission leaves list fully usable.
- [AC-N3] Resource detail shows: name, category, address, hours, phone w/ `tel:` link, "what to expect" note, last-verified date. Missing fields render as "Not confirmed yet — call ahead if you can" (never blank).
- [AC-N4] Map view and list view toggle; if map SDK/key unavailable or offline, map pane shows the designed fallback (message + list shortcut), and list remains fully functional.
- [AC-N5] "Suggest a correction" requires sign-in; anonymous users see sign-in prompt explaining why ("so we can follow up").
- [AC-N6] Text-first rendering: list readable at 2G-equivalent throttling in QA (engineer to verify with devtools throttling).

### F2 — Sweep Alerts
**Purpose:** Show where encampment sweeps / clearances are active or planned, and let the community report what they see.

**User stories:**
- [S-1] As an unhoused neighbor, I can see active and planned sweeps on a map/list without signing in, so I can decide where to sleep.
- [S-2] As a witness (signed in), I can report a sweep with location I choose (pin I place or "use my location once"), date/time seen, and optional note/photo-free description, so others are warned.
- [S-3] As a user, I can see whether a report is community-reported or outreach-verified, with report age, so I can judge trust.
- [S-4] As an outreach worker, I can verify or flag a report, so misinformation gets corrected fast.
- [S-5] As a user, I can get plain-language guidance with each sweep ("What you can do tonight" — 3 calm steps), not just a pin.

**Sweep lifecycle:** `reported` (community) → `verified` (outreach confirms) → `resolved/expired` (passed date + 48h, or outreach marks resolved). Planned = scheduled date in future; Active = happening now / within 24h window.

**Acceptance criteria:**
- [AC-S1] Sweep map + list viewable with no login and no location permission.
- [AC-S2] Pins distinguish three states (active / planned / resolved-recent) by color + shape + label (never color alone — see Design System).
- [AC-S3] Report flow (signed-in only): place-a-pin (default, no permission needed) OR one-time location; date/time defaults to now; optional free-text note (500 chars); consent checkbox: "I understand this report, with the location I placed, will be visible to everyone." Report appears as `reported` immediately with "awaiting verification" badge.
- [AC-S4] Each sweep detail shows: status badge, date/time window, source label ("Reported by a neighbor · 2h ago" vs "Verified by outreach · name/team"), note, "what you can do tonight" guidance, and nearest resources shortcut (2–3 links).
- [AC-S5] Outreach role can Verify / Flag / Resolve from detail screen; every transition writes timestamp + actor; flagged reports show "being reviewed" state, never silently deleted from reporter's view (reporter sees "under review — thanks for reporting").
- [AC-S6] No panic UI: no auto-play sounds, no vibration alarm, no red full-screen takeover on new sweep. New/updated sweeps surface as a calm toast + badge count.
- [AC-S7] Abuse guard (MVP-minimal): rate-limit reports per account (e.g., max 10/day), note field strips links rendering (render as plain text), outreach flag queue exists.

### F3 — Safe Sleeping Check-Ins ("I'm okay" loop)
**Purpose:** A lightweight promise: "I checked in at 10pm near here. If I don't check in again within 12h, nudge my trusted people — gently."

**User stories:**
- [C-1] As a user, I can check in for the night with one deliberate tap that shares a point with ONLY my chosen trusted peers, for 24h, so someone knows I'm okay.
- [C-2] As a user, I can add/remove trusted peers via invite code, and see exactly who can see my check-ins, so I stay in control.
- [C-3] As a user, I can see my check-in history (last 7 days, statuses only) and stop sharing anytime ("Pause sharing" / "Remove peer").
- [C-4] As a trusted peer, I can see my friend's latest status + point on a small map, and send a preset kind response ("Thinking of you — reply when you can"), so I can reach out without pressure.
- [C-5] As a trusted peer, if my friend is 12h+ overdue, I see a gentle overdue card — not an alarm — with suggested next steps, so I know what to do.

**Core rules:**
- Check-in payload: timestamp + user-placed or one-time-location point (fuzzed to ~150m on peer map — display "approximate area") + optional note (140 chars) + duration (default 24h visibility).
- Overdue = now > last check-in time + 12h. Overdue notifies ONLY the user's own trusted peers (in-app + optional SMS/email if peer opted in — Wave 2 for SMS; MVP in-app only).
- No peer sees history beyond latest status + last 7-day status dots (no trail map).

**Acceptance criteria:**
- [AC-C1] Check-in requires sign-in + explicit tap on "Check in & share with [N] peers". Pre-confirm sheet states: who sees it (names), what (approximate area + time), how long (24h). No background or auto check-ins exist.
- [AC-C2] Peer add: user generates invite code (6 chars, 48h expiry); peer redeems while signed in; both sides see a consent receipt. Peer remove is instant, one tap, no confirmation maze ("Remove" → done + toast "Ari can no longer see your check-ins").
- [AC-C3] Find-my-friend map (peer view): shows ONLY friends who share with me, latest point fuzzed (~150m circle, "approximate area"), status chip (Okay / Overdue — gentle wording: "Checked in 3h ago" / "Hasn't checked in for 14h — a gentle check-in could help").
- [AC-C4] Overdue UX: at 12h the checker sees a self-nudge ("You haven't checked in since 10pm — want to let your peers know you're okay?" + [Check in now] [Snooze 2h]); peers see overdue card (see WIREFRAMES). No sirens, no auto-escalation to authorities, no public display.
- [AC-C5] "Pause all sharing" one-tap kill switch on Check-In home; when paused, peers see "Not sharing right now" (not last location).
- [AC-C6] Empty states: no peers yet → kind explainer + [Invite a peer]; no check-ins yet → [Check in for tonight].

---

## 5. Wave 2 Features (brief stories + acceptance sketches — engineer: build after MVP verified)

### F4 — Supply Requests
- [Q-1] As a neighbor, I can request supplies (blanket, socks, water, hygiene, phone charging, pet food) with a pickup preference (resource location or outreach meetup), so I get essentials without begging.
- [Q-2] As outreach, I can see open requests on the dashboard, claim/fulfill/cancel, so nothing falls through.
- Acceptance sketch: request form (items multi-select + note + contact preference + consent: "visible to outreach teams only"); statuses open → claimed → fulfilled/cancelled; requester sees status timeline; no precise home location required (pickup point chosen from resource list or "I'll meet outreach at…").

### F5 — Peer Support Chat with AI Triage
- [H-1] As a neighbor, I can chat with peers/outreach in a moderated room or 1:1, so I'm less alone at night.
- [H-2] As a user expressing distress, I get a private, gentle AI-triage nudge (HuggingFace-backed) with grounding resources + human handoff, never a diagnosis, so risk is caught kindly.
- Acceptance sketch: rooms list + thread; preset kind openers; block/report in 2 taps; AI triage runs server-side on message text, surfaces private support card ONLY to the author (+ outreach flag on explicit self-harm language); zero tolerance for medical/diagnostic claims in copy; crisis resources card (call/text 988 US — locale-configurable) shown without alarm styling; all moderation actions logged.

### F6 — Outreach Dashboard
- [D-1] As outreach, I can see at a glance: sweeps needing verification, overdue check-in counts (aggregated, no individual trails), open supply requests, flagged chat items, so I can prioritize a shift.
- [D-2] As outreach admin, I can manage resources (add/edit/verify) and users' role flags, with an audit log.
- Acceptance sketch: cards + queues with counts; verify/flag/resolve inline; resource editor; audit log (actor, action, timestamp); aggregated-only overdue stats (e.g., "6 people overdue 12h+ in Area X" — never live trails); CSV export (free-tier friendly).

---

## 6. Privacy + Safety Requirements (explicit, testable)

| ID | Requirement | Test |
|----|-------------|------|
| R-P1 | ALL location sharing is user-initiated. There is NO background, passive, or automatic location collection anywhere in the app. | Code review: no geolocation watch/background APIs; QA: deny permission → all read flows work; only share-taps prompt. |
| R-P2 | Before every share-tap, UI states WHO sees it, WHAT (approx. area vs exact), and HOW LONG. | QA checklist on: check-in confirm, sweep report consent, one-time "near me" lookup. |
| R-P3 | "Use my location once" performs a single foreground read, never stored server-side except inside the user-approved payload (check-in point / report pin). Proximity sorting happens client-side where possible. | Network inspect: no location fields on unrelated requests; DB review: no location columns written outside check_ins/sweeps payloads. |
| R-P4 | Peer map shows fuzzed points (~150m radius circle, labeled "approximate area"). Exact coordinates never shown to peers. | QA: peer map copy + circle render; API returns rounded/fuzzed coords to non-owners. |
| R-P5 | Removing a peer or pausing sharing takes effect immediately; ex-peers see "Not sharing" and no last point. | QA: remove → peer view re-check shows no point within 5s/refresh. |
| R-P6 | Sweep reports and resource views require NO account and NO location permission. | QA: logged-out session completes N-1, S-1 flows. |
| R-P7 | Accounts use minimal data (display name or alias allowed; no legal-name requirement). Shared-device safety: visible Sign out on every main screen footer/menu; session expiry 30 days. | QA: alias signup accepted; sign-out reachable ≤2 taps from Home. |
| R-P8 | Overdue alerts go ONLY to the user's own trusted peers (MVP: in-app). Never public, never to authorities automatically, never broadcast. | QA: overdue fixture → only linked peers' inboxes update. |
| R-P9 | Chat (Wave 2): AI triage output is private to the author + flagged-to-outreach only on explicit risk language; no diagnostic wording; crisis card always available, never forced modal. | Copy review + QA with test phrases. |
| R-P10 | Data retention (MVP default): check-in points auto-expire from peer visibility after 24h; sweep reports auto-expire to resolved 48h after window; supply requests anonymized on fulfillment +30d. Documented in Privacy Notes doc. | DB TTL/cron or app-level expiry verified in QA. |
| R-P11 | Every error/empty state explains without blame and offers a next step; no error text exposes stack traces, UIDs, or coordinates. | QA: airplane-mode + denied-permission walkthrough. |

---

## 7. Trauma-Informed UX Checklist (engineer implements; QA signs off)

- [ ] Language: "heads-up," "okay," "when you're ready," "no rush." Banned in UI: "WARNING," "DANGER," "URGENT," "MISSING," "non-compliant," any siren/alarm metaphor. Error titles never blame ("That didn't go through" not "You failed…").
- [ ] Consent-first: every share preceded by plain-language scope; destructive/visible actions (remove peer, publish report) confirm in the user's own words where feasible.
- [ ] Control & reversibility: every share has a visible undo/stop (Pause sharing, Remove peer, Delete report-draft). Back buttons never discard without a saved draft where text was entered.
- [ ] No lurid imagery: no photos of sweeps, encampments, or distress. Map pins are abstract shapes; empty-state illustrations (if any) are calm abstract (hills, blanket, cup) — never depict people in crisis.
- [ ] Predictability: buttons do what they say; no surprise permission prompts (permission only after explicit "use location" tap); no auto-play media; no counts that feel like surveillance ("3 people viewing you" — forbidden).
- [ ] Low-pressure CTAs: "Check in when you're ready" alongside "Check in now"; "Skip for now" on every non-essential step; snooze options on nudges.
- [ ] Readability under stress: ≥16px body, high contrast (≥4.5:1 body text), one idea per screen in flows, progress ("Step 2 of 3") on multi-step forms.
- [ ] Shared-device safety: no full names required, quick sign-out, no sensitive content in push/toast previews (MVP: "SafeGround: a gentle update is waiting" — never "Maya is OVERDUE").
- [ ] Gentle feedback: success toasts affirm ("You're checked in — rest easy."), errors soothe + guide ("No connection right now — your draft is saved. Try again when you can.").
- [ ] Exit ramps: every deep flow links Home + "Talk to someone" (peer chat Wave 2; MVP: crisis-resources sheet link) without hijacking the flow.

---

## 8. Non-Functional Requirements

- **Performance:** First contentful paint < 3s on throttled 4G; list views usable at 2G throttle; map is progressive enhancement, never a blocker.
- **Accessibility:** WCAG 2.2 AA target: 44px+ touch targets, visible focus rings, screen-reader labels on all pins/controls, no color-only meaning, `prefers-reduced-motion` respected.
- **Offline tolerance:** Cache resource list + sweep list (last-good) in localStorage/IndexedDB; show "Updatedxh ago · showing saved list" banner; queue check-in/report drafts locally, send when online.
- **Security:** Supabase RLS on all tables; client never writes another user's rows; invite codes single-purpose + expiring; rate limits on reports/chat (Wave 2).
- **Analytics:** None in MVP beyond privacy-respecting counts (no per-user tracking, no third-party trackers).

## 9. Out of Scope (MVP)

Push/SMS notifications (Wave 2), accounts for read-only flows, photo uploads, public leaderboards/counts of people, any predictive "risk score," multi-language (structure copy for i18n; English only in MVP), desktop-first layouts.

## 10. Open Questions for Lead

1. Locale for crisis number (default 988 US?) — assumed US, configurable constant.
2. Outreach role provisioning: manual flag by lead in MVP (assumed yes).
3. Seed data: fictional demo resources/sweeps acceptable for launch (assumed yes, clearly labeled "demo data").

---

*Engineer entry point: build order Home → Navigator → Sweeps → Check-Ins; privacy reqs R-P1…R-P11 are launch-blocking; trauma checklist must pass QA before publish.*
