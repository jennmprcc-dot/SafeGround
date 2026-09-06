# SafeGround — Design System

**Status:** Team working draft · Rev 1 · 2026-09-06 · Owner: product-designer
**For:** Engineer building mobile-first web app (React + Tailwind). Translate tokens to CSS variables / Tailwind theme directly.
**Tone:** Calm, warm, non-clinical. Think "public library at golden hour," not hospital, not alarm panel.

---

## 1. Color Palette

All pairs checked to WCAG AA (body text ≥ 4.5:1 on its background). Neutrals do the heavy lifting; color is never the only signal (always pair with icon + label).

### 1.1 Core tokens (hex)

| Token | Hex | Usage |
|-------|-----|-------|
| `--sg-ink` | `#1E2A32` | Primary text, icons |
| `--sg-ink-soft` | `#43565F` | Secondary text, timestamps |
| `--sg-paper` | `#F7F4EC` | App background (warm paper, not stark white) |
| `--sg-card` | `#FFFFFF` | Cards, sheets, dialogs |
| `--sg-line` | `#E2DACA` | Borders, dividers |
| `--sg-sage` | `#2F6B4F` | Primary brand / primary buttons / verified badges (white text on sage = 7.0:1) |
| `--sg-sage-deep` | `#234E3A` | Primary button hover/pressed; header accents |
| `--sg-sage-wash` | `#E3EFE6` | Selected states, verified wash |
| `--sg-sky` | `#2A6B8A` | Links, info, map water/secondary accents (white text 5.9:1) |
| `--sg-sky-wash` | `#E0EFF5` | Info banners |
| `--sg-clay` | `#B4552D` | Active-sweep pins, overdue accents — burnt clay, NOT alarm red (white text 4.6:1) |
| `--sg-clay-wash` | `#F7E4D7` | Active-sweep wash backgrounds |
| `--sg-gold` | `#8A6A1B` | Planned-sweep pins, caution badges (white text 4.6:1) |
| `--sg-gold-wash` | `#F5EAD0` | Planned wash backgrounds |
| `--sg-night` | `#22303A` | Bottom nav bar, primary footer (paper text on night = 13+:1) |
| `--sg-focus` | `#1B6FD4` | Focus rings only (3px outline) |
| `--sg-danger-gentle` | `#8C3B2E` | Destructive text (Remove/Delete) on white (5.9:1); used sparingly, never as page wash |

### 1.2 Usage rules
1. **Backgrounds default to paper; content lives on white cards.** Never put body text on clay/gold washes — washes are for badges and map markers only, with ink text.
2. **Status = color + shape + words, always.** Active sweep = clay circle pin + "Active" label. Planned = gold diamond pin + "Planned" label. Verified = sage check badge + "Verified by outreach". Overdue = clay dot + the words "hasn't checked in for Xh".
3. **One calm accent per screen.** Primary CTA sage; secondary actions outlined ink; destructive actions text-only in gentle red. No gradients, no neon, no flashing.
4. **Dark mode (optional, post-MVP):** invert paper→`#18242B`, card→`#22303A`, ink→`#F2EEE2`. Not required for MVP.
5. **Map pins (generic, Mapbox-agnostic):** 28px markers with 2px white stroke + soft shadow; selected pin scales 1.25× and shows label chip. Legend always visible on map screens (see §7).

---

## 2. Typography (mobile-first)

