# SafeGround — Mobile-First Wireframes

**Status:** Team working draft · Rev 1 · 2026-09-06 · Owner: product-designer
**Canvas:** 390×844 logical (iPhone-class). All screens: 16px gutters, bottom nav (MVP), paper background, white cards.
**Legend for ASCII:** `[btn]` button · `(chip)` filter/badge · `---card---` card · `((sheet))` bottom sheet · `[==map==]` map pane · `TAB:` bottom nav · `>` tap flow.
**Companion docs:** PRD.md (requirements, acceptance criteria) · DESIGN_SYSTEM.md (tokens, components, pins).

---

## 0. Global Navigation + App Shell

**Bottom nav (all authenticated + anonymous main screens), 4 tabs, 56px + safe-area, night `#22303A` bar, paper icons+labels:**
`TAB: [Home] [Find help] [Sweeps] [Check in]` — active tab sage underline + filled icon. Badge counts: Sweeps tab shows calm clay dot + count of active (max "9+"); Check-in tab shows dot only when self overdue (no number, no name).

**Header (all screens):** App wordmark "SafeGround" small left + right-side icon buttons: [?] "About & privacy" (→ "What am I sharing?" consent summary) and [≡] menu (Sign in/out, crisis resources, settings). Screen H1 below header. Back `<` on sub-screens; back never discards typed drafts (autosave + "Draft saved" toast).

**Global states:** offline banner under header when cached: "No connection — showing saved list from {Xh ago}." Focus order: header → H1 → primary action → content. Toasts above nav (see Design System §4.8).

---

## 1. Home / Landing (route: `/`)

**Purpose:** calm front door; 3 safety jobs in ≤1 scroll; anonymous-first.

```
┌─────────────────────────┐
│ SafeGround        [?][≡] │
│                         │
│  Good evening.          │  ← Display 28, time-aware greeting
│  Find rest, food, and   │
│  people who care.       │
│                         │
│ ---card: tonight?---    │
│ 🌙 Heads-up near you    │
│ 2 active sweeps reported│
│ in your saved area      │
│ [See sweeps]            │
│ (hidden if none: show   │
│  "No sweeps reported in │
│   your saved area.")    │
│                         │
│ [ Find food & shelter ] │  ← primary sage, full-width
│ [ See sweep heads-ups ] │  ← secondary
│ [ Check in for tonight ]│  ← secondary (+ lock note if signed out:
│                           "Sign in to check in")  
│                         │
│ ---card: nearby?---     │
│ 3 shelters · open now   │
│ [Use my location once]  │
│ caption: only this      │
│ lookup, nothing stored  │
│                         │
│ footer: crisis? [Talk   │
│ to someone] · demo data │
│ note · Sign in/out      │
TAB: Home Find help Sweeps Check in
```

- Signed-out: third CTA opens sign-in sheet (why: "so your peers know it's you").
- Crisis link always visible, quiet styling, never a modal trap.

---

## 2. Resource Navigator

### 2a. Category select (route: `/help`)
```
│< Navigator               │
│ Find food, rest, care   │  ← H1 22
│ (search box: "Search    │
│  name or place…")       │
│                         │
│  2-col chip grid:       │
│ [🍲 Food] [🌙 Shelter]  │
│ [💧 Water] [🚻 Showers] │
│ [＋ Clinics][⚡Charge]  │
│ [⚖ Legal] [☀ Day ctr]  │
│                         │
│ [Use my location once]  │  ← quiet w/ caption
│ toggle: [List|Map]      │
```
Tap chip → filters list below (multi-select allowed); search filters by name.

### 2b. List view (default — offline-safe)
```
│ 8 places · open now: 5  │  ← small count line
│ Updated 20 min ago      │
│ ---row---               │
│ [🍲] St. Mary's Kitchen │
│      Food · 0.4 mi ·    │
│      Open till 7pm ✓Verified │
│ ---row---               │
│ [🌙] Harbor Night Shelter│
│      Shelter · 1.1 mi · │
│      Line forms 6pm     │
│ ... (infinite scroll,   │
│  skeleton rows while    │
│  loading: 3 gray bars)  │
```
- **Empty:** "No {category} found nearby yet. [Clear filters] [See all resources]".
- **Error/offline:** cached list + banner "Showing saved list from 2h ago."

### 2c. Map view
```
│ [==map: sky resource    │
│  pins, legend chip      │
│  bottom-left, +/- right ││
│  "locate-me-once" btn]  │
│ ((peek sheet: nearest 3 │
│  as rows; drag up for   │
│  full list))            │
```
- No-key/offline fallback panel replaces map: "The map needs a connection — the list below has everything. [Show list]".
- Pins: sky tiles w/ category glyph; tap → detail sheet.

### 2d. Resource detail (bottom sheet / page on desktop)
```
│ ((St. Mary's Kitchen))  │
│ (Food) ✓ Verified Mar 3 │
│                         │
│ 📍 412 Harbor Ave       │
│ 🕒 Mon–Fri 11–7 · Sat.. │
│ 📞 (555) 014-2288 [Call]│
│                         │
│ What to expect:         │
│ "No ID needed. Line     │
│  forms at 5:30. Dog-    │
│  friendly patio."       │
│ (missing fields → "Not  │
│  confirmed yet — call   │
│  ahead if you can.")    │
│                         │
│ [Get directions] [Save] │
│ [Suggest a correction]  │  ← sign-in gated w/ reason
│ [← Back to list]        │
```

**Flow:** Home > [Find food & shelter] > /help > chip/search > list ⇄ map > detail > [Call]/[Get directions]. 3 taps to first result.

---

## 3. Sweep Alerts

### 3a. Sweep map + list (route: `/sweeps`, anonymous OK)
```
│< Sweeps                 │
│ Heads-ups from neighbors│
│ (chips: (All)(Active 2) │
│  (Planned 1))           │
│ [==map: ●clay active ×2 │
│  ◆gold planned ×1,      │
│  legend chip]           │
│ [＋ Report what you see] │ ← FAB-style primary; gated
│ ---list under map---    │
│ [●] Active · River St underpass │
│     Reported 2h ago · awaiting  │
│     verification · 0.6 mi      │
│ [◆] Planned · Parkside, Fri 8am│
│     Verified by outreach · Team Maya│
```
- New/updated sweep = calm toast "A new heads-up was added near your saved area." + tab dot. No sound/vibration.
- **Empty:** "No sweeps reported in this area right now. Rest easy — check back anytime. [Report what you see]".
- **Loading:** skeleton pins + rows. **Error:** cached list + banner.

### 3b. Report form (signed-in; 3 steps, progress "Step X of 3")
```
Step 1 Where: map w/ draggable pin (default downtown; NO auto-locate)
  (○) Use my location once  ← caption: single read, only in this report
  [Continue]
Step 2 When: date/time default now; (chips: Happening now / Today / Planned date)
  note box (500): "What do you see? (e.g. officers posting notices)"
  caption: no photos needed; words are enough.
  [Continue] [Back]
Step 3 Review + consent card: Who sees: everyone · What: pin I placed + words ·
  How long: until resolved · [Publish heads-up] [Save draft]
```
Success → toast "Thanks — your report helps neighbors." + detail view with "awaiting verification" badge. Drafts survive back-nav/offline (local queue).

### 3c. Sweep detail (bottom sheet)
```
│ ((● Active · River St)) │
│ Reported by a neighbor ·│
│ 2h ago · awaiting       │
│ verification  —or—      │
│ ✓ Verified by Outreach  │
│ Team Maya · 1h ago      │
│ Window: happening now   │
│ Note: "Notices posted   │
│ for Thursday cleanup."  │
│ ---Tonight, you can:--- │
│ 1. Sleep past 5th St   │
│    tonight if you can.  │
│ 2. Pack papers + meds.  │
│ 3. Nearby: [Harbor      │
│    Shelter 0.8mi]       │
│ [Share this heads-up]   │
│ outreach only: [Verify] │
│ [Flag] [Resolve]        │
```
Flagged → reporter sees "Under review — thanks for reporting" (never silent delete).

---

## 4. Safe Sleeping Check-Ins (route: `/checkin`, signed-in)

### 4a. Check-in home (states)
**Default (not checked in):**
```
│< Check in               │
│ Let someone know        │
│ you're okay.            │
│ ---card---              │
│ Sharing with: Maya, Ari │
│ [Manage peers]          │
│ What they see: approx.  │
│ area + time · 24h ·     │
│ [What am I sharing?]    │
│                         │
│ [Check in & share with  │
│  2 peers]  ← primary    │
│ quiet: Check in when    │
│ you're ready — no rush. │
│ [⏸ Pause all sharing]   │
│ Last: yesterday 10:12pm ✓│
```
**After check-in:** card flips to "You're checked in — rest easy. ✓ 10:12pm · visible to 2 peers until tomorrow 10pm." + [Check in again] [Pause sharing].
**Self-overdue (12h+):** gentle card (clay-wash, no alarm): "You haven't checked in since 10pm yesterday — want to let Maya and Ari know you're okay? [Check in now] [Snooze 2h]".
**Paused:** "Sharing is paused. Your peers see 'Not sharing right now.' [Resume sharing]".
**No peers:** empty state "Check-ins work best with one trusted person. [Invite a peer] [How it works]".

### 4b. Check-in confirm sheet (the consent moment)
```
│ ((Check in for tonight?))│
│ Who sees: Maya, Ari     │
│ What: approximate area  │
│ (~150m) + time + note   │
│ How long: 24 hours      │
│ Where: (○) pin I place /│
│  (○) Use my location once│
│ Note (optional, 140): … │
│ [Share check-in]        │
│ [Not now]               │
```
`>` success toast "You're checked in — rest easy." History below: last 7 days as status dots (Okay / Missed — words + dots).