- **Font stack:** system stack only (no webfont download — offline/battery friendly):
  `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **Scale (px / rem / use):**

| Style | Size / Weight / Line-height | Use |
|-------|-----------------------------|-----|
| Display | 28 / 700 / 1.2 | Home greeting, screen titles on landing only |
| H1 | 22 / 700 / 1.3 | Screen titles (Navigator, Sweeps, Check in) |
| H2 | 18 / 650 / 1.35 | Card titles, section headers |
| Body | 16 / 400 / 1.5 | Default text — never smaller for content |
| Small | 14 / 400 / 1.45 | Timestamps, helper text, captions |
| Button | 16 / 650 / 1.25 | Button labels (min 16px so they read under stress) |
| Badge | 12 / 700 / 1.2, uppercase, 0.04em tracking | Status badges only |

- **Rules:** one H1 per screen; sentence case everywhere (never ALL CAPS except 12px badges); links underlined + sky color; numbers for times/counts use tabular figures where available.

---

## 3. Spacing, Radius, Elevation

- **Spacing scale (px):** `4 · 8 · 12 · 16 · 24 · 32 · 48`. Screen gutter: **16px** sides. Card padding: **16px**. Section gap: **24px**. Generous whitespace is a trauma-informed requirement, not decoration.
- **Radius:** buttons/inputs **12px**; cards **16px**; sheets/dialogs top **20px**; pins/badges pill or full-round; resource thumbnails (if any) 12px. No sharp corners on interactive elements.
- **Elevation:** flat-first. Card: `0 1px 2px rgba(30,42,50,.08)`. Sheet/dialog: `0 8px 32px rgba(30,42,50,.18)` + 60% ink scrim (`rgba(30,42,50,.6)`). No elevation on buttons (use color, not shadow).
- **Touch targets:** minimum **48×48px** for all interactive elements; 8px minimum gap between adjacent targets.
- **Iconography:** 24px line icons (2px stroke, round caps), ink by default. Use universally legible glyphs: bowl/cup (food), moon + blanket (sleep), drop (water), plus-sign (clinic), bolt (charging), scales (legal), sun (day center), bell-with-moon (sweep), check-circle (verified), person (peer). No sirens, no exclamation-triangle as decoration. Every icon that carries meaning ships with a text label. Emoji: avoid in chrome; acceptable in peer preset messages only.

---

## 4. Core Component Specs (build these once, reuse)

### 4.1 Buttons
- **Primary:** sage fill `#2F6B4F`, white 16px/650 text, 12px radius, full-width on mobile forms (min height 52px), inline otherwise (min 48px). Hover/press: sage-deep. Disabled: 40% opacity + `aria-disabled`, helper text explains why.
- **Secondary:** transparent fill, 2px ink border, ink text. Same sizing.
- **Text/quiet:** sky underlined text, 48px target. Used for "Skip for now," "Learn more."
- **Destructive:** text-only, gentle-red, never a filled red button. Confirm via dialog (see §4.5).
- **Location CTA pattern (mandatory):** label states single-use — e.g. "Use my location once" with sub-caption "Only this lookup · stays on your phone unless you share it." Never a bare "Enable location."

### 4.2 Cards
White, 16px radius, 1px line border + flat shadow, 16px padding. Card anatomy: eyebrow badge (optional) → H2 title → 1–2 lines body (ink-soft) → meta row (small: distance / time / verified) → action row (buttons right- or full-width). Whole-card tap allowed only when single action; otherwise explicit buttons (no nested taps).

### 4.3 List items (resource / sweep / peer rows)
72px+ rows, 16px padding, icon-in-wash tile (48px rounded square, category-tinted wash) left, title + 1-line meta center, chevron/status right. Dividers 1px line. Distance/time right-aligned small. Verified rows get sage check inline. Overdue peer rows get clay dot + words (never dot alone).

### 4.4 Map pins & legend
- **Pins (28px, white 2px stroke, shadow):** sweep-active = clay circle with moon glyph; sweep-planned = gold diamond with calendar glyph; sweep-resolved = gray/ink-soft circle, 60% opacity; resource = sky rounded-square with category glyph; friend = sage person-pin with white ring.
- **Clusters:** ink pill with count + "Zoom in to see each one."
- **Legend:** persistent bottom-left chip row on every map ("● Active ◆ Planned ■ Resource"), expandable to full legend sheet. Selected pin opens bottom sheet (never a tiny popup).
- **Fallback (no key/offline):** map pane replaced by illustrated panel: calm message + [Show list instead] + [Try map again]. List always works.