### 4c. Trusted peers: list + add (routes `/checkin/peers`, `/checkin/invite`)
```
│< Trusted peers          │
│ Only these people can   │
│ see your check-ins.     │
│ ---row: (M) Maya ✓shares│
│  "sees check-ins since Mar"│
│  [Remove]               │
│ ---row: (A) Ari · invite│
│  pending, expires in 2d │
│ [+ Invite a peer]       │
│ Invite sheet: your code │
│ ┌─────┐  M-A-Y-4-K-2    │
│ [Copy link] [Share…]    │
│ "Expires in 48h. Only   │
│  share with someone you │
│  trust."                │
```
Remove → dialog: "Remove Maya? She'll see 'Not sharing' right away and won't be notified with your location." [Remove] [Keep]. → toast "Maya can no longer see your check-ins."

### 4d. Find-my-friend map (peer view, route `/checkin/friends`)
```
│< Friends                │
│ People sharing with you │
│ [==small map: sage pins │
│  + fuzzy 150m circles,  │
│  "approximate area"]    │
│ ---card: (M) Maya       │
│  Checked in 3h ago ·    │
│  near Harbor Ave (approx)│
│  "Out tonight, phone low"│
│  [Thinking of you ♥]    │  ← preset kind response
│ ---card overdue: (J) Jae│
│  clay dot: Hasn't checked│
│  in for 14h — a gentle  │
│  check-in could help.   │
│  Last: yesterday 9pm    │
│  (approx. area only)    │
│  [Send a kind note] [How│
│   to help →]            │
```
"How to help" expands: 1. Text or call if you have their number. 2. Check places they like to rest. 3. Contact outreach [team link] if you're worried — never call authorities from this screen. No trails, no exact addresses, no "view history" beyond 7 status dots.

### 4e. Overdue surfacing (end-to-end)
1. T+12h: checker gets self-nudge card (§4a) — snoozeable 2h, max 3 nudges.
2. Same moment: each linked peer's Friends screen + Check-in tab dot update: "Jae hasn't checked in for 12h+." Toast to peer (if app open): "SafeGround: a gentle update is waiting." — never names/places in preview.
3. Peer taps → overdue card (§4d) → kind note or How-to-help. No auto-escalation, no public feed, no authority contact.

**Interaction flow (check in E2E):** /checkin > [Check in & share] > confirm sheet (who/what/how-long + place-pin/once) > [Share] > toast + status card > peers see updated Friends map within refresh > 24h expiry auto-hides point ("Not sharing right now" NOT last point) > 12h without new check-in triggers §4e.

---

## 5. Wave 2 Sketches (build after MVP verified)

### 5a. Supply Requests (`/supplies`)
List (My requests: status timeline open→claimed→fulfilled) + [＋ Request supplies] form: item multi-select chips (Blanket, Socks, Water, Hygiene kit, Phone charge, Pet food, Other) + note + pickup: resource dropdown or "meet outreach at…" + consent ("visible to outreach teams only") + [Send request]. Outreach view folded into Dashboard queue.

### 5b. Peer Support Chat (`/chat`)
Rooms list (General Night Owls / Local Mutual Aid / 1:1) → thread: bubbles, kind-opener presets ("Can't sleep, anyone up?"), 2-tap block/report on any message, composer with [Send]. Distress language → author-only private card: "That sounds really heavy. You matter here. [Grounding exercise] [Talk to outreach] [Call/text 988]" — no diagnosis, no forced modal; outreach sees flag in Dashboard queue only.

### 5c. Outreach Dashboard (`/outreach`, role-gated)
Top stat cards (Sweeps needing review: N · Overdue 12h+ (area counts only): N · Open supply requests: N · Flagged chat: N) → queues as tables w/ inline [Verify][Flag][Resolve] / [Claim][Fulfill] → tabs: Resources editor (add/edit/verify + last-verified stamp), Team & roles, Audit log (actor·action·time), Export CSV. Aggregated overdue counts only — no individual live trails anywhere.

---

## 6. State Matrix (every MVP screen ships all four)

| Screen | Empty | Loading | Error/offline | Overdue/special |
|--------|-------|---------|---------------|-----------------|
| Home | n/a (static) | skeleton greeting | banner + cached sweep count | — |
| Navigator list | no-results + clear filters | 3 skeleton rows | saved-list banner + retry | — |
| Navigator map | no pins in view + zoom hint | gray pane shimmer | fallback panel + list shortcut | — |
| Sweep list/map | "Rest easy" empty | skeleton pins/rows | cached + banner | new-sweep toast + tab dot |
| Report form | n/a | inline spinner on publish | draft-saved toast + queue | — |
| Check-in home | no-peers explainer | skeleton card | "couldn't load — try again" + retry | self-nudge card §4a |
| Peers | no-peers + invite | skeleton rows | retry | invite-expiry notice |
| Friends (peer) | "No one shares with you yet" + what-to-expect | skeleton cards | retry | overdue card §4d |

---

*Engineer: build in order Home → Navigator → Sweeps → Check-Ins; keep bottom nav + consent-receipt + toast patterns identical across screens; all copy above is final-draft — use verbatim unless a privacy/trauma rule forces a change (then note the change in the PR).*