### 4.5 Modal / dialog vs bottom sheet
- **Dialog (center, max-width 340px):** confirmations with consequences (Remove peer, Publish report, Pause sharing). Title + plain-language consequence + [Confirm in plain words] + [Keep as is]. Scrim dismiss = cancel.
- **Bottom sheet (mobile default for details):** resource detail, sweep detail, check-in confirm, peer actions. Drag handle, 20px top radius, 60% scrim, swipe-down or [Close]. Peek (40%) → expand (90%). Focus trapped; ESC/close returns focus to trigger.

### 4.6 Form inputs
16px text, 12px radius, 2px line border, 52px min height; focus = 3px focus-blue outline + border ink. Labels above (16px/650), helper text below (14px ink-soft), errors below in gentle-red with suggestion ("That didn't go through — check the date and try again."). Category selection = 2-column chip grid (icon + label, sage-wash when selected, multi-select where relevant). Date/time = native inputs. Notes = textarea with character count, drafts autosaved locally.

### 4.7 Status badges
12px uppercase pill, icon + word: `Verified` (sage-wash/sage), `Reported · awaiting verification` (gold-wash/gold-ink `#6B5212`), `Active` (clay-wash/clay), `Planned` (gold-wash/gold), `Resolved` (line/ink-soft), `Okay` (sage-wash/sage), `Overdue — gentle check-in` (clay-wash/clay). Never badge-only; always adjacent to explanatory line.

### 4.8 Toast / feedback
Bottom-above-nav toast, ink background, paper text, 12px radius, 4s duration, optional action. Copy bank: success — "You're checked in — rest easy." / "Thanks — your report helps neighbors."; info — "Showing saved list from 2h ago."; error — "No connection right now — your draft is saved. Try again when you can. [Retry]". No toast ever contains names, locations, or overdue status (shared-device safety).

### 4.9 Consent receipt pattern (reused everywhere sharing happens)
A bordered card listing: **Who sees this** (names/roles) · **What they see** (approximate area + time) · **How long** (24h / until resolved) · **How to stop** (link: Pause / Remove). Rendered inside every share confirm sheet and in Settings → "What am I sharing?".

---

## 5. Motion & Sound
- **Motion:** 150–200ms ease-out fades/slides only; respect `prefers-reduced-motion` (disable all non-essential animation). Never shake, flash, or pulse red.
- **Sound/haptics:** none by default. No autoplay, no alarm tones, no vibration on overdue. (Optional gentle haptic on successful check-in only, where platform allows, with opt-out.)

## 6. Map Layers & Components Needed

| Layer | Source table | Marker | Interactions |
|-------|--------------|--------|--------------|
| Sweep alerts (active/planned/resolved≤14d) | `sweeps` | clay circle / gold diamond / gray | tap → detail sheet; filter chips: All / Active / Planned |
| Resources (by category) | `resources` | sky tile pins w/ category glyph | tap → detail sheet; category filter; "near me once" recenter |
| Friend check-ins (peer view) | `check_ins` (fuzzed) | sage person-pin + 150m "approximate area" circle | tap → peer card (status, time, [Send kindness] preset) |
| Base map | Mapbox-style (placeholder key) | calm light style, large labels | zoom controls ≥48px; "locate me once" button w/ consent caption |

Shared map chrome: legend chip, list/map toggle, offline fallback panel, attribution. All layers keyboard- and screen-reader-accessible (list equivalents always present).

## 7. Copy Voice (quick reference for engineer)
Calm verbs: "find," "rest," "when you're ready," "no rush." Headers ≤ 6 words. Empty states follow: *what this is → why it matters → one next step.* Errors: *what happened → it's not your fault → what to try.* Full voice rules + banned words: see PRD §7.

---

*Build order: tokens → buttons/inputs/cards → badges/toast → sheets → pins/legend → screens. If in doubt, choose the calmer, larger, more explicit option.*
